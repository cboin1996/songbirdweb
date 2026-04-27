'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import {
  DOWNLOAD_URL, createEditJob, deleteEditDraft, Cut, EditParams, FadeEdit, fetchEditDraft,
  pollEditJob, Properties, saveEditDraft, songArtworkUrl, tagSong, artworkUrl,
  addToLibrary, removeFromLibrary, uploadSongArtwork, API_V1,
} from '../lib/data'
import { FaPlay, FaPause, FaTimes, FaUndo, FaRedo, FaTrash, FaSync, FaCut } from 'react-icons/fa'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { usePlayer } from './player'

import { snap as _snap } from '../lib/snap'
import ScrubInput from './scrub-input'

type Tab = 'audio' | 'properties'

// Map a buffer-offset (seconds from buffer start) back to original audio time using kept segments
function _bufTimeToOrig(elapsed: number, segs: [number, number][]): number {
  let rem = elapsed
  for (const [s, e] of segs) {
    const d = e - s
    if (rem <= d) return s + rem
    rem -= d
  }
  return segs.length > 0 ? segs[segs.length - 1][1] : elapsed
}

// Map an original audio time to its offset in the spliced buffer (snaps into-cut times to segment start)
function _origToBufOffset(origTime: number, segs: [number, number][]): number {
  let off = 0
  for (const [s, e] of segs) {
    if (origTime <= s) return off
    if (origTime <= e) return off + (origTime - s)
    off += e - s
  }
  return off
}

// Deterministic bar heights for the waveform loading skeleton (0-100%)
const WAVEFORM_SKELETON = Array.from({ length: 80 }, (_, i) => {
  const t = i / 79
  const env = Math.sin(t * Math.PI) * 0.7 + 0.3
  const wave = Math.abs(Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.9) * 0.3 + Math.sin(i * 3.1) * 0.2)
  return Math.max(4, Math.round(wave * env * 88 + 6))
})

const DEFAULT_PARAMS: EditParams = {
  trim_start: 0,
  trim_end: null,
  volume: 1.0,
  fades: [],
  speed: 1.0,
  normalize: false,
  cuts: [],
}

function stripClientIds(params: EditParams): EditParams {
  return {
    ...params,
    cuts: params.cuts.map(({ start, end, fade_in, fade_out }) => ({ start, end, fade_in, fade_out })),
    fades: params.fades.map(({ start, end, type }) => ({ start, end, type })),
  }
}

const DRAFT_EXPIRY_DAYS = 30
const MAX_FADE_DUR = 15
const MIN_REGION_DUR = 0.5

interface Props {
  songId: string
  properties: Properties
  artworkCached?: boolean
  parentSongId?: string | null
  rootSongId?: string | null
  isAdmin: boolean
}

export default function EditorModal({
  songId, properties: initialProperties, artworkCached, parentSongId, rootSongId, isAdmin,
}: Props) {
  const router = useRouter()
  const modalRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('audio')

  // --- audio params ---
  const [params, setParams] = useState<EditParams>(DEFAULT_PARAMS)
  const [duration, setDuration] = useState(0)
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null)

  // --- undo/redo ---
  const historyRef = useRef<EditParams[]>([])
  const redoStackRef = useRef<EditParams[]>([])
  const paramsRef = useRef<EditParams>(DEFAULT_PARAMS)
  const pendingSnapshotRef = useRef<EditParams | null>(null)
  const regionPreDragRef = useRef<EditParams | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // --- waveform ---
  const waveRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [wsReady, setWsReady] = useState(false)
  const wsReadyRef = useRef(false)
  const [wfPlaying, setWfPlaying] = useState(false)
  const [looping, setLooping] = useState(false)
  const loopingRef = useRef(false)
  const trimParamsRef = useRef({ trim_start: 0, trim_end: null as number | null })

  // --- original waveform ---
  const origWaveRef = useRef<HTMLDivElement>(null)
  const wsOrigRef = useRef<WaveSurfer | null>(null)
  const [origReady, setOrigReady] = useState(false)
  const [origPlaying, setOrigPlaying] = useState(false)

  // active waveform: ref for stale-closure-safe event handlers, state for render
  const activeWaveformRef = useRef<'orig' | 'edit'>('edit')
  const [activeWaveform, setActiveWaveform] = useState<'orig' | 'edit'>('edit')
  function switchToWaveform(w: 'orig' | 'edit') {
    activeWaveformRef.current = w
    setActiveWaveform(w)
  }

  // tracks the "current" edit song — transitions to result_song_id after a non-overwrite save
  const [activeSongId, setActiveSongId] = useState(songId)
  const activeSongIdRef = useRef(songId)
  const [activeRootSongId, setActiveRootSongId] = useState<string | null | undefined>(rootSongId)

  // --- preview (Web Audio) ---
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const previewRafRef = useRef<number | null>(null)
  const previewCtxStartTimeRef = useRef<number>(0)
  const previewTrimDurRef = useRef<number>(0)
  const previewTrimStartRef = useRef<number>(0)
  const previewBufferRef = useRef<AudioBuffer | null>(null)
  const previewSegmentsRef = useRef<[number, number][]>([])
  const programmaticRegionRef = useRef(false)

  const { pause: pausePlayer, isPlaying: playerIsPlaying } = usePlayer()

  // --- draft auto-save ---
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- waveform canvas rendering ---
  const peaksRef = useRef<Array<Float32Array | number[]> | null>(null)
  const waveCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const waveRafRef = useRef<number | null>(null)

  // --- timeline ruler ---
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const origTimelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const timelineContainerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hoverPlayheadRef = useRef<HTMLDivElement>(null)

  // --- hover overlay tracking (for cleanup on delete-while-hovered) ---
  const overlayElemsRef = useRef<Map<string, HTMLElement>>(new Map())

  // --- edit clipboard (cut/copy/paste) ---
  type ClipboardSingle = { kind: 'cut'; data: Cut } | { kind: 'fade'; data: FadeEdit }
  type ClipboardEntry = ClipboardSingle | { kind: 'all'; cuts: Cut[]; fades: FadeEdit[] }
  const clipboardRef = useRef<ClipboardEntry | null>(null)

  // --- multi-select (all) ---
  const [allSelected, setAllSelected] = useState(false)
  const allSelectedRef = useRef(false)

  // --- fade handle drag (capture listener, always reads latest handler via ref) ---
  const fadeHandleDragRef = useRef<(e: PointerEvent) => void>(() => {})
  const fadeHandleHoverRef = useRef<(e: MouseEvent) => void>(() => {})
  // which fade zone is hovered: { cutId, side: 'left'|'right' } or null
  const hoveredFadeRef = useRef<{ cutId: string; side: 'left' | 'right' } | null>(null)

  // --- region drag vs resize detection (true = body drag, false = handle resize) ---
  const isRegionDragRef = useRef(false)
  const resizeHandleRef = useRef<'left' | 'right' | null>(null)

  // --- job submit ---
  const [jobStatus, setJobStatus] = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [jobError, setJobError] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  // --- waveform context menu ---

  // --- region selection ---
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const selectedRegionIdRef = useRef<string | null>(null)
  const regionElemsRef = useRef<Map<string, HTMLElement>>(new Map())
  const [regionContextMenu, setRegionContextMenu] = useState<{ x: number; y: number; regionId: string; time?: number } | null>(null)

  // --- close guard ---
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- paste warning ---
  const [pasteWarning, setPasteWarning] = useState<string | null>(null)
  const pasteWarnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showPasteWarning(msg: string) {
    if (pasteWarnTimerRef.current) clearTimeout(pasteWarnTimerRef.current)
    setPasteWarning(msg)
    pasteWarnTimerRef.current = setTimeout(() => setPasteWarning(null), 4000)
  }

  // --- restore ---
  const [restoreConfirm, setRestoreConfirm] = useState<'original' | 'last' | null>(null)
  const [restoring, setRestoring] = useState(false)

  // --- properties tab ---
  const [props, setProps] = useState<Properties>(initialProperties)
  const [propStatus, setPropStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [artworkPreviewError, setArtworkPreviewError] = useState(false)
  const [artworkUploadStatus, setArtworkUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const artworkInputRef = useRef<HTMLInputElement>(null)

  const mainWaveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderWave = useCallback((peaks: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D) => {
    const isReplacement = mainWaveCanvasRef.current && !mainWaveCanvasRef.current.isConnected
    if (!mainWaveCanvasRef.current || isReplacement) mainWaveCanvasRef.current = ctx.canvas
    if (ctx.canvas !== mainWaveCanvasRef.current) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      return
    }
    peaksRef.current = peaks
    waveCtxRef.current = ctx
    const p = paramsRef.current
    const dur = wsRef.current?.getDuration() ?? 0
    if (!dur) return
    const peakData = peaks[0]
    if (!peakData) return
    const { width, height } = ctx.canvas
    const centerY = height / 2
    const BAR_W = 2, BAR_GAP = 1, BAR_R = 2
    const step = BAR_W + BAR_GAP
    const numBars = Math.floor(width / step)
    const numSamples = peakData.length
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? dur
    ctx.clearRect(0, 0, width, height)
    for (let i = 0; i < numBars; i++) {
      const x = i * step
      const t = (x / width) * dur
      let amp = 1.0
      let color = '#475569'
      if (t < trimStart || t > trimEnd) {
        continue
      } else {
        let handled = false
        for (const cut of p.cuts) {
          if (t >= cut.start && t <= cut.end) {
            amp = 0.05; color = '#dc2626'; handled = true; break
          }
          if (cut.fade_out > 0 && t >= cut.start - cut.fade_out && t < cut.start) {
            amp = Math.min(amp, 1 - (t - (cut.start - cut.fade_out)) / cut.fade_out)
            color = '#ef4444'; handled = true; break
          }
          if (cut.fade_in > 0 && t > cut.end && t <= cut.end + cut.fade_in) {
            amp = Math.min(amp, (t - cut.end) / cut.fade_in)
            color = '#ef4444'; handled = true; break
          }
        }
        if (!handled) {
          for (const fade of p.fades) {
            if (t >= fade.start && t <= fade.end) {
              const prog = (t - fade.start) / (fade.end - fade.start)
              amp = Math.min(amp, fade.type === 'in' ? prog : 1 - prog)
              color = fade.type === 'in' ? '#0ea5e9' : '#f59e0b'
              break
            }
          }
        }
      }
      const si = Math.floor((i / numBars) * numSamples)
      const ei = Math.min(si + Math.ceil(numSamples / numBars), numSamples)
      let peak = 0
      for (let j = si; j < ei; j++) peak = Math.max(peak, Math.abs(peakData[j]))
      const barH = Math.max(1, peak * amp * centerY)
      ctx.fillStyle = color
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, centerY - barH, BAR_W, barH * 2, Math.min(BAR_R, barH))
      else ctx.rect(x, centerY - barH, BAR_W, barH * 2)
      ctx.fill()
    }
    // Fade handle bar + triangle — triangle sits at fade extent, bar connects to cut edge
    const HS = 7 * (window.devicePixelRatio ?? 1)
    for (const cut of p.cuts) {
      if (cut.start > trimEnd || cut.end < trimStart) continue
      const fadeOut = cut.fade_out ?? 0
      const fadeIn = cut.fade_in ?? 0
      const xL = (cut.start / dur) * width
      const xR = (cut.end / dur) * width
      const xFO = ((cut.start - fadeOut) / dur) * width
      const xFI = ((cut.end + fadeIn) / dur) * width
      const midY = 2 + HS / 2
      ctx.fillStyle = '#dc2626'
      // Fade-out: bar from triangle to cut edge, then left-pointing triangle at fade extent
      if (fadeOut > 0) ctx.fillRect(xFO, midY - 0.5, xL - xFO, 1)
      ctx.beginPath(); ctx.moveTo(xFO, 2); ctx.lineTo(xFO, 2 + HS); ctx.lineTo(xFO - HS, midY); ctx.closePath(); ctx.fill()
      // Fade-in: bar from cut edge to triangle, then right-pointing triangle at fade extent
      if (fadeIn > 0) ctx.fillRect(xR, midY - 0.5, xFI - xR, 1)
      ctx.beginPath(); ctx.moveTo(xFI, 2); ctx.lineTo(xFI, 2 + HS); ctx.lineTo(xFI + HS, midY); ctx.closePath(); ctx.fill()
    }
    // Selected cut(s): outline the full fade+cut zone
    const cutsToOutline = allSelectedRef.current
      ? p.cuts
      : p.cuts.filter(c => c.id === selectedRegionIdRef.current)
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 1.5
    for (const selCut of cutsToOutline) {
      const x1 = Math.max(0, ((selCut.start - (selCut.fade_out ?? 0)) / dur) * width)
      const x2 = Math.min(width, ((selCut.end + (selCut.fade_in ?? 0)) / dur) * width)
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x1, 1, x2 - x1, height - 2, 2)
      else ctx.rect(x1, 1, x2 - x1, height - 2)
      ctx.stroke()
    }
    // Hovered fade zone: outline just that fade portion
    const hov = hoveredFadeRef.current
    if (hov) {
      const hovCut = p.cuts.find(c => c.id === hov.cutId)
      if (hovCut) {
        let hx1: number, hx2: number
        if (hov.side === 'left') {
          hx1 = Math.max(0, ((hovCut.start - (hovCut.fade_out ?? 0)) / dur) * width)
          hx2 = (hovCut.start / dur) * width
        } else {
          hx1 = (hovCut.end / dur) * width
          hx2 = Math.min(width, ((hovCut.end + (hovCut.fade_in ?? 0)) / dur) * width)
        }
        ctx.strokeStyle = '#dc2626'
        ctx.lineWidth = 1
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(hx1, 1, hx2 - hx1, height - 2, 2)
        else ctx.rect(hx1, 1, hx2 - hx1, height - 2)
        ctx.stroke()
      }
    }
  }, []) // stable — reads paramsRef / wsRef at call time

  // focus modal on mount so Space key is captured
  useEffect(() => { modalRef.current?.focus() }, [])

  // stop editor audio when global player starts
  useEffect(() => {
    if (playerIsPlaying) {
      wsRef.current?.pause()
      wsOrigRef.current?.pause()
      stopPreview()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIsPlaying])

  // load draft on open
  useEffect(() => {
    fetchEditDraft(songId).then(draftWithMeta => {
      if (draftWithMeta) {
        const draft = draftWithMeta.params
        setDraftUpdatedAt(draftWithMeta.updated_at)
        const cuts: Cut[] = (draft.cuts ?? []).map(c => ({ ...c, fade_in: c.fade_in ?? 0, fade_out: c.fade_out ?? 0, id: crypto.randomUUID() }))
        const fades: FadeEdit[] = (draft.fades ?? []).map(f => ({ ...f, id: crypto.randomUUID() }))
        const p = { ...draft, cuts, fades }
        setParams(p)
        if (wsReadyRef.current) { syncCutRegions(cuts); syncFadeRegions(fades) }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  // keep refs in sync for stale-closure-safe event handlers
  useEffect(() => { loopingRef.current = looping }, [looping])
  useEffect(() => { wsReadyRef.current = wsReady }, [wsReady])
  useEffect(() => { allSelectedRef.current = allSelected }, [allSelected])

  function applyRegionOutlines(selId: string | null, selAll: boolean) {
    regionElemsRef.current.forEach((el, id) => {
      const isCut = !id.startsWith('fade-') && id !== 'trim'
      const isSelected = selAll ? !isCut : (id === selId && !isCut)
      if ((selAll && !isCut) || (!selAll && id === selId && !isCut)) {
        let color = '#38bdf8'
        if (id.startsWith('fade-')) {
          const fade = paramsRef.current.fades.find(f => f.id === id.slice(5))
          color = fade?.type === 'out' ? '#f59e0b' : '#38bdf8'
        }
        el.style.outline = `2px solid ${color}`
      } else {
        el.style.outline = ''
      }
      el.style.outlineOffset = '1px'
      void isSelected // suppress unused warning
    })
  }

  useEffect(() => {
    selectedRegionIdRef.current = selectedRegionId
    applyRegionOutlines(selectedRegionId, allSelectedRef.current)
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
    waveRafRef.current = requestAnimationFrame(() => {
      if (peaksRef.current && waveCtxRef.current) renderWave(peaksRef.current, waveCtxRef.current)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegionId, renderWave])

  useEffect(() => {
    applyRegionOutlines(selectedRegionIdRef.current, allSelected)
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
    waveRafRef.current = requestAnimationFrame(() => {
      if (peaksRef.current && waveCtxRef.current) renderWave(peaksRef.current, waveCtxRef.current)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, renderWave])
  useEffect(() => {
    paramsRef.current = params
    trimParamsRef.current = { trim_start: params.trim_start, trim_end: params.trim_end }
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
    waveRafRef.current = requestAnimationFrame(() => {
      if (peaksRef.current && waveCtxRef.current) renderWave(peaksRef.current, waveCtxRef.current)
    })
  }, [params, renderWave])

  // draw timeline ruler ticks when duration is known
  useEffect(() => {
    function drawRuler(canvas: HTMLCanvasElement) {
      const dpr = window.devicePixelRatio ?? 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const tickColor = isDark ? '#4b5563' : '#d1d5db'
      const labelColor = isDark ? '#6b7280' : '#9ca3af'
      ctx.clearRect(0, 0, w, h)
      const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]
      const pxPerSec = w / duration
      const fontSize = Math.max(10, Math.min(14, Math.round(w / 28)))
      ctx.font = `${fontSize}px system-ui, sans-serif`
      const minLabelPx = ctx.measureText('0:00').width + fontSize * 2
      const majorInterval = candidates.find(c => c * pxPerSec >= minLabelPx) ?? 120
      const minorInterval = majorInterval / 4
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let t = 0; t <= duration + 1e-6; t += minorInterval) {
        const x = Math.round((t / duration) * w)
        const isMajor = Math.round(t / minorInterval) % 4 === 0
        const tickH = isMajor ? 7 : 3
        ctx.fillStyle = tickColor
        ctx.fillRect(x, h - tickH, 1, tickH)
        if (isMajor && t > 0) {
          const m = Math.floor(t / 60)
          const s = Math.floor(t % 60)
          const label = m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
          ctx.fillStyle = labelColor
          ctx.fillText(label, x, 0)
        }
      }
    }
    if (!duration) return
    const canvases = [timelineCanvasRef.current, origTimelineCanvasRef.current].filter((c): c is HTMLCanvasElement => !!c)
    canvases.forEach(drawRuler)
    let raf: number | null = null
    const ro = new ResizeObserver(() => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { raf = null; canvases.forEach(drawRuler) })
    })
    canvases.forEach(c => ro.observe(c))
    return () => { ro.disconnect(); if (raf !== null) cancelAnimationFrame(raf) }
  }, [duration])

  // debounced auto-save
  const scheduleSave = useCallback((p: EditParams) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveEditDraft(activeSongIdRef.current, stripClientIds(p)), 1000)
  }, [])

  // init WaveSurfer
  useEffect(() => {
    if (!waveRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: waveRef.current,
      cursorColor: '#38bdf8',
      height: 80,
      plugins: [regions],
      fetchParams: { credentials: 'include' },
      renderFunction: renderWave,
    })
    wsRef.current = ws
    ws.load(`${DOWNLOAD_URL}/${songId}`).catch((err: Error) => {
      if (err?.name !== 'AbortError') console.error('WaveSurfer load:', err)
    })
    ws.on('ready', () => {
      const dur = ws.getDuration()
      setDuration(dur)
      setWsReady(true)
      // Read current params via ref — avoids calling addRegion inside a state setter
      // (React StrictMode calls state updaters twice, which would create duplicate regions)
      const p = paramsRef.current
      programmaticRegionRef.current = true
      regions.addRegion({
        id: 'trim', start: p.trim_start, end: p.trim_end ?? dur,
        color: 'rgba(56,189,248,0.1)', drag: true, resize: true,
      })
      p.cuts.forEach(cut => {
        regions.addRegion({
          id: cut.id ?? crypto.randomUUID(),
          start: cut.start, end: cut.end,
          color: 'transparent', drag: true, resize: true,
        })
      })
      p.fades.forEach(fade => {
        regions.addRegion({
          id: `fade-${fade.id ?? crypto.randomUUID()}`,
          start: fade.start, end: fade.end,
          color: 'transparent',
          drag: true, resize: true,
        })
      })
      programmaticRegionRef.current = false
    })
    ws.on('timeupdate', (time: number) => {
      const dur = ws.getDuration()
      if (!dur || !playheadRef.current || !timelineContainerRef.current) return
      playheadRef.current.style.left = `${(time / dur) * 100}%`
    })
    ws.on('play', () => setWfPlaying(true))
    ws.on('pause', () => {
      setWfPlaying(false)
      if (wsPreviewRef.current) { wsPreviewRef.current = false; setPreviewing(false) }
    })
    ws.on('finish', () => {
      setWfPlaying(false)
      if (wsPreviewRef.current) { wsPreviewRef.current = false; setPreviewing(false); return }
      if (loopingRef.current) {
        const { trim_start, trim_end } = trimParamsRef.current
        ws.play(trim_start, trim_end ?? undefined)
      }
    })
    ws.on('error', (err: Error) => { if (err?.name !== 'AbortError') console.error('WaveSurfer:', err) })
    regions.on('region-created', region => {
      const el = region.element as HTMLElement
      const isTrim = region.id === 'trim'
      const isCut = !isTrim && !region.id.startsWith('fade-')
      el.style.boxSizing = 'border-box'
      const handleColor = isTrim ? '#0369a1'
        : isCut ? '#b91c1c'
        : (paramsRef.current.fades.find(f => f.id === region.id.slice(5))?.type === 'in' ? '#0369a1' : '#92400e')
      const handleW = navigator.maxTouchPoints > 0 ? '4px' : '10px'
      el.querySelectorAll<HTMLElement>('[part*="region-handle"]').forEach(h => {
        const isLeft = h.getAttribute('part')?.includes('left') ?? false
        Object.assign(h.style, {
          width: handleW,
          backgroundColor: 'transparent',
          borderLeft: isLeft ? `2px solid ${handleColor}` : 'none',
          borderRight: !isLeft ? `2px solid ${handleColor}` : 'none',
          cursor: 'ew-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: '10',
        })
        // Grip bar
        const grip = document.createElement('div')
        Object.assign(grip.style, {
          width: '2px',
          height: '20px',
          borderRadius: '1px',
          backgroundColor: handleColor,
          opacity: '0.8',
          pointerEvents: 'none',
        })
        h.appendChild(grip)
      })

      regionElemsRef.current.set(region.id, el)

      // click → select (stop propagation so waveform click doesn't also fire)
      el.addEventListener('click', e => {
        e.stopPropagation()
        setAllSelected(false)
        setSelectedRegionId(prev => prev === region.id ? null : region.id)
        setRegionContextMenu(null)
      })

      el.addEventListener('pointerdown', e => {
        const target = e.target as Element
        const isHandle = target.matches('[part*="region-handle"], [part*="region-handle"] *')
        isRegionDragRef.current = !isHandle
        if (isHandle) {
          const handleEl = (target.closest('[part*="region-handle"]') ?? target) as Element
          resizeHandleRef.current = handleEl.getAttribute('part')?.includes('left') ? 'left' : 'right'
        } else {
          resizeHandleRef.current = null
        }
      })

      el.addEventListener('contextmenu', e => {
        e.preventDefault()
        e.stopPropagation()
        if (isTrim) {
          const dur = wsRef.current?.getDuration() ?? 0
          const rect = el.parentElement?.getBoundingClientRect() ?? el.getBoundingClientRect()
          const time = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * dur
          setRegionContextMenu({ x: e.clientX, y: e.clientY, regionId: region.id, time })
          return
        }
        setSelectedRegionId(region.id)
        setRegionContextMenu({ x: e.clientX, y: e.clientY, regionId: region.id })
      })

      // long press → region context menu (mobile)
      let longPressTimer: ReturnType<typeof setTimeout> | null = null
      el.addEventListener('touchstart', e => {
        if (isTrim) {
          longPressTimer = setTimeout(() => {
            const touch = e.touches[0]
            const dur = wsRef.current?.getDuration() ?? 0
            const rect = el.parentElement?.getBoundingClientRect() ?? el.getBoundingClientRect()
            const time = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * dur
            setRegionContextMenu({ x: touch.clientX, y: touch.clientY, regionId: region.id, time })
          }, 800)
          return
        }
        longPressTimer = setTimeout(() => {
          const touch = e.touches[0]
          setSelectedRegionId(region.id)
          setRegionContextMenu({ x: touch.clientX, y: touch.clientY, regionId: region.id })
        }, 800)
      }, { passive: true })
      el.addEventListener('touchend', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null } })
      el.addEventListener('touchmove', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null } })

      // hover overlay for cuts (shows extended fade zone)
      let overlay: HTMLElement | null = null
      let rafId: number | null = null
      const syncOverlay = () => {
        if (!overlay) return
        const cut = paramsRef.current.cuts.find(c => c.id === region.id)
        const dur = wsRef.current?.getDuration() ?? 1
        const container = el.parentElement
        if (!container) return
        const pxPerSec = container.clientWidth / dur
        const fadeOutPx = (cut?.fade_out ?? 0) * pxPerSec
        const fadeInPx = (cut?.fade_in ?? 0) * pxPerSec
        overlay.style.left = `${el.offsetLeft - fadeOutPx}px`
        overlay.style.width = `${el.clientWidth + fadeOutPx + fadeInPx}px`
        rafId = requestAnimationFrame(syncOverlay)
      }
      el.addEventListener('mouseenter', () => {
        if (isCut) {
          const container = el.parentElement
          if (container) {
            overlay = document.createElement('div')
            Object.assign(overlay.style, {
              position: 'absolute', top: '0', height: '100%',
              pointerEvents: 'none', boxSizing: 'border-box',
              border: `2px solid ${handleColor}`,
            })
            container.appendChild(overlay)
            overlayElemsRef.current.set(region.id, overlay)
            syncOverlay()
          }
        } else {
          const isFadeOut = region.id.startsWith('fade-') &&
            paramsRef.current.fades.find(f => f.id === region.id.slice(5))?.type === 'out'
          el.style.boxShadow = `0 0 0 2px ${isFadeOut ? '#f59e0b' : '#38bdf8'}`
        }
      })
      el.addEventListener('mouseleave', () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        if (overlay) { overlay.remove(); overlay = null; overlayElemsRef.current.delete(region.id) }
        el.style.boxShadow = ''
      })
    })
    regions.on('region-removed', region => {
      regionElemsRef.current.delete(region.id)
      const staleOverlay = overlayElemsRef.current.get(region.id)
      if (staleOverlay) { staleOverlay.remove(); overlayElemsRef.current.delete(region.id) }
      if (selectedRegionIdRef.current === region.id) setSelectedRegionId(null)
    })
    regions.on('region-update', r => {
      if (programmaticRegionRef.current) return
      const dur = wsRef.current?.getDuration() ?? duration
      if (r.id === 'trim') {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const preDrag = regionPreDragRef.current ?? prev
          const origTrimSize = (preDrag.trim_end ?? dur) - preDrag.trim_start
          const isDragTrim = isRegionDragRef.current
          const contentStarts = [...prev.cuts.map(c => c.start - (c.fade_out ?? 0)), ...prev.fades.map(f => f.start)]
          const contentEnds = [...prev.cuts.map(c => c.end + (c.fade_in ?? 0)), ...prev.fades.map(f => f.end)]
          const hasContent = contentStarts.length > 0
          let newStart: number
          let newEnd: number
          if (isDragTrim) {
            newStart = Math.max(0, Math.min(dur - origTrimSize, r.start))
            newEnd = newStart + origTrimSize
            if (hasContent) {
              const minC = Math.min(...contentStarts)
              const maxC = Math.max(...contentEnds)
              if (newStart > minC) { newStart = minC; newEnd = newStart + origTrimSize }
              if (newEnd < maxC) { newEnd = maxC; newStart = newEnd - origTrimSize }
              newStart = Math.max(0, newStart)
              newEnd = Math.min(dur, newEnd)
            }
          } else {
            newStart = Math.max(0, r.start)
            newEnd = Math.min(dur, r.end)
            if (hasContent) {
              newStart = Math.min(newStart, Math.min(...contentStarts))
              newEnd = Math.max(newEnd, Math.max(...contentEnds))
            }
          }
          if (newEnd - newStart < MIN_REGION_DUR) {
            if (Math.abs(newStart - prev.trim_start) >= Math.abs(newEnd - (prev.trim_end ?? dur))) {
              newStart = newEnd - MIN_REGION_DUR
            } else {
              newEnd = newStart + MIN_REGION_DUR
            }
          }
          if (newStart !== r.start || newEnd !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start: newStart, end: newEnd })
            programmaticRegionRef.current = false
          }
          return { ...prev, trim_start: newStart, trim_end: newEnd }
        })
      } else if (r.id.startsWith('fade-')) {
        const fadeId = r.id.slice(5)
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const trimEnd = prev.trim_end ?? dur
          const isDrag = isRegionDragRef.current
          const preDragFade = regionPreDragRef.current?.fades.find(f => f.id === fadeId)
          const origSize = preDragFade ? preDragFade.end - preDragFade.start : undefined
          const fade = prev.fades.find(f => f.id === fadeId)
          const obstacles = [
            ...prev.fades,
            ...prev.cuts.map(c => ({ id: c.id, start: c.start - (c.fade_out ?? 0), end: c.end + (c.fade_in ?? 0) })),
          ]
          let start: number, end: number
          if (isDrag) {
            const snapped = _snap(r.start, r.end, obstacles, fadeId, trimStart, trimEnd, true, origSize)
            start = snapped.start; end = snapped.end
          } else if (fade) {
            if (fade.type === 'in') {
              end = fade.end
              start = Math.max(trimStart, r.start)
              for (const obs of obstacles.filter(o => o.id !== fadeId)) {
                if (start < obs.end && end > obs.start) start = obs.end
              }
              if (end - start < MIN_REGION_DUR) start = end - MIN_REGION_DUR
              if (end - start > MAX_FADE_DUR) start = end - MAX_FADE_DUR
            } else {
              start = fade.start
              end = Math.min(trimEnd, r.end)
              for (const obs of obstacles.filter(o => o.id !== fadeId)) {
                if (start < obs.end && end > obs.start) end = obs.start
              }
              if (end - start < MIN_REGION_DUR) end = start + MIN_REGION_DUR
              if (end - start > MAX_FADE_DUR) end = start + MAX_FADE_DUR
            }
          } else {
            start = r.start; end = r.end
          }
          if (start !== r.start || end !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start, end })
            programmaticRegionRef.current = false
          }
          return { ...prev, fades: prev.fades.map(f => f.id === fadeId ? { ...f, start, end } : f) }
        })
      } else {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const trimEnd = prev.trim_end ?? dur
          const isDrag = isRegionDragRef.current
          const cut = prev.cuts.find(c => c.id === r.id)
          const fadeOut = cut?.fade_out ?? 0
          const fadeIn = cut?.fade_in ?? 0
          const preDragCut = regionPreDragRef.current?.cuts.find(c => c.id === r.id)
          const origExtSize = preDragCut
            ? (preDragCut.end + (preDragCut.fade_in ?? 0)) - (preDragCut.start - (preDragCut.fade_out ?? 0))
            : undefined
          const obstacles = [
            ...prev.cuts.map(c => ({ id: c.id, start: c.start - (c.fade_out ?? 0), end: c.end + (c.fade_in ?? 0) })),
            ...prev.fades,
          ]
          let start: number, end: number
          if (isDrag) {
            const ext = _snap(r.start - fadeOut, r.end + fadeIn, obstacles, r.id, trimStart, trimEnd, true, origExtSize)
            start = ext.start + fadeOut
            end = ext.end - fadeIn
          } else if (cut) {
            if (resizeHandleRef.current === 'left') {
              end = cut.end
              start = Math.max(trimStart, r.start)
              for (const obs of obstacles.filter(o => o.id !== r.id)) {
                if (start < obs.end && end > obs.start) start = obs.end
              }
              if (end - start < MIN_REGION_DUR) start = end - MIN_REGION_DUR
            } else {
              start = cut.start
              end = Math.min(trimEnd, r.end)
              for (const obs of obstacles.filter(o => o.id !== r.id)) {
                if (start < obs.end && end > obs.start) end = obs.start
              }
              if (end - start < MIN_REGION_DUR) end = start + MIN_REGION_DUR
            }
          } else {
            start = r.start; end = r.end
          }
          if (start !== r.start || end !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start, end })
            programmaticRegionRef.current = false
          }
          return { ...prev, cuts: prev.cuts.map(c => c.id === r.id ? { ...c, start, end } : c) }
        })
      }
    })
    regions.on('region-updated', r => {
      if (programmaticRegionRef.current) return
      if (r.id === 'trim') {
        setParams(prev => {
          // region-update ran correct constrained math throughout the drag — trust those values
          const dur = wsRef.current?.getDuration() ?? duration
          const trimStart = prev.trim_start
          const trimEnd = prev.trim_end ?? dur
          if (trimStart !== r.start || trimEnd !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start: trimStart, end: trimEnd })
            programmaticRegionRef.current = false
          }
          const next = { ...prev, trim_start: trimStart, trim_end: trimEnd }
          scheduleSave(next)
          return next
        })
      } else if (r.id.startsWith('fade-')) {
        const fadeId = r.id.slice(5)
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const dur = wsRef.current?.getDuration() ?? duration
          const trimEnd = prev.trim_end ?? dur
          const isDrag = isRegionDragRef.current
          const preDragFade = regionPreDragRef.current?.fades.find(f => f.id === fadeId)
          const origSize = preDragFade ? preDragFade.end - preDragFade.start : undefined
          const fade = prev.fades.find(f => f.id === fadeId)
          const obstacles = [
            ...prev.fades,
            ...prev.cuts.map(c => ({ id: c.id, start: c.start - (c.fade_out ?? 0), end: c.end + (c.fade_in ?? 0) })),
          ]
          let start: number, end: number
          if (isDrag) {
            const snapped = _snap(r.start, r.end, obstacles, fadeId, trimStart, trimEnd, true, origSize)
            start = snapped.start; end = snapped.end
          } else if (fade) {
            if (fade.type === 'in') {
              end = fade.end
              start = Math.max(trimStart, r.start)
              for (const obs of obstacles.filter(o => o.id !== fadeId)) {
                if (start < obs.end && end > obs.start) start = obs.end
              }
              if (end - start < MIN_REGION_DUR) start = end - MIN_REGION_DUR
              if (end - start > MAX_FADE_DUR) start = end - MAX_FADE_DUR
            } else {
              start = fade.start
              end = Math.min(trimEnd, r.end)
              for (const obs of obstacles.filter(o => o.id !== fadeId)) {
                if (start < obs.end && end > obs.start) end = obs.start
              }
              if (end - start < MIN_REGION_DUR) end = start + MIN_REGION_DUR
              if (end - start > MAX_FADE_DUR) end = start + MAX_FADE_DUR
            }
          } else {
            start = r.start; end = r.end
          }
          if (start !== r.start || end !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start, end })
            programmaticRegionRef.current = false
          }
          const next = { ...prev, fades: prev.fades.map(f => f.id === fadeId ? { ...f, start, end } : f) }
          scheduleSave(next)
          return next
        })
      } else {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const dur = wsRef.current?.getDuration() ?? duration
          const trimEnd = prev.trim_end ?? dur
          const isDrag = isRegionDragRef.current
          const cut = prev.cuts.find(c => c.id === r.id)
          const fadeOut = cut?.fade_out ?? 0
          const fadeIn = cut?.fade_in ?? 0
          const preDragCut = regionPreDragRef.current?.cuts.find(c => c.id === r.id)
          const origExtSize = preDragCut
            ? (preDragCut.end + (preDragCut.fade_in ?? 0)) - (preDragCut.start - (preDragCut.fade_out ?? 0))
            : undefined
          const obstacles = [
            ...prev.cuts.map(c => ({ id: c.id, start: c.start - (c.fade_out ?? 0), end: c.end + (c.fade_in ?? 0) })),
            ...prev.fades,
          ]
          let start: number, end: number
          if (isDrag) {
            const ext = _snap(r.start - fadeOut, r.end + fadeIn, obstacles, r.id, trimStart, trimEnd, true, origExtSize)
            start = ext.start + fadeOut
            end = ext.end - fadeIn
          } else if (cut) {
            if (resizeHandleRef.current === 'left') {
              end = cut.end
              start = Math.max(trimStart, r.start)
              for (const obs of obstacles.filter(o => o.id !== r.id)) {
                if (start < obs.end && end > obs.start) start = obs.end
              }
              if (end - start < MIN_REGION_DUR) start = end - MIN_REGION_DUR
            } else {
              start = cut.start
              end = Math.min(trimEnd, r.end)
              for (const obs of obstacles.filter(o => o.id !== r.id)) {
                if (start < obs.end && end > obs.start) end = obs.start
              }
              if (end - start < MIN_REGION_DUR) end = start + MIN_REGION_DUR
            }
          } else {
            start = r.start; end = r.end
          }
          if (start !== r.start || end !== r.end) {
            programmaticRegionRef.current = true
            r.setOptions({ start, end })
            programmaticRegionRef.current = false
          }
          const next = { ...prev, cuts: prev.cuts.map(c => c.id === r.id ? { ...c, start, end } : c) }
          scheduleSave(next)
          return next
        })
      }
    })

    function handleRegionDragEnd() {
      isRegionDragRef.current = false
      resizeHandleRef.current = null
      const snapshot = regionPreDragRef.current
      if (!snapshot) return
      regionPreDragRef.current = null
      pushHistory(snapshot)
    }
    window.addEventListener('mouseup', handleRegionDragEnd)
    window.addEventListener('touchend', handleRegionDragEnd)
    window.addEventListener('pointerup', handleRegionDragEnd)

    // WaveSurfer debounces its own resize by 100ms — bypass it so regions
    // and waveform stay in sync during continuous window/orientation resize.
    let waveResizeRaf: number | null = null
    const waveRo = new ResizeObserver(() => {
      if (waveResizeRaf !== null) cancelAnimationFrame(waveResizeRaf)
      waveResizeRaf = requestAnimationFrame(() => {
        waveResizeRaf = null
        ws.getRenderer().reRender()
      })
    })
    waveRo.observe(waveRef.current)

    return () => {
      waveRo.disconnect()
      if (waveResizeRaf !== null) cancelAnimationFrame(waveResizeRaf)
      window.removeEventListener('mouseup', handleRegionDragEnd)
      window.removeEventListener('touchend', handleRegionDragEnd)
      window.removeEventListener('pointerup', handleRegionDragEnd)
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
      if (waveRafRef.current) { cancelAnimationFrame(waveRafRef.current); waveRafRef.current = null }
      peaksRef.current = null
      waveCtxRef.current = null
      mainWaveCanvasRef.current = null
      wsRef.current = null
      regionsRef.current = null
      ws.destroy()
    }
  }, [songId, scheduleSave, renderWave])

  // Attach capturing pointerdown + mousemove listeners for fade handle interaction
  useEffect(() => {
    const container = waveRef.current
    if (!container) return
    const downHandler = (e: PointerEvent) => fadeHandleDragRef.current(e)
    const moveHandler = (e: MouseEvent) => fadeHandleHoverRef.current(e)
    const leaveHandler = () => {
      if (!hoveredFadeRef.current) return
      hoveredFadeRef.current = null
      if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
      waveRafRef.current = requestAnimationFrame(() => {
        if (peaksRef.current && waveCtxRef.current) renderWave(peaksRef.current, waveCtxRef.current)
      })
    }
    container.addEventListener('pointerdown', downHandler, { capture: true })
    container.addEventListener('mousemove', moveHandler)
    container.addEventListener('mouseleave', leaveHandler)
    return () => {
      container.removeEventListener('pointerdown', downHandler, { capture: true })
      container.removeEventListener('mousemove', moveHandler)
      container.removeEventListener('mouseleave', leaveHandler)
    }
  }, [])

  // original waveform — read-only, no regions
  useEffect(() => {
    if (!origWaveRef.current) return
    const ws = WaveSurfer.create({
      container: origWaveRef.current,
      waveColor: '#64748b',
      progressColor: '#38bdf8',
      cursorColor: '#38bdf8',
      height: 80,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      fetchParams: { credentials: 'include' },
    })
    wsOrigRef.current = ws
    ws.load(`${DOWNLOAD_URL}/${songId}`).catch((err: Error) => {
      if (err?.name !== 'AbortError') console.error('WaveSurfer orig:', err)
    })
    ws.on('ready', () => setOrigReady(true))
    ws.on('play', () => setOrigPlaying(true))
    ws.on('pause', () => setOrigPlaying(false))
    ws.on('finish', () => setOrigPlaying(false))
    ws.on('error', (err: Error) => { if (err?.name !== 'AbortError') console.error('WaveSurfer orig:', err) })
    return () => { wsOrigRef.current = null; ws.destroy() }
  }, [songId])

  // sync volume — clamp to [0,1] since HTMLMediaElement.volume only accepts that range
  useEffect(() => { wsRef.current?.setVolume(Math.min(1, params.volume)) }, [params.volume])

  function pushHistory(snapshot: EditParams) {
    historyRef.current = [...historyRef.current.slice(-19), snapshot]
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }

  function undo() {
    const hist = historyRef.current
    if (hist.length === 0) return
    const prev = hist[hist.length - 1]
    historyRef.current = hist.slice(0, -1)
    setCanUndo(historyRef.current.length > 0)
    redoStackRef.current = [...redoStackRef.current, paramsRef.current]
    setCanRedo(true)
    applyParams(prev)
    scheduleSave(prev)
  }

  function redo() {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const next = stack[stack.length - 1]
    redoStackRef.current = stack.slice(0, -1)
    setCanRedo(redoStackRef.current.length > 0)
    historyRef.current = [...historyRef.current, paramsRef.current]
    setCanUndo(true)
    applyParams(next)
    scheduleSave(next)
  }

  function syncCutRegions(cuts: Cut[]) {
    if (!regionsRef.current) return
    programmaticRegionRef.current = true
    regionsRef.current.getRegions().filter(r => r.id !== 'trim' && !r.id.startsWith('fade-')).forEach(r => r.remove())
    cuts.forEach(cut => {
      regionsRef.current!.addRegion({
        id: cut.id ?? crypto.randomUUID(),
        start: cut.start, end: cut.end,
        color: 'rgba(239,68,68,0.15)', drag: true, resize: true,
      })
    })
    programmaticRegionRef.current = false
  }

  function syncFadeRegions(fades: FadeEdit[]) {
    if (!regionsRef.current) return
    programmaticRegionRef.current = true
    regionsRef.current.getRegions().filter(r => r.id.startsWith('fade-')).forEach(r => r.remove())
    fades.forEach(fade => {
      regionsRef.current!.addRegion({
        id: `fade-${fade.id ?? crypto.randomUUID()}`,
        start: fade.start, end: fade.end,
        color: 'transparent',
        drag: true, resize: true,
      })
    })
    programmaticRegionRef.current = false
  }

  function applyParams(p: EditParams) {
    setParams(p)
    const region = regionsRef.current?.getRegions().find(r => r.id === 'trim')
    if (region && duration > 0) region.setOptions({ start: p.trim_start, end: p.trim_end ?? duration, drag: true })
    wsRef.current?.setVolume(p.volume)
    syncCutRegions(p.cuts)
    syncFadeRegions(p.fades)
  }

  function addCut() {
    if (!wsReady || !duration) return
    const p = paramsRef.current
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? duration
    const span = Math.min(10, trimEnd - trimStart)
    const sorted = [...p.cuts].sort((a, b) => a.start - b.start)
    const cursor = wsRef.current?.getCurrentTime() ?? (trimStart + trimEnd) / 2
    let start = Math.max(trimStart, Math.min(trimEnd - span, cursor - span / 2))
    for (let i = 0; i <= sorted.length; i++) {
      const end = Math.min(trimEnd, start + span)
      if (end - start < 0.5) return
      const hit = sorted.find(c => start < c.end && end > c.start)
      if (!hit) break
      start = hit.end + 0.1
    }
    const end = Math.min(trimEnd, start + span)
    if (end - start < 0.5) return
    const id = crypto.randomUUID()
    pushHistory(p)
    regionsRef.current?.addRegion({ id, start, end, color: 'transparent', drag: true, resize: true })
    setParams(prev => ({ ...prev, cuts: [...prev.cuts, { id, start, end, fade_in: 0, fade_out: 0 }] }))
  }

  function removeCut(id: string) {
    pushHistory(paramsRef.current)
    regionsRef.current?.getRegions().find(r => r.id === id)?.remove()
    setParams(prev => ({ ...prev, cuts: prev.cuts.filter(c => c.id !== id) }))
  }

  function updateCutFade(id: string, key: 'fade_in' | 'fade_out', value: number) {
    setParams(prev => {
      const cut = prev.cuts.find(c => c.id === id)
      if (!cut) return prev
      const trimStart = prev.trim_start
      const trimEnd = prev.trim_end ?? duration
      let clamped = value
      if (key === 'fade_out') {
        const leftEdges = [
          trimStart,
          ...prev.fades.filter(f => f.end <= cut.start).map(f => f.end),
          ...prev.cuts.filter(c => c.id !== id && c.end <= cut.start).map(c => c.end + (c.fade_in ?? 0)),
        ]
        clamped = Math.min(value, cut.start - Math.max(...leftEdges))
      } else {
        const rightEdges = [
          trimEnd,
          ...prev.fades.filter(f => f.start >= cut.end).map(f => f.start),
          ...prev.cuts.filter(c => c.id !== id && c.start >= cut.end).map(c => c.start - (c.fade_out ?? 0)),
        ]
        clamped = Math.min(value, Math.min(...rightEdges) - cut.end)
      }
      const next = { ...prev, cuts: prev.cuts.map(c => c.id === id ? { ...c, [key]: Math.max(0, clamped) } : c) }
      scheduleSave(next)
      return next
    })
  }

  function addFade(type: 'in' | 'out') {
    if (!wsReady || !duration) return
    const DEFAULT_DUR = 10
    const p = paramsRef.current
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? duration
    const obstacles = [...p.fades, ...p.cuts].sort((a, b) => a.start - b.start)
    let start: number, end: number
    if (type === 'in') {
      start = trimStart
      end = Math.min(trimEnd, trimStart + DEFAULT_DUR)
      for (const o of obstacles) {
        if (start < o.end && end > o.start) { start = o.end + 0.1; end = Math.min(trimEnd, start + DEFAULT_DUR) }
      }
    } else {
      end = trimEnd
      start = Math.max(trimStart, trimEnd - DEFAULT_DUR)
      for (const o of [...obstacles].reverse()) {
        if (start < o.end && end > o.start) { end = o.start - 0.1; start = Math.max(trimStart, end - DEFAULT_DUR) }
      }
    }
    if (end - start < 0.5) return
    const id = crypto.randomUUID()
    pushHistory(paramsRef.current)
    regionsRef.current?.addRegion({ id: `fade-${id}`, start, end, color: 'transparent', drag: true, resize: true })
    setParams(prev => ({ ...prev, fades: [...prev.fades, { id, start, end, type }] }))
  }

  function addCutAtTime(time: number) {
    if (!wsReady || !duration) return
    const p = paramsRef.current
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? duration
    const span = Math.min(10, trimEnd - trimStart)
    const start = Math.max(trimStart, Math.min(trimEnd - span, time - span / 2))
    const end = Math.min(trimEnd, start + span)
    if (end - start < 0.5) return
    const id = crypto.randomUUID()
    pushHistory(p)
    regionsRef.current?.addRegion({ id, start, end, color: 'transparent', drag: true, resize: true })
    setParams(prev => ({ ...prev, cuts: [...prev.cuts, { id, start, end, fade_in: 0, fade_out: 0 }] }))
  }

  function addFadeAtTime(time: number, type: 'in' | 'out') {
    if (!wsReady || !duration) return
    const DEFAULT_DUR = 10
    const p = paramsRef.current
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? duration
    let start: number, end: number
    if (type === 'in') {
      start = Math.max(trimStart, time)
      end = Math.min(trimEnd, start + DEFAULT_DUR)
    } else {
      end = Math.min(trimEnd, time)
      start = Math.max(trimStart, end - DEFAULT_DUR)
    }
    if (end - start < 0.5) return
    const id = crypto.randomUUID()
    pushHistory(p)
    regionsRef.current?.addRegion({ id: `fade-${id}`, start, end, color: 'transparent', drag: true, resize: true })
    setParams(prev => ({ ...prev, fades: [...prev.fades, { id, start, end, type }] }))
  }

  function removeFade(id: string) {
    pushHistory(paramsRef.current)
    regionsRef.current?.getRegions().find(r => r.id === `fade-${id}`)?.remove()
    setParams(prev => {
      const next = { ...prev, fades: prev.fades.filter(f => f.id !== id) }
      scheduleSave(next)
      return next
    })
  }

  function executePaste(atTime?: number) {
    const entry = clipboardRef.current
    if (!entry) return
    const p = paramsRef.current
    const dur = wsRef.current?.getDuration() ?? 0
    const trimStart = p.trim_start
    const trimEnd = p.trim_end ?? dur
    pushHistory(p)

    // compute delta for "paste here" — shift so earliest edge aligns with atTime
    let delta = 0
    if (atTime !== undefined) {
      if (entry.kind === 'all') {
        const earliest = Math.min(
          ...entry.cuts.map(c => c.start),
          ...entry.fades.map(f => f.start),
          Infinity,
        )
        delta = earliest === Infinity ? 0 : atTime - earliest
      } else {
        delta = atTime - entry.data.start
      }
    }

    let dropped = 0; let clamped = 0

    function applyBounds(rawStart: number, rawEnd: number) {
      const s = Math.max(trimStart, rawStart)
      const e = Math.min(trimEnd, rawEnd)
      const fits = e - s >= 0.01
      if (!fits) dropped++
      else if (s !== rawStart || e !== rawEnd) clamped++
      return fits ? { start: s, end: e } : null
    }

    if (entry.kind === 'all') {
      const newCuts = entry.cuts.flatMap(c => {
        const b = applyBounds(c.start + delta, c.end + delta)
        return b ? [{ ...c, id: crypto.randomUUID(), ...b }] : []
      })
      const newFades = entry.fades.flatMap(f => {
        const b = applyBounds(f.start + delta, f.end + delta)
        return b ? [{ ...f, id: crypto.randomUUID(), ...b }] : []
      })
      const ac = [...p.cuts, ...newCuts]; const af = [...p.fades, ...newFades]
      setParams(prev => ({ ...prev, cuts: ac, fades: af }))
      syncCutRegions(ac); syncFadeRegions(af)
      setAllSelected(true); setSelectedRegionId(null)
    } else if (entry.kind === 'cut') {
      const b = applyBounds(entry.data.start + delta, entry.data.end + delta)
      if (b) {
        const id = crypto.randomUUID()
        const nc: Cut = { ...entry.data, id, ...b }
        setParams(prev => ({ ...prev, cuts: [...prev.cuts, nc] }))
        syncCutRegions([...p.cuts, nc])
        setSelectedRegionId(id); setAllSelected(false)
      }
    } else {
      const b = applyBounds(entry.data.start + delta, entry.data.end + delta)
      if (b) {
        const id = crypto.randomUUID()
        const nf: FadeEdit = { ...entry.data, id, ...b }
        setParams(prev => ({ ...prev, fades: [...prev.fades, nf] }))
        syncFadeRegions([...p.fades, nf])
        setSelectedRegionId(`fade-${id}`); setAllSelected(false)
      }
    }

    if (dropped > 0 || clamped > 0) {
      const parts = []
      if (dropped > 0) parts.push(`${dropped} ${dropped === 1 ? 'edit' : 'edits'} outside trim and removed`)
      if (clamped > 0) parts.push(`${clamped} clipped to fit`)
      showPasteWarning(parts.join(', ') + '.')
    }
  }

  function removeSelected() {
    const id = selectedRegionIdRef.current
    if (!id || id === 'trim') return
    if (id.startsWith('fade-')) removeFade(id.slice(5))
    else removeCut(id)
    setSelectedRegionId(null)
  }

  // (fade timing and cut timing are GUI-only via waveform drag)

  function handleSliderReset(key: keyof EditParams, defaultVal: number) {
    pushHistory(paramsRef.current)
    setParams(prev => { const next = { ...prev, [key]: defaultVal }; scheduleSave(next); return next })
  }

  function handleSliderStart() {
    pendingSnapshotRef.current = paramsRef.current
  }

  function handleSliderChange(key: keyof EditParams, value: number) {
    setParams(prev => {
      const next = { ...prev, [key]: value }
      scheduleSave(next)
      return next
    })
  }

  function handleSliderCommit() {
    if (pendingSnapshotRef.current) {
      pushHistory(pendingSnapshotRef.current)
      pendingSnapshotRef.current = null
    }
  }

  const wsPreviewRef = useRef(false)

  function scheduleGainEvents(
    gain: GainNode,
    ctx: AudioContext,
    startBufOff: number,
    totalBufDur: number,
    segs: [number, number][],
    cutsForRange: Cut[],
    p: EditParams
  ) {
    const speed = p.speed
    const now = ctx.currentTime
    const realOf = (b: number) => now + (b - startBufOff) / speed

    // Compute composite initGain at startBufOff
    let initGain = p.volume

    // Arbitrary fade contributions to initGain
    for (const fade of p.fades) {
      const bs = _origToBufOffset(fade.start, segs)
      const be = _origToBufOffset(fade.end, segs)
      const dur = be - bs
      if (dur <= 0) continue
      if (fade.type === 'in') {
        if (startBufOff < bs) {
          // before fade-in: full volume (no attenuation from this fade)
        } else if (startBufOff < be) {
          initGain = Math.min(initGain, p.volume * (startBufOff - bs) / dur)
        }
      } else {
        if (startBufOff >= be) {
          initGain = 0
        } else if (startBufOff >= bs) {
          initGain = Math.min(initGain, p.volume * (be - startBufOff) / dur)
        }
      }
    }

    // Cut fade contributions to initGain
    let bufAccum = 0
    for (let i = 0; i < segs.length - 1; i++) {
      bufAccum += segs[i][1] - segs[i][0]
      const B = bufAccum
      const cut = cutsForRange.find(c => Math.abs(c.start - segs[i][1]) < 0.05)
      if (!cut) continue
      if (cut.fade_out > 0 && startBufOff >= B - cut.fade_out && startBufOff < B) {
        initGain = Math.min(initGain, p.volume * (B - startBufOff) / cut.fade_out)
      }
      if (cut.fade_in > 0 && startBufOff >= B && startBufOff < B + cut.fade_in) {
        initGain = Math.min(initGain, p.volume * (startBufOff - B) / cut.fade_in)
      }
    }
    gain.gain.setValueAtTime(initGain, now)

    // Schedule future arbitrary fade events
    for (const fade of p.fades) {
      const bs = _origToBufOffset(fade.start, segs)
      const be = _origToBufOffset(fade.end, segs)
      if (be <= startBufOff) continue
      if (fade.type === 'in') {
        if (bs > startBufOff) {
          // fade-in starts in the future: jump to 0 at bs, ramp to volume at be
          gain.gain.setValueAtTime(p.volume, realOf(bs) - 1e-4)
          gain.gain.setValueAtTime(0, realOf(bs))
          gain.gain.linearRampToValueAtTime(p.volume, realOf(be))
        } else if (startBufOff < be) {
          // started inside fade-in: ramp to volume at be
          gain.gain.linearRampToValueAtTime(p.volume, realOf(be))
        }
      } else {
        if (bs > startBufOff) {
          // fade-out starts in the future
          gain.gain.setValueAtTime(p.volume, realOf(bs))
          gain.gain.linearRampToValueAtTime(0, realOf(be))
        } else if (startBufOff < be) {
          // started inside fade-out
          gain.gain.linearRampToValueAtTime(0, realOf(be))
        }
      }
    }

    // Cut fades (future boundaries only)
    bufAccum = 0
    for (let i = 0; i < segs.length - 1; i++) {
      bufAccum += segs[i][1] - segs[i][0]
      const B = bufAccum
      const cut = cutsForRange.find(c => Math.abs(c.start - segs[i][1]) < 0.05)
      if (!cut) continue
      const fo = cut.fade_out
      const fi = cut.fade_in
      if (fo > 0) {
        const foStart = B - fo
        if (foStart > startBufOff) {
          gain.gain.setValueAtTime(p.volume, realOf(foStart))
          gain.gain.linearRampToValueAtTime(0, realOf(B))
        } else if (startBufOff < B) {
          gain.gain.linearRampToValueAtTime(0, realOf(B))
        }
      }
      if (fi > 0) {
        if (B > startBufOff) {
          if (fo === 0) gain.gain.setValueAtTime(0, realOf(B))
          gain.gain.linearRampToValueAtTime(p.volume, realOf(B + fi))
        } else if (startBufOff < B + fi) {
          gain.gain.linearRampToValueAtTime(p.volume, realOf(B + fi))
        }
      } else if (fo > 0 && B > startBufOff) {
        gain.gain.setValueAtTime(p.volume, realOf(B) + 1e-4)
      }
    }
  }

  function stopPreview() {
    const wasWebAudio = previewSrcRef.current !== null
    if (previewRafRef.current) { cancelAnimationFrame(previewRafRef.current); previewRafRef.current = null }
    if (previewSrcRef.current) { previewSrcRef.current.onended = null; try { previewSrcRef.current.stop() } catch {} }
    previewCtxRef.current?.close()
    previewSrcRef.current = null
    previewCtxRef.current = null
    previewBufferRef.current = null
    previewSegmentsRef.current = []
    if (!wasWebAudio && wsPreviewRef.current) wsRef.current?.pause()
    wsPreviewRef.current = false
    setPreviewing(false)
  }

  async function handlePreview() {
    if (previewing) { stopPreview(); return }
    wsRef.current?.pause()
    wsOrigRef.current?.pause()
    pausePlayer()

    const p = paramsRef.current
    const cursorTime = wsRef.current?.getCurrentTime() ?? p.trim_start
    const trimEnd = p.trim_end ?? duration
    // start from cursor if it falls inside the trim window, otherwise start from trim_start
    const startOrig = (cursorTime >= p.trim_start && cursorTime < trimEnd) ? cursorTime : p.trim_start

    const hasCuts = p.cuts.length > 0
    const needsWebAudio = hasCuts || p.speed !== 1.0 || p.fades.length > 0

    if (!needsWebAudio) {
      wsRef.current?.setVolume(p.volume)
      wsRef.current?.play(startOrig, p.trim_end ?? undefined)
      wsPreviewRef.current = true
      setPreviewing(true)
      return
    }

    const raw = wsRef.current?.getDecodedData()
    if (!raw) return
    const ctx = new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    const sr = raw.sampleRate
    const startFrame = Math.floor(p.trim_start * sr)
    const endFrame = p.trim_end !== null ? Math.floor(p.trim_end * sr) : raw.length

    const cutsInRange = [...p.cuts]
      .filter(c => c.end > p.trim_start && c.start < trimEnd)
      .sort((a, b) => a.start - b.start)
    const segments: [number, number][] = []
    let pos = startFrame
    for (const cut of cutsInRange) {
      const cs = Math.max(startFrame, Math.floor(cut.start * sr))
      const ce = Math.min(endFrame, Math.floor(cut.end * sr))
      if (cs > pos) segments.push([pos, cs])
      if (ce > pos) pos = ce
    }
    if (pos < endFrame) segments.push([pos, endFrame])

    const totalFrames = segments.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0)
    if (totalFrames <= 0) return

    const trimmed = ctx.createBuffer(raw.numberOfChannels, Math.max(1, totalFrames), sr)
    let offset = 0
    for (const [s, e] of segments) {
      const len = Math.max(0, e - s)
      for (let ch = 0; ch < raw.numberOfChannels; ch++) {
        trimmed.getChannelData(ch).set(raw.getChannelData(ch).subarray(s, s + len), offset)
      }
      offset += len
    }

    const segsSec: [number, number][] = segments.map(([s, e]) => [s / sr, e / sr])
    previewBufferRef.current = trimmed
    previewSegmentsRef.current = segsSec

    // Compute buffer offset for startOrig so we begin from cursor position
    const startBufOff = _origToBufOffset(startOrig, segsSec)
    const remainingBufDur = trimmed.duration - startBufOff

    const source = ctx.createBufferSource()
    source.buffer = trimmed
    source.playbackRate.value = p.speed

    const gain = ctx.createGain()
    scheduleGainEvents(gain, ctx, startBufOff, trimmed.duration, segsSec, cutsInRange, p)

    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(0, startBufOff)
    previewSrcRef.current = source
    previewCtxRef.current = ctx
    previewCtxStartTimeRef.current = ctx.currentTime
    // trimDur is in buffer-seconds; rAF uses buffer elapsed = real elapsed * speed
    previewTrimDurRef.current = remainingBufDur
    previewTrimStartRef.current = startOrig
    setPreviewing(true)
    wsRef.current?.setTime(startOrig)
    function tickCursor() {
      if (!previewCtxRef.current || !previewSrcRef.current) return
      const realElapsed = previewCtxRef.current.currentTime - previewCtxStartTimeRef.current
      const bufElapsed = realElapsed * paramsRef.current.speed
      const t = _bufTimeToOrig(startBufOff + Math.min(bufElapsed, previewTrimDurRef.current), previewSegmentsRef.current)
      wsRef.current?.setTime(t)
      previewRafRef.current = requestAnimationFrame(tickCursor)
    }
    previewRafRef.current = requestAnimationFrame(tickCursor)
    source.onended = () => {
      if (previewRafRef.current) { cancelAnimationFrame(previewRafRef.current); previewRafRef.current = null }
      previewSrcRef.current = null
      previewCtxRef.current = null
      previewBufferRef.current = null
      previewSegmentsRef.current = []
      setPreviewing(false)
    }
  }

  function seekWebAudioPreview(originalTime: number) {
    const ctx = previewCtxRef.current
    const buffer = previewBufferRef.current
    const segs = previewSegmentsRef.current
    if (!ctx || !buffer || segs.length === 0) return
    const bufOff = _origToBufOffset(originalTime, segs)
    const remaining = buffer.duration - bufOff
    if (remaining <= 0) return
    if (previewRafRef.current) { cancelAnimationFrame(previewRafRef.current); previewRafRef.current = null }
    if (previewSrcRef.current) { previewSrcRef.current.onended = null; try { previewSrcRef.current.stop() } catch {} }
    previewSrcRef.current = null
    const p = paramsRef.current
    const cutsForSeek = p.cuts.filter(c =>
      segs.some((seg, i) => i < segs.length - 1 && Math.abs(c.start - seg[1]) < 0.05)
    )
    const gain = ctx.createGain()
    scheduleGainEvents(gain, ctx, bufOff, buffer.duration, segs, cutsForSeek, p)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = p.speed
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(0, bufOff)
    previewSrcRef.current = source
    previewCtxStartTimeRef.current = ctx.currentTime
    previewTrimDurRef.current = remaining
    wsRef.current?.setTime(originalTime)
    const seekBufOff = bufOff
    function tickSeekCursor() {
      if (!previewCtxRef.current || !previewSrcRef.current) return
      const realElapsed = previewCtxRef.current.currentTime - previewCtxStartTimeRef.current
      const bufElapsed = realElapsed * paramsRef.current.speed
      const t = _bufTimeToOrig(seekBufOff + Math.min(bufElapsed, remaining), previewSegmentsRef.current)
      wsRef.current?.setTime(t)
      previewRafRef.current = requestAnimationFrame(tickSeekCursor)
    }
    previewRafRef.current = requestAnimationFrame(tickSeekCursor)
    source.onended = () => {
      if (previewRafRef.current) { cancelAnimationFrame(previewRafRef.current); previewRafRef.current = null }
      previewSrcRef.current = null
      previewBufferRef.current = null
      previewSegmentsRef.current = []
      setPreviewing(false)
    }
  }

  function toggleWaveform() {
    if (!wsRef.current) return
    stopPreview()
    if (wfPlaying) wsRef.current.pause()
    else { pausePlayer(); wsRef.current.play(params.trim_start, params.trim_end ?? undefined) }
  }

  async function handleDiscard() {
    await deleteEditDraft(songId)
    historyRef.current = []
    redoStackRef.current = []
    setCanUndo(false)
    setCanRedo(false)
    applyParams(DEFAULT_PARAMS)
  }

  function resetToSong(id: string, newRootId: string | null) {
    activeSongIdRef.current = id
    setActiveSongId(id)
    setActiveRootSongId(newRootId)
    setRestoreConfirm(null)
    setParams(DEFAULT_PARAMS)
    historyRef.current = []
    redoStackRef.current = []
    setCanUndo(false)
    setCanRedo(false)
    setJobStatus('idle')
    setWsReady(false)
    setOrigReady(false)
    regionsRef.current?.getRegions().forEach(r => r.remove())
    wsRef.current?.load(`${DOWNLOAD_URL}/${id}`).catch((err: Error) => {
      if (err?.name !== 'AbortError') console.error('WaveSurfer reload:', err)
    })
    wsOrigRef.current?.load(`${DOWNLOAD_URL}/${id}`).catch((err: Error) => {
      if (err?.name !== 'AbortError') console.error('WaveSurfer orig reload:', err)
    })
  }

  async function handleRestoreOriginal() {
    const restoredId = rootSongId ?? songId
    setRestoring(true)
    await removeFromLibrary(activeSongId)
    await addToLibrary(restoredId)
    setRestoring(false)

    resetToSong(restoredId, null)
  }

  async function handleRevertLastSave() {
    if (!parentSongId) return
    setRestoring(true)
    await removeFromLibrary(activeSongId)
    await addToLibrary(parentSongId)
    setRestoring(false)

    resetToSong(parentSongId, null)
  }

  async function handleSave() {
    setJobStatus('submitting')
    setJobError('')
    const job = await createEditJob(songId, stripClientIds(params), overwrite)
    if (!job) { setJobStatus('error'); setJobError('failed to start'); return }
    setJobStatus('polling')
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    let attempts = 0
    pollIntervalRef.current = setInterval(async () => {
      attempts++
      const result = await pollEditJob(job.job_id)
      if (!result || attempts > 60) {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setJobStatus('error')
        setJobError(result?.error ?? 'timed out')
        return
      }
      if (result.status === 'done') {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setJobStatus('done')
        await deleteEditDraft(activeSongIdRef.current)
    
        setWsReady(false)
        setParams(DEFAULT_PARAMS)
        historyRef.current = []
        redoStackRef.current = []
        setCanUndo(false)
        setCanRedo(false)
        regionsRef.current?.getRegions().forEach(r => r.remove())
        const newId = result.result_song_id
        if (!overwrite && newId) {
          activeSongIdRef.current = newId
          setActiveSongId(newId)
          setActiveRootSongId(rootSongId ?? songId)
        }
        const loadId = !overwrite && newId ? newId : activeSongIdRef.current
        wsRef.current?.load(`${DOWNLOAD_URL}/${loadId}`).catch((err: Error) => {
          if (err?.name !== 'AbortError') console.error('WaveSurfer reload:', err)
        })
      }
      if (result.status === 'failed') {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setJobStatus('error')
        setJobError(result.error ?? 'ffmpeg failed')
      }
    }, 1500)
  }

  async function handlePropSave() {
    setPropStatus('saving')
    const ok = await tagSong(songId, props)
    if (ok) { setPropStatus('saved'); setTimeout(() => setPropStatus('idle'), 2000) }
    else setPropStatus('error')
  }

  function paramsChanged(p: EditParams) {
    return p.trim_start !== 0 || p.trim_end !== null || p.volume !== 1 || p.fades.length > 0 || p.speed !== 1 || p.normalize || p.cuts.length > 0
  }

  function handleClose() {
    if (paramsChanged(params) && jobStatus !== 'done' && !localStorage.getItem('sb-skip-draft-banner')) {
      setCloseConfirm(true)
      closeTimerRef.current = setTimeout(() => {
        setCloseConfirm(false)
        router.back()
      }, 2500)
    } else {
      router.back()
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  function handleOrigTimelineMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!wsOrigRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const seek = (clientX: number) => wsOrigRef.current?.seekTo(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)))
    seek(e.clientX)
    const onMove = (me: MouseEvent) => seek(me.clientX)
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleOrigTimelineTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!wsOrigRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const seek = (clientX: number) => wsOrigRef.current?.seekTo(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)))
    seek(e.touches[0].clientX)
    const onMove = (te: TouchEvent) => seek(te.touches[0].clientX)
    const onEnd = () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd) }
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
  }

  function handleTimelineMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!wsRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const seek = (clientX: number) => {
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      wsRef.current?.seekTo(pct)
      if (playheadRef.current) playheadRef.current.style.left = `${pct * 100}%`
    }
    seek(e.clientX)
    const onMove = (me: MouseEvent) => seek(me.clientX)
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleTimelineTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!wsRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const seek = (clientX: number) => {
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      wsRef.current?.seekTo(pct)
      if (playheadRef.current) playheadRef.current.style.left = `${pct * 100}%`
    }
    seek(e.touches[0].clientX)
    const onMove = (te: TouchEvent) => seek(te.touches[0].clientX)
    const onEnd = () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd) }
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
  }

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    setSelectedRegionId(null)
    setAllSelected(false)
    setRegionContextMenu(null)
    if (!wsReady || !duration || !waveRef.current) return
    const rect = waveRef.current.getBoundingClientRect()
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const clickedTime = progress * duration
    if (previewCtxRef.current) {
      seekWebAudioPreview(clickedTime)
      return
    }
    wsRef.current?.seekTo(progress)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement
    const inInput = ['INPUT', 'TEXTAREA'].includes(target.tagName)

    if (e.key === 'Escape') {
      e.preventDefault()
      if (allSelectedRef.current) { setAllSelected(false); return }
      if (selectedRegionIdRef.current) { setSelectedRegionId(null); setRegionContextMenu(null); return }
      handleClose()
      return
    }
    if (!inInput && (e.key === 'Delete' || e.key === 'Backspace') && selectedRegionIdRef.current) {
      e.preventDefault()
      removeSelected()
      return
    }

    if (e.key === ' ' && !inInput) {
      e.preventDefault()
      e.stopPropagation()
      if (activeWaveformRef.current === 'orig') {
        if (origPlaying) wsOrigRef.current?.pause()
        else { pausePlayer(); wsOrigRef.current?.play() }
      } else {
        handlePreview()
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    }
    // copy / cut / paste / select-all for regions
    if (!inInput && (e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      const p = paramsRef.current
      if (p.cuts.length === 0 && p.fades.length === 0) return
      setAllSelected(true)
      setSelectedRegionId(null)
      return
    }
    if (!inInput && (e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault()
      if (allSelectedRef.current) {
        const p = paramsRef.current
        clipboardRef.current = { kind: 'all', cuts: p.cuts.map(c => ({ ...c })), fades: p.fades.map(f => ({ ...f })) }
        if (e.key === 'x') {
          pushHistory(p)
          setParams(prev => ({ ...prev, cuts: [], fades: [] }))
          syncCutRegions([])
          syncFadeRegions([])
          setAllSelected(false)
        }
        return
      }
      const id = selectedRegionIdRef.current
      if (!id || id === 'trim') return
      if (id.startsWith('fade-')) {
        const fade = paramsRef.current.fades.find(f => f.id === id.slice(5))
        if (fade) clipboardRef.current = { kind: 'fade', data: { ...fade } }
      } else {
        const cut = paramsRef.current.cuts.find(c => c.id === id)
        if (cut) clipboardRef.current = { kind: 'cut', data: { ...cut } }
      }
      if (e.key === 'x') removeSelected()
      return
    }
    if (!inInput && (e.metaKey || e.ctrlKey) && e.key === 'v') {
      if (!clipboardRef.current) return
      e.preventDefault()
      executePaste()
      return
    }
    if (!inInput && (e.key === 'j' || e.key === 'k')) {
      e.preventDefault()
      switchToWaveform(e.key === 'k' ? 'orig' : 'edit')
    }
    if (!inInput && (e.key === 'h' || e.key === 'l')) {
      e.preventDefault()
      const SEEK_SEC = 5
      const delta = e.key === 'h' ? -SEEK_SEC : SEEK_SEC
      if (activeWaveformRef.current === 'orig') {
        const ws = wsOrigRef.current
        if (!ws || !origReady) return
        const t = Math.max(0, Math.min(ws.getDuration(), (ws.getCurrentTime() ?? 0) + delta))
        ws.setTime(t)
      } else {
        if (!wsReady || !duration) return
        if (previewing && previewCtxRef.current) {
          const p = paramsRef.current
          const pEnd = p.trim_end ?? duration
          const currentT = wsRef.current?.getCurrentTime() ?? p.trim_start
          const t = Math.max(p.trim_start, Math.min(pEnd, currentT + delta))
          seekWebAudioPreview(t)
        } else {
          const t = Math.max(0, Math.min(duration, (wsRef.current?.getCurrentTime() ?? 0) + delta))
          wsRef.current?.setTime(t)
        }
      }
    }
  }

  // Refresh the fade-handle drag handler every render so the closure is always fresh
  fadeHandleDragRef.current = (e: PointerEvent) => {
    const container = waveRef.current
    if (!container || !wsReadyRef.current) return
    const dur = wsRef.current?.getDuration() ?? 0
    if (!dur) return
    const rect = container.getBoundingClientRect()
    const clickTime = ((e.clientX - rect.left) / rect.width) * dur
    const HIT_SEC = ((e.pointerType === 'touch' ? 32 : 12) / rect.width) * dur
    for (const cut of paramsRef.current.cuts) {
      if (!cut.id) continue
      const fadeOut = cut.fade_out ?? 0
      const fadeIn = cut.fade_in ?? 0
      const foTime = cut.start - fadeOut  // where left triangle is
      const fiTime = cut.end + fadeIn     // where right triangle is
      // Left triangle (fade-out): entire fade zone + small buffer past triangle
      if (clickTime >= foTime - HIT_SEC && clickTime <= cut.start) {
        e.stopPropagation()
        pushHistory(paramsRef.current)
        const cutStart = cut.start
        const cutId = cut.id
        const onMove = (me: PointerEvent) => {
          const t = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)) * dur
          updateCutFade(cutId, 'fade_out', Math.max(0, cutStart - t))
        }
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }
      // Right triangle (fade-in): entire fade zone + small buffer past triangle
      if (clickTime >= cut.end && clickTime <= fiTime + HIT_SEC) {
        e.stopPropagation()
        pushHistory(paramsRef.current)
        const cutEnd = cut.end
        const cutId = cut.id
        const onMove = (me: PointerEvent) => {
          const t = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)) * dur
          updateCutFade(cutId, 'fade_in', Math.max(0, t - cutEnd))
        }
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }
    }
  }

  fadeHandleHoverRef.current = (e: MouseEvent) => {
    const container = waveRef.current
    if (!container || !wsReadyRef.current) return
    const dur = wsRef.current?.getDuration() ?? 0
    if (!dur) return
    const rect = container.getBoundingClientRect()
    const hoverTime = ((e.clientX - rect.left) / rect.width) * dur
    const HIT_SEC = (12 / rect.width) * dur
    let newHov: { cutId: string; side: 'left' | 'right' } | null = null
    for (const cut of paramsRef.current.cuts) {
      if (!cut.id) continue
      const foTime = cut.start - (cut.fade_out ?? 0)
      const fiTime = cut.end + (cut.fade_in ?? 0)
      if (hoverTime >= foTime - HIT_SEC && hoverTime <= cut.start) {
        newHov = { cutId: cut.id, side: 'left' }
        break
      }
      if (hoverTime >= cut.end && hoverTime <= fiTime + HIT_SEC) {
        newHov = { cutId: cut.id, side: 'right' }
        break
      }
    }
    const prev = hoveredFadeRef.current
    const changed = prev?.cutId !== newHov?.cutId || prev?.side !== newHov?.side
    hoveredFadeRef.current = newHov
    const trimEl = regionElemsRef.current.get('trim') as HTMLElement | undefined
    container.style.cursor = newHov ? 'ew-resize' : ''
    if (trimEl) trimEl.style.cursor = newHov ? 'ew-resize' : ''
    if (changed) {
      if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
      waveRafRef.current = requestAnimationFrame(() => {
        if (peaksRef.current && waveCtxRef.current) renderWave(peaksRef.current, waveCtxRef.current)
      })
    }
  }

  const trimEnd = params.trim_end ?? duration
  const resultDuration = trimEnd - params.trim_start
  const artSrc = songArtworkUrl(songId, artworkCached, initialProperties.artworkUrl100, 200)
  const artworkPreviewSrc = props.artworkUrl100 && !artworkPreviewError
    ? artworkUrl(props.artworkUrl100, 200)
    : null

  const btnPrimary = 'px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-40 bg-sky-500 hover:bg-sky-400 text-white'
  const btnGhost = 'text-gray-400 hover:text-sky-500 transition-colors disabled:opacity-30'
  const Kbd = ({ children }: { children: React.ReactNode }) => (
    <kbd className="inline-flex items-center justify-center px-1.5 py-px text-[10px] font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-500 dark:text-gray-400 leading-none">
      {children}
    </kbd>
  )

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="editor-modal"
      className="fixed inset-0 z-50 bg-white dark:bg-gray-950 flex flex-col overflow-y-auto outline-none"
      onClick={() => setRegionContextMenu(null)}
    >
        {/* header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          {artSrc && (
            <Image src={artSrc} alt="" width={36} height={36} className="rounded shrink-0 object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-base">{initialProperties.trackName}</p>
            <p className="text-sm text-sky-500 truncate">{initialProperties.artistName}</p>
            {draftUpdatedAt && (() => {
              const exp = new Date(draftUpdatedAt)
              exp.setDate(exp.getDate() + DRAFT_EXPIRY_DAYS)
              const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000)
              const urgent = daysLeft <= 7
              return (
                <p className={`text-xs mt-0.5 ${urgent ? 'text-orange-400' : 'text-gray-400'}`}>
                  draft expires {exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ({daysLeft > 0 ? `${daysLeft}d left` : 'today'})
                </p>
              )
            })()}
          </div>
          <button onClick={handleClose} data-testid="editor-close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 p-1 ml-1 transition-colors">
            <FaTimes size={13} />
          </button>
        </div>

        {/* close guard */}
        {closeConfirm && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 shrink-0">
            <p className="text-sm text-amber-700 dark:text-amber-400">Draft auto-saved — closing…</p>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => {
                  if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
                  localStorage.setItem('sb-skip-draft-banner', '1')
                  setCloseConfirm(false)
                  router.back()
                }}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                don&apos;t show again
              </button>
            </div>
          </div>
        )}

        {/* tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 shrink-0">
          {(['audio', 'properties'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-sky-500 text-sky-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* audio tab */}
        {tab === 'audio' && (
          <div className="p-4 flex flex-col gap-4">

            {/* original waveform */}
            <div
              className={`rounded-lg border transition-colors cursor-pointer ${activeWaveform === 'orig' ? 'border-sky-500/40' : activeRootSongId && activeRootSongId !== activeSongId ? 'border-amber-400/30' : 'border-gray-100 dark:border-gray-800'}`}
              onClick={() => switchToWaveform('orig')}
            >
              <div className="flex items-center justify-between gap-2 px-2 pt-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${activeRootSongId && activeRootSongId !== activeSongId ? 'text-amber-400' : 'text-gray-400'}`}>
                    {activeRootSongId && activeRootSongId !== activeSongId ? 'prev. edit' : 'original'}
                  </span>
                  {activeRootSongId && activeRootSongId !== activeSongId && (
                    <span className="text-[10px] text-amber-400/60">this song is already an edit</span>
                  )}
                </div>
              </div>
              <div
                className="relative px-2 pb-2"
              >
                <canvas
                  ref={origTimelineCanvasRef}
                  className="w-full h-5 block cursor-pointer select-none"
                  onMouseDown={handleOrigTimelineMouseDown}
                  onTouchStart={handleOrigTimelineTouchStart}
                  onPointerMove={e => {
                    const container = e.currentTarget.parentElement
                    if (!container) return
                    const rect = container.getBoundingClientRect()
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                    const h = container.querySelector<HTMLElement>('[data-orig-hover]')
                    if (h) { h.style.left = `${pct * 100}%`; h.style.display = 'block' }
                  }}
                  onPointerLeave={e => {
                    const h = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-orig-hover]')
                    if (h) h.style.display = 'none'
                  }}
                />
                <div ref={origWaveRef} className="w-full min-h-[80px]" />
                <div
                  data-orig-hover=""
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ display: 'none', left: '0%', width: '1px', background: '#94a3b8', opacity: 0.5 }}
                />
                {!origReady && (
                  <div className="absolute inset-0 flex items-end justify-center gap-px px-2 pb-2 pointer-events-none overflow-hidden">
                    {WAVEFORM_SKELETON.slice(0, 80).map((h, i) => (
                      <div key={i} className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-sm animate-pulse"
                        style={{ height: `${h * 0.6}%`, animationDelay: `${(i % 8) * 60}ms` }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 px-2 pb-2 border-t border-gray-100 dark:border-gray-800 pt-1.5">
                <button
                  onClick={e => { e.stopPropagation(); switchToWaveform('orig'); if (origPlaying) wsOrigRef.current?.pause(); else { pausePlayer(); wsRef.current?.pause(); stopPreview(); wsOrigRef.current?.play() } }}
                  disabled={!origReady}
                  className={`shrink-0 ${origReady ? 'text-sky-500 hover:text-sky-400' : 'text-gray-300 dark:text-gray-700'}`}
                >
                  {origPlaying ? <FaPause size={12} /> : <FaPlay size={12} />}
                </button>
                <span className="text-xs text-gray-400 flex-1">
                  {activeRootSongId && activeRootSongId !== activeSongId ? 'prev. edit · space when focused' : 'original · space when focused'}
                </span>
                {activeRootSongId && activeRootSongId !== activeSongId && (
                  <button
                    onClick={e => { e.stopPropagation(); setRestoreConfirm('original') }}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors shrink-0 border border-amber-400/40 hover:border-amber-300/60 rounded px-2 py-0.5"
                  >
                    restore original
                  </button>
                )}
                {parentSongId && parentSongId !== rootSongId && (
                  <button
                    onClick={e => { e.stopPropagation(); setRestoreConfirm('last') }}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors shrink-0"
                  >
                    revert to last save
                  </button>
                )}
              </div>
            </div>

            {/* edit waveform with fade overlays */}
            <div
              className={`rounded-lg border transition-colors ${activeWaveform === 'edit' ? 'border-sky-500/40' : 'border-gray-100 dark:border-gray-800'}`}
              onClick={() => switchToWaveform('edit')}
            >
              <div className="flex items-center gap-2 px-2 pt-2">
                <span className={`text-xs font-medium ${previewing ? 'text-orange-400' : jobStatus === 'submitting' || jobStatus === 'polling' ? 'text-sky-400' : activeRootSongId ? 'text-amber-400' : 'text-gray-400'}`}>
                  {previewing ? 'preview' : jobStatus === 'submitting' ? 'submitting…' : jobStatus === 'polling' ? 'processing…' : activeRootSongId ? 'edited' : 'edit'}
                </span>
              </div>
              <div className="relative px-2 pb-2">
                {/* DAW-style seek strip + waveform share a relative container so the playhead spans both */}
                <div
                  ref={timelineContainerRef}
                  className="relative"
                >
                  {/* Timeline ruler — tap/drag to seek */}
                  <canvas
                    ref={timelineCanvasRef}
                    className="w-full h-5 block cursor-pointer select-none"
                    onMouseDown={handleTimelineMouseDown}
                    onTouchStart={handleTimelineTouchStart}
                    onPointerMove={e => {
                      const el = timelineContainerRef.current
                      const h = hoverPlayheadRef.current
                      if (!el || !h) return
                      const rect = el.getBoundingClientRect()
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                      h.style.left = `${pct * 100}%`
                      h.style.display = 'block'
                    }}
                    onPointerLeave={() => { if (hoverPlayheadRef.current) hoverPlayheadRef.current.style.display = 'none' }}
                  />
                  <div ref={waveRef} data-testid="waveform" onClick={handleWaveformClick} className="w-full rounded overflow-hidden min-h-[80px] cursor-crosshair" />
                  {/* Playhead — spans ruler + waveform, no pointer events so regions still receive clicks */}
                  <div
                    ref={playheadRef}
                    className="absolute top-0 bottom-0 pointer-events-none z-20"
                    style={{ left: '0%', width: '1px', background: '#38bdf8', opacity: 0.85 }}
                  />
                  {/* Ghost playhead — follows mouse hover */}
                  <div
                    ref={hoverPlayheadRef}
                    className="absolute top-0 bottom-0 pointer-events-none z-19"
                    style={{ display: 'none', left: '0%', width: '1px', background: '#94a3b8', opacity: 0.5 }}
                  />
                </div>
                {!wsReady && (
                  <div className="absolute inset-0 flex items-end justify-center gap-px px-2 pb-2 pointer-events-none overflow-hidden">
                    {WAVEFORM_SKELETON.map((h, i) => (
                      <div key={i} className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-sm animate-pulse"
                        style={{ height: `${h}%`, animationDelay: `${(i % 8) * 60}ms` }} />
                    ))}
                  </div>
                )}
                {(jobStatus === 'submitting' || jobStatus === 'polling') && (
                  <div className="absolute inset-0 flex items-end justify-center gap-px px-2 pb-2 pointer-events-none overflow-hidden rounded bg-gray-950/50">
                    {WAVEFORM_SKELETON.map((h, i) => (
                      <div key={i} className="flex-1 bg-sky-500/40 rounded-sm animate-pulse"
                        style={{ height: `${h}%`, animationDelay: `${(i % 8) * 60}ms` }} />
                    ))}
                  </div>
                )}
              </div>

              {pasteWarning && (
                <div
                  className="mx-2 mt-1 px-3 py-1.5 rounded text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2 cursor-pointer"
                  onClick={() => setPasteWarning(null)}
                >
                  <span>{pasteWarning}</span>
                  <span className="shrink-0 text-amber-400">✕</span>
                </div>
              )}

              {/* transport row inside edit waveform card */}
              <div className="flex items-center gap-3 px-2 pb-2 border-t border-gray-100 dark:border-gray-800 pt-1.5" onClick={e => e.stopPropagation()}>
                <button onClick={() => { switchToWaveform('edit'); handlePreview() }} disabled={!wsReady} title={previewing ? 'stop preview' : 'preview with edits'} className={`shrink-0 ${wsReady ? 'text-sky-500 hover:text-sky-400' : 'text-gray-300 dark:text-gray-700'}`}>
                  {previewing ? <FaPause size={12} /> : <FaPlay size={12} />}
                </button>
                <button
                  onClick={() => setLooping(l => !l)}
                  disabled={!wsReady}
                  title="loop trim region"
                  className={`${btnGhost} shrink-0 ${looping ? 'text-sky-500' : ''}`}
                >
                  <FaSync size={11} />
                </button>
              <span className="text-sm text-gray-400 tabular-nums">
                {fmt(params.trim_start)}–{fmt(trimEnd)}
                <span className="text-gray-300 dark:text-gray-600"> / {fmt(duration)}</span>
              </span>
              {duration > 0 && (
                <span className="text-sm text-gray-400 dark:text-gray-600 tabular-nums">· {fmt(resultDuration)}</span>
              )}
              <div className="flex-1" />
              <button onClick={undo} disabled={!canUndo} title="undo (Ctrl+Z)" className={btnGhost}>
                <FaUndo size={13} />
              </button>
              <button onClick={redo} disabled={!canRedo} title="redo (Ctrl+Shift+Z)" className={btnGhost}>
                <FaRedo size={13} />
              </button>
            </div>
            </div>{/* end edit waveform card */}

            {/* sliders/cuts/actions — clicking any of these keeps edit waveform active */}
            <div className="flex flex-col gap-4" onClick={() => switchToWaveform('edit')}>

            {/* volume · speed · normalize · overwrite */}
            <div className="flex items-center gap-4 flex-wrap text-xs">
              <span className="flex items-center gap-1.5">
                <span className={params.volume !== 1 ? 'text-sky-500' : 'text-gray-400'}>Vol</span>
                <ScrubInput
                  value={params.volume <= 0 ? -Infinity : 20 * Math.log10(params.volume)}
                  min={-40} max={6} step={0.3}
                  format={db => isFinite(db) ? `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB` : '-∞ dB'}
                  parse={s => Math.pow(10, parseFloat(s.replace(/[^0-9.\-+]/g, '')) / 20)}
                  onChange={db => handleSliderChange('volume', Math.pow(10, db / 20))}
                  onStart={handleSliderStart}
                  onCommit={db => { handleSliderCommit(); handleSliderChange('volume', Math.pow(10, db / 20)) }}
                  modified={params.volume !== 1}
                  label="volume"
                />
                {params.volume !== 1 && (
                  <button onClick={() => handleSliderReset('volume', 1)} className="text-[10px] text-gray-400 hover:text-sky-500 transition-colors">↺</button>
                )}
              </span>
              <span className="text-gray-200 dark:text-gray-700 select-none">·</span>
              <span className="flex items-center gap-1.5">
                <span className={params.speed !== 1 ? 'text-sky-500' : 'text-gray-400'}>Speed</span>
                <ScrubInput
                  value={params.speed}
                  min={0.25} max={4} step={0.01}
                  format={v => `${v.toFixed(2)}×`}
                  parse={s => parseFloat(s.replace('×', ''))}
                  onChange={v => handleSliderChange('speed', v)}
                  onStart={handleSliderStart}
                  onCommit={v => { handleSliderCommit(); handleSliderChange('speed', v) }}
                  modified={params.speed !== 1}
                  disabled={!wsReady}
                  label="speed"
                />
                {params.speed !== 1 && (
                  <button onClick={() => handleSliderReset('speed', 1)} className="text-[10px] text-gray-400 hover:text-sky-500 transition-colors">↺</button>
                )}
              </span>
              <span className="text-gray-200 dark:text-gray-700 select-none">·</span>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 text-xs select-none" title="Boost/lower gain so the loudest peak reaches 0 dBFS — maximises loudness without clipping">
                  <input type="checkbox" checked={params.normalize} onChange={e => { pushHistory(paramsRef.current); setParams(prev => { const next = { ...prev, normalize: e.target.checked }; scheduleSave(next); return next }) }} className="accent-sky-500" />
                  <span className={params.normalize ? 'text-sky-500' : 'text-gray-400'}>Normalize</span>
                </label>
                {isAdmin && (
                  <label className="flex items-center gap-1.5 text-xs select-none cursor-pointer">
                    <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-red-500" />
                    <span className={overwrite ? 'text-red-400 font-medium' : 'text-gray-400'}>overwrite original</span>
                  </label>
                )}
              </div>
            </div>

            {/* cuts */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">Cuts</span>
                <button onClick={addCut} disabled={!wsReady} className="text-sm text-sky-500 hover:text-sky-400 transition-colors disabled:opacity-40">+ add cut</button>
              </div>
              {params.cuts.length > 0 && (
                <div className="flex flex-col gap-2">
                  {params.cuts.map(cut => (
                    <div key={cut.id} className="flex flex-col gap-2 bg-red-50 dark:bg-red-950/30 rounded px-2 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <FaCut size={10} className="text-red-400 shrink-0" />
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">{fmt(cut.start)}</span>
                          <span className="text-gray-400 text-xs">–</span>
                          <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">{fmt(cut.end)}</span>
                          <span className="text-gray-400 dark:text-gray-600 text-xs tabular-nums">({fmt(cut.end - cut.start)})</span>
                        </div>
                        {(cut.fade_out > 0 || cut.fade_in > 0) && (
                          <span className="text-[10px] text-red-400 tabular-nums">
                            {cut.fade_out > 0 && `◀${cut.fade_out.toFixed(1)}s`}{cut.fade_out > 0 && cut.fade_in > 0 && ' '}{cut.fade_in > 0 && `${cut.fade_in.toFixed(1)}s▶`}
                          </span>
                        )}
                        <button onClick={() => removeCut(cut.id!)} title="remove cut" className="text-gray-400 hover:text-red-400 transition-colors shrink-0">
                          <FaTimes size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* fades */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">Fades</span>
                <button onClick={() => addFade('in')} disabled={!wsReady} className="text-sm text-sky-500 hover:text-sky-400 transition-colors disabled:opacity-40">+ fade in</button>
                <button onClick={() => addFade('out')} disabled={!wsReady} className="text-sm text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-40">+ fade out</button>
              </div>
              {params.fades.length > 0 && (
                <div className="flex flex-col gap-2">
                  {params.fades.map(fade => {
                    const dur = fade.end - fade.start
                    const isIn = fade.type === 'in'
                    return (
                      <div key={fade.id} className={`flex items-center gap-2 rounded px-2 py-1.5 ${isIn ? 'bg-sky-950/30' : 'bg-amber-950/30'}`}>
                        <span className={`text-xs font-medium shrink-0 ${isIn ? 'text-sky-400' : 'text-amber-400'}`}>{isIn ? 'fade in' : 'fade out'}</span>
                        <div className="flex items-center gap-1 flex-1 min-w-0 text-xs text-gray-500">
                          <span className="tabular-nums">{fmt(fade.start)}</span>
                          <span className="text-gray-400">–</span>
                          <span className="tabular-nums">{fmt(fade.end)}</span>
                          <span className="text-gray-400 dark:text-gray-600 tabular-nums">({dur.toFixed(1)}s)</span>
                        </div>
                        <button onClick={() => removeFade(fade.id!)} className="text-gray-400 hover:text-red-400 transition-colors shrink-0"><FaTimes size={10} /></button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* actions */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button
                onClick={handleSave}
                disabled={!wsReady || jobStatus === 'submitting' || jobStatus === 'polling' || jobStatus === 'done'}
                className={btnPrimary}
              >
                {jobStatus === 'submitting' ? 'Starting…' : jobStatus === 'polling' ? 'Processing…' : jobStatus === 'done' ? 'Saved ✓' : 'Save'}
              </button>
              {jobStatus === 'error' && <span className="text-red-500 text-sm">{jobError}</span>}
              {jobStatus === 'done' && !overwrite && <span className="text-gray-400 text-sm">added to library</span>}
            </div>

            </div>{/* end edit-controls wrapper */}

            {/* keyboard shortcuts panel — inline, above footer */}
            {showShortcuts && (
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-400 dark:text-gray-500 flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1"><Kbd>Space</Kbd> play/pause</span>
                  <span className="flex items-center gap-1"><Kbd>H</Kbd><Kbd>L</Kbd> seek ±5s</span>
                  <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> switch waveform</span>
                  <span className="flex items-center gap-1"><Kbd>Del</Kbd> delete selected</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>Z</Kbd> undo</span>
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>⇧Z</Kbd> redo</span>
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>C</Kbd> copy region</span>
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>X</Kbd> cut region</span>
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>V</Kbd> paste at cursor</span>
                  <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>A</Kbd> cycle regions</span>
                </div>
                <div className="text-gray-500 dark:text-gray-600">drag trim handles · drag cut fades on waveform</div>
              </div>
            )}

            {/* footer */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowShortcuts(s => !s)}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                {showShortcuts ? 'hide shortcuts' : 'keyboard shortcuts'}
              </button>
              <div className="flex items-center gap-3">
                <button onClick={handleDiscard} className="flex items-center gap-1 text-sm text-gray-400 hover:text-red-400 transition-colors">
                  <FaTrash size={11} />
                  discard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* properties tab */}
        {tab === 'properties' && (
          <div className="p-4 flex flex-col gap-3">
            {(
              [
                ['trackName', 'Track name'],
                ['artistName', 'Artist'],
                ['collectionName', 'Album'],
                ['primaryGenreName', 'Genre'],
              ] as [keyof Properties, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="text"
                  value={String(props[key] ?? '')}
                  onChange={e => setProps(p => ({ ...p, [key]: e.target.value }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-transparent focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
                />
              </label>
            ))}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">Artwork URL</span>
              <input
                type="text"
                value={props.artworkUrl100 ?? ''}
                onChange={e => { setProps(p => ({ ...p, artworkUrl100: e.target.value })); setArtworkPreviewError(false) }}
                className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-transparent focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
              />
              {artworkPreviewSrc && (
                <Image src={artworkPreviewSrc} alt="" width={64} height={64} className="rounded-lg mt-1 object-cover" onError={() => setArtworkPreviewError(true)} />
              )}
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => artworkInputRef.current?.click()}
                  disabled={artworkUploadStatus === 'uploading'}
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-sky-500 text-gray-400 hover:text-sky-500 transition-colors disabled:opacity-40"
                >
                  {artworkUploadStatus === 'uploading' ? 'Uploading…' : artworkUploadStatus === 'done' ? 'Uploaded ✓' : 'Upload image'}
                </button>
                {artworkUploadStatus === 'error' && <span className="text-red-400 text-xs">upload failed</span>}
                <input
                  ref={artworkInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file || !songId) return
                    setArtworkUploadStatus('uploading')
                    const ok = await uploadSongArtwork(songId, file)
                    if (ok) {
                      setArtworkUploadStatus('done')
                      setProps(p => ({ ...p, artworkUrl100: `${API_V1}/songs/${songId}/artwork` }))
                      setArtworkPreviewError(false)
                      setTimeout(() => setArtworkUploadStatus('idle'), 3000)
                    } else {
                      setArtworkUploadStatus('error')
                      setTimeout(() => setArtworkUploadStatus('idle'), 3000)
                    }
                  }}
                />
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Track #</span>
                <input
                  type="number"
                  value={props.trackNumber ?? ''}
                  onChange={e => setProps(p => ({ ...p, trackNumber: parseInt(e.target.value) || 0 }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-transparent focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Release date</span>
                <input
                  type="text"
                  value={props.releaseDate ?? ''}
                  onChange={e => setProps(p => ({ ...p, releaseDate: e.target.value }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-transparent focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
                />
              </label>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button onClick={handlePropSave} disabled={propStatus === 'saving'} className={btnPrimary}>
                {propStatus === 'saving' ? 'Saving…' : propStatus === 'saved' ? 'Saved ✓' : 'Save'}
              </button>
              {propStatus === 'error' && <span className="text-red-400 text-xs">save failed</span>}
            </div>
          </div>
        )}

      {/* unified region context menu — trim = add/paste/select-all; cut/fade = copy/cut/paste/remove */}
      {regionContextMenu && (
        <div
          className="fixed z-[70] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] text-sm"
          style={{ left: regionContextMenu.x, top: regionContextMenu.y }}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setRegionContextMenu(null)}
        >
          {(() => {
            const id = regionContextMenu.regionId
            const time = regionContextMenu.time
            if (id === 'trim') {
              return <>
                {time !== undefined && (
                  <div className="px-3 py-1 text-[10px] text-gray-400 border-b border-gray-100 dark:border-gray-800 font-mono tabular-nums">
                    {fmt(time)}
                  </div>
                )}
                <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-red-400 transition-colors"
                  onClick={() => { if (time !== undefined) addCutAtTime(time); setRegionContextMenu(null) }}>Add cut here</button>
                <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-sky-400 transition-colors"
                  onClick={() => { if (time !== undefined) addFadeAtTime(time, 'in'); setRegionContextMenu(null) }}>Fade in from here</button>
                <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-amber-400 transition-colors"
                  onClick={() => { if (time !== undefined) addFadeAtTime(time, 'out'); setRegionContextMenu(null) }}>Fade out to here</button>
                {clipboardRef.current && <>
                  <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                  <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => { executePaste(); setRegionContextMenu(null) }}>Paste</button>
                  {time !== undefined && (
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      onClick={() => { executePaste(time); setRegionContextMenu(null) }}>Paste here</button>
                  )}
                </>}
                {(params.cuts.length > 0 || params.fades.length > 0) && <>
                  <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                  <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => { setAllSelected(true); setSelectedRegionId(null); setRegionContextMenu(null) }}>Select all</button>
                </>}
              </>
            }
            const isFade = id.startsWith('fade-')
            const cut = isFade ? null : paramsRef.current.cuts.find(c => c.id === id)
            const fade = isFade ? paramsRef.current.fades.find(f => f.id === id.slice(5)) : null
            return <>
              <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => {
                if (fade) clipboardRef.current = { kind: 'fade', data: { ...fade } }
                else if (cut) clipboardRef.current = { kind: 'cut', data: { ...cut } }
                setRegionContextMenu(null)
              }}>Copy</button>
              <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => {
                if (fade) clipboardRef.current = { kind: 'fade', data: { ...fade } }
                else if (cut) clipboardRef.current = { kind: 'cut', data: { ...cut } }
                removeSelected(); setRegionContextMenu(null)
              }}>Cut</button>
              {clipboardRef.current && (
                <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => {
                  executePaste(); setRegionContextMenu(null)
                }}>Paste</button>
              )}
              <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
              <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-red-400 transition-colors"
                onClick={() => { removeSelected(); setRegionContextMenu(null) }}>Remove</button>
            </>
          })()}
        </div>
      )}

      {/* restore confirm overlay */}
      {restoreConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRestoreConfirm(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <p className="font-semibold text-base">
                {restoreConfirm === 'original' ? 'Restore original?' : 'Revert to last save?'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {restoreConfirm === 'original'
                  ? 'This removes your edited version from the library and restores the original. Your edits will be lost.'
                  : 'This reverts to your previous saved edit. The current version will be removed from the library.'}
              </p>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setRestoreConfirm(null)}
                className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={restoreConfirm === 'original' ? handleRestoreOriginal : handleRevertLastSave}
                disabled={restoring}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-400 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-40"
              >
                {restoring ? 'Restoring…' : restoreConfirm === 'original' ? 'Yes, restore' : 'Yes, revert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
