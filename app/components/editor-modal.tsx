'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import {
  DOWNLOAD_URL, createEditJob, deleteEditDraft, Cut, EditParams, FadeEdit, fetchEditDraft,
  pollEditJob, Properties, saveEditDraft, songArtworkUrl, tagSong, artworkUrl,
  addToLibrary, removeFromLibrary, uploadSongArtwork, API_V1,
} from '../lib/data'
import { FaPlay, FaPause, FaTimes, FaUndo, FaRedo, FaExternalLinkAlt, FaTrash, FaSync, FaCut } from 'react-icons/fa'
import Image from 'next/image'
import { usePlayer } from './player'
import Slider from './slider'

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

interface Props {
  songId: string
  properties: Properties
  artworkCached?: boolean
  parentSongId?: string | null
  rootSongId?: string | null
  isAdmin: boolean
  editContext?: { label: string; href: string }
  onClose: () => void
  onEditComplete?: () => void
}

export default function EditorModal({
  songId, properties: initialProperties, artworkCached, parentSongId, rootSongId, isAdmin, editContext, onClose, onEditComplete,
}: Props) {
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

  // --- job submit ---
  const [jobStatus, setJobStatus] = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [jobError, setJobError] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  // --- close guard ---
  const [closeConfirm, setCloseConfirm] = useState(false)

  // --- restore ---
  const [restoreConfirm, setRestoreConfirm] = useState<'original' | 'last' | null>(null)
  const [restoring, setRestoring] = useState(false)

  // --- properties tab ---
  const [props, setProps] = useState<Properties>(initialProperties)
  const [propStatus, setPropStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [artworkPreviewError, setArtworkPreviewError] = useState(false)
  const [artworkUploadStatus, setArtworkUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const artworkInputRef = useRef<HTMLInputElement>(null)

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
  useEffect(() => {
    paramsRef.current = params
    trimParamsRef.current = { trim_start: params.trim_start, trim_end: params.trim_end }
  }, [params])

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
      waveColor: '#475569',
      progressColor: '#38bdf8',
      cursorColor: '#38bdf8',
      height: 80,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regions],
      fetchParams: { credentials: 'include' },
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
        color: 'rgba(56,189,248,0.12)', drag: false, resize: true,
      })
      p.cuts.forEach(cut => {
        regions.addRegion({
          id: cut.id ?? crypto.randomUUID(),
          start: cut.start, end: cut.end,
          color: 'rgba(239,68,68,0.15)', drag: true, resize: true,
        })
      })
      p.fades.forEach(fade => {
        regions.addRegion({
          id: `fade-${fade.id ?? crypto.randomUUID()}`,
          start: fade.start, end: fade.end,
          color: fade.type === 'in' ? 'rgba(56,189,248,0.18)' : 'rgba(251,191,36,0.18)',
          drag: true, resize: true,
        })
      })
      programmaticRegionRef.current = false
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
    regions.on('region-update', r => {
      if (programmaticRegionRef.current) return
      if (r.id !== 'trim' && !r.id.startsWith('fade-')) {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const trimEnd = prev.trim_end ?? duration
          const start = Math.max(trimStart, r.start)
          const end = Math.min(trimEnd, r.end)
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
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const next = { ...prev, trim_start: r.start, trim_end: r.end }
          scheduleSave(next)
          return next
        })
      } else if (r.id.startsWith('fade-')) {
        const fadeId = r.id.slice(5)
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const trimStart = prev.trim_start
          const trimEnd = prev.trim_end ?? duration
          const { start, end } = _clampFadeNoOverlap(prev.fades, prev.cuts, fadeId,
            Math.max(trimStart, r.start), Math.min(trimEnd, r.end), trimStart, trimEnd)
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
          const trimEnd = prev.trim_end ?? duration
          const { start, end } = _clampCutNoOverlap(prev.cuts, r.id, r.start, r.end, trimStart, trimEnd)
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
      const snapshot = regionPreDragRef.current
      if (!snapshot) return
      regionPreDragRef.current = null
      pushHistory(snapshot)
    }
    window.addEventListener('mouseup', handleRegionDragEnd)
    window.addEventListener('touchend', handleRegionDragEnd)

    return () => {
      window.removeEventListener('mouseup', handleRegionDragEnd)
      window.removeEventListener('touchend', handleRegionDragEnd)
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
      wsRef.current = null
      regionsRef.current = null
      ws.destroy()
    }
  }, [songId, scheduleSave])

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
        color: fade.type === 'in' ? 'rgba(56,189,248,0.18)' : 'rgba(251,191,36,0.18)',
        drag: true, resize: true,
      })
    })
    programmaticRegionRef.current = false
  }

  function applyParams(p: EditParams) {
    setParams(p)
    const region = regionsRef.current?.getRegions().find(r => r.id === 'trim')
    if (region && duration > 0) region.setOptions({ start: p.trim_start, end: p.trim_end ?? duration, drag: false })
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
    regionsRef.current?.addRegion({ id, start, end, color: 'rgba(239,68,68,0.15)', drag: true, resize: true })
    setParams(prev => ({ ...prev, cuts: [...prev.cuts, { id, start, end, fade_in: 0, fade_out: 0 }] }))
  }

  function removeCut(id: string) {
    pushHistory(paramsRef.current)
    regionsRef.current?.getRegions().find(r => r.id === id)?.remove()
    setParams(prev => ({ ...prev, cuts: prev.cuts.filter(c => c.id !== id) }))
  }

  function updateCutFade(id: string, key: 'fade_in' | 'fade_out', value: number) {
    setParams(prev => {
      const next = { ...prev, cuts: prev.cuts.map(c => c.id === id ? { ...c, [key]: value } : c) }
      scheduleSave(next)
      return next
    })
  }

  function _clampCutNoOverlap(cuts: Cut[], id: string, start: number, end: number, trimStart: number, trimEnd: number): { start: number; end: number } {
    start = Math.max(trimStart, start)
    end = Math.min(trimEnd, end)
    for (const other of cuts) {
      if (other.id === id) continue
      if (start < other.end && end > other.start) {
        const myMid = (start + end) / 2
        const otherMid = (other.start + other.end) / 2
        if (myMid <= otherMid) {
          end = Math.min(end, other.start)
          if (end < start + 0.05) end = start + 0.05
        } else {
          start = Math.max(start, other.end)
          if (start > end - 0.05) start = end - 0.05
        }
      }
    }
    return { start, end }
  }

  function _clampFadeNoOverlap(
    fades: FadeEdit[], cuts: Cut[], id: string,
    start: number, end: number, trimStart: number, trimEnd: number,
  ): { start: number; end: number } {
    start = Math.max(trimStart, start)
    end = Math.min(trimEnd, end)
    if (end < start + 0.05) end = start + 0.05
    for (const f of fades) {
      if (f.id === id) continue
      if (start < f.end && end > f.start) {
        const myMid = (start + end) / 2
        const fMid = (f.start + f.end) / 2
        if (myMid <= fMid) { end = Math.min(end, f.start); if (end < start + 0.05) end = start + 0.05 }
        else { start = Math.max(start, f.end); if (start > end - 0.05) start = end - 0.05 }
      }
    }
    for (const c of cuts) {
      if (start < c.end && end > c.start) {
        const myMid = (start + end) / 2
        const cMid = (c.start + c.end) / 2
        if (myMid <= cMid) { end = Math.min(end, c.start); if (end < start + 0.05) end = start + 0.05 }
        else { start = Math.max(start, c.end); if (start > end - 0.05) start = end - 0.05 }
      }
    }
    return { start, end }
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
    const color = type === 'in' ? 'rgba(56,189,248,0.18)' : 'rgba(251,191,36,0.18)'
    regionsRef.current?.addRegion({ id: `fade-${id}`, start, end, color, drag: true, resize: true })
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

  function updateFadeDuration(id: string, newDur: number) {
    setParams(prev => {
      const fade = prev.fades.find(f => f.id === id)
      if (!fade) return prev
      const trimStart = prev.trim_start
      const trimEnd = prev.trim_end ?? duration
      let { start, end } = fade
      if (fade.type === 'in') {
        end = start + newDur
        for (const o of [...prev.fades, ...prev.cuts]) {
          if (o.id === id) continue
          if (o.start >= start && end > o.start) end = Math.min(end, o.start)
        }
        end = Math.min(trimEnd, end)
      } else {
        start = end - newDur
        for (const o of [...prev.fades, ...prev.cuts]) {
          if (o.id === id) continue
          if (o.end <= end && start < o.end) start = Math.max(start, o.end)
        }
        start = Math.max(trimStart, start)
      }
      const region = regionsRef.current?.getRegions().find(r => r.id === `fade-${id}`)
      if (region) {
        programmaticRegionRef.current = true
        region.setOptions({ start, end })
        programmaticRegionRef.current = false
      }
      const next = { ...prev, fades: prev.fades.map(f => f.id === id ? { ...f, start, end } : f) }
      scheduleSave(next)
      return next
    })
  }

  // (updateCutTime removed — cut timing is GUI-only via waveform drag)

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
    onEditComplete?.()
    resetToSong(restoredId, null)
  }

  async function handleRevertLastSave() {
    if (!parentSongId) return
    setRestoring(true)
    await removeFromLibrary(activeSongId)
    await addToLibrary(parentSongId)
    setRestoring(false)
    onEditComplete?.()
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
        onEditComplete?.()
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
    if (paramsChanged(params) && jobStatus !== 'done') {
      setCloseConfirm(true)
    } else {
      onClose()
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
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

    if (e.key === 'Escape') { e.preventDefault(); handleClose(); return }

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-testid="editor-modal"
        className="bg-white dark:bg-gray-950 border border-gray-100 dark:border-gray-800 w-full sm:rounded-xl sm:max-w-3xl lg:max-w-4xl sm:max-h-[92vh] h-full sm:h-auto overflow-y-auto flex flex-col outline-none"
        onClick={e => e.stopPropagation()}
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
          {editContext && (
            <a
              href={editContext.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-sky-500 transition-colors shrink-0"
              title={`open ${editContext.label}`}
            >
              <span className="hidden sm:inline">{editContext.label}</span>
              <FaExternalLinkAlt size={10} />
            </a>
          )}
          <button onClick={handleClose} data-testid="editor-close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 p-1 ml-1 transition-colors">
            <FaTimes size={13} />
          </button>
        </div>

        {/* close guard */}
        {closeConfirm && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 shrink-0">
            <p className="text-sm text-amber-700 dark:text-amber-400">Draft auto-saved. Close without saving new version?</p>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={onClose} className="text-sm text-red-500 hover:text-red-400 transition-colors">close anyway</button>
              <button onClick={() => setCloseConfirm(false)} className="text-sm text-gray-500 hover:text-gray-400 transition-colors">cancel</button>
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
              <div className="relative px-2 pb-2">
                <div ref={origWaveRef} className="w-full min-h-[80px]" />
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
                <div ref={waveRef} data-testid="waveform" onClick={handleWaveformClick} className="w-full rounded overflow-hidden min-h-[80px] cursor-crosshair" />
                {!wsReady && (
                  <div className="absolute inset-0 flex items-end justify-center gap-px px-2 pb-2 pointer-events-none overflow-hidden">
                    {WAVEFORM_SKELETON.map((h, i) => (
                      <div key={i} className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-sm animate-pulse"
                        style={{ height: `${h}%`, animationDelay: `${(i % 8) * 60}ms` }} />
                    ))}
                  </div>
                )}
                {duration > 0 && <>
                  {/* trim zone darkness */}
                  {params.trim_start > 0 && (
                    <div className="absolute inset-y-0 left-0 bg-black/50 pointer-events-none" style={{ width: `${(params.trim_start / duration) * 100}%` }} />
                  )}
                  {(params.trim_end !== null && params.trim_end < duration) && (
                    <div className="absolute inset-y-0 right-0 bg-black/50 pointer-events-none" style={{ width: `${((duration - params.trim_end) / duration) * 100}%` }} />
                  )}
                  {/* cut darkness */}
                  {params.cuts.map(cut => (
                    <div key={`dark-${cut.id}`} className="absolute inset-y-0 bg-black/50 pointer-events-none" style={{
                      left: `${(cut.start / duration) * 100}%`,
                      width: `${((cut.end - cut.start) / duration) * 100}%`,
                    }} />
                  ))}
                  {/* fade overlays */}
                  {params.fades.map(fade => {
                    const left = `${(fade.start / duration) * 100}%`
                    const width = `${((fade.end - fade.start) / duration) * 100}%`
                    const isIn = fade.type === 'in'
                    return (
                      <React.Fragment key={fade.id}>
                        <div
                          className={`absolute inset-y-0 pointer-events-none from-black/50 to-transparent ${isIn ? 'bg-gradient-to-r' : 'bg-gradient-to-l'}`}
                          style={{ left, width }}
                        />
                        <div className="absolute inset-y-0 pointer-events-none" style={{
                          left, width,
                          background: isIn ? 'rgba(56,189,248,0.18)' : 'rgba(251,191,36,0.18)',
                          clipPath: isIn
                            ? 'polygon(0% 50%, 100% 0%, 100% 100%)'
                            : 'polygon(0% 0%, 0% 100%, 100% 50%)',
                        }} />
                      </React.Fragment>
                    )
                  })}
                </>}
                {(jobStatus === 'submitting' || jobStatus === 'polling') && (
                  <div className="absolute inset-0 flex items-end justify-center gap-px px-2 pb-2 pointer-events-none overflow-hidden rounded bg-gray-950/50">
                    {WAVEFORM_SKELETON.map((h, i) => (
                      <div key={i} className="flex-1 bg-sky-500/40 rounded-sm animate-pulse"
                        style={{ height: `${h}%`, animationDelay: `${(i % 8) * 60}ms` }} />
                    ))}
                  </div>
                )}
                {duration > 0 && params.cuts.map(cut => (
                  <React.Fragment key={cut.id}>
                    {cut.fade_out > 0 && (
                      <div className="absolute inset-y-0 bg-red-400/25 pointer-events-none" style={{
                        left: `${Math.max(0, (cut.start - cut.fade_out) / duration) * 100}%`,
                        width: `${(cut.fade_out / duration) * 100}%`,
                        clipPath: 'polygon(0% 0%, 0% 100%, 100% 50%)',
                      }} />
                    )}
                    {cut.fade_in > 0 && (
                      <div className="absolute inset-y-0 bg-red-400/25 pointer-events-none" style={{
                        left: `${(cut.end / duration) * 100}%`,
                        width: `${(cut.fade_in / duration) * 100}%`,
                        clipPath: 'polygon(0% 50%, 100% 0%, 100% 100%)',
                      }} />
                    )}
                  </React.Fragment>
                ))}
              </div>

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
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-28 flex-1">
                <span className="text-xs flex justify-between items-center">
                  <span className={params.volume !== 1 ? 'text-sky-500' : 'text-gray-400'}>Vol</span>
                  <span className="flex items-center gap-1.5">
                    {params.volume !== 1 && <button onClick={() => handleSliderReset('volume', 1)} className="text-[10px] text-gray-400 hover:text-sky-500 transition-colors">reset</button>}
                    <span className={`tabular-nums ${params.volume !== 1 ? 'text-sky-500' : 'text-gray-400 dark:text-gray-600'}`}>{Math.round(params.volume * 100)}%</span>
                  </span>
                </span>
                <Slider value={params.volume} min={0} max={2} step={0.05} onChange={v => handleSliderChange('volume', v)} onStart={handleSliderStart} onCommit={handleSliderCommit} label="volume" />
              </div>
              <div className="flex flex-col gap-1.5 min-w-28 flex-1">
                <span className="text-xs flex justify-between items-center">
                  <span className={params.speed !== 1 ? 'text-sky-500' : 'text-gray-400'}>Speed</span>
                  <span className="flex items-center gap-1.5">
                    {params.speed !== 1 && <button onClick={() => handleSliderReset('speed', 1)} className="text-[10px] text-gray-400 hover:text-sky-500 transition-colors">reset</button>}
                    <span className={`tabular-nums ${params.speed !== 1 ? 'text-sky-500' : 'text-gray-400 dark:text-gray-600'}`}>{params.speed.toFixed(2)}×</span>
                  </span>
                </span>
                <Slider value={params.speed} min={0.25} max={4} step={0.05} onChange={v => handleSliderChange('speed', v)} onStart={handleSliderStart} onCommit={handleSliderCommit} disabled={!wsReady} label="speed" />
              </div>
              <div className="flex items-center gap-3 pb-0.5 shrink-0">
                <label className="flex items-center gap-1.5 text-xs select-none" title="Boost/lower gain so the loudest peak reaches 0 dBFS — maximises loudness without clipping">
                  <input type="checkbox" checked={params.normalize} onChange={e => { pushHistory(paramsRef.current); setParams(prev => { const next = { ...prev, normalize: e.target.checked }; scheduleSave(next); return next }) }} className="accent-sky-500" />
                  <span className={params.normalize ? 'text-sky-500' : 'text-gray-400'}>Normalize</span>
                </label>
                {isAdmin && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 select-none">
                    <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-sky-500" />
                    overwrite
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
                  {params.cuts.map(cut => {
                    const sorted = [...params.cuts].sort((a, b) => a.start - b.start)
                    const idx = sorted.findIndex(c => c.id === cut.id)
                    const trimStart = params.trim_start
                    const trimEnd = params.trim_end ?? duration
                    const prev = idx > 0 ? sorted[idx - 1] : null
                    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
                    const maxFadeOut = Math.min(5, Math.max(0, cut.start - Math.max(trimStart, prev ? prev.end + prev.fade_in : trimStart)))
                    const maxFadeIn = Math.min(5, Math.max(0, Math.min(trimEnd, next ? next.start - next.fade_out : trimEnd) - cut.end))
                    return (
                    <div key={cut.id} className="flex flex-col gap-2 bg-red-50 dark:bg-red-950/30 rounded px-2 py-2">
                      {/* header row: icon + time display + duration + remove */}
                      <div className="flex items-center gap-2 text-sm">
                        <FaCut size={10} className="text-red-400 shrink-0" />
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">{fmt(cut.start)}</span>
                          <span className="text-gray-400 text-xs">–</span>
                          <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">{fmt(cut.end)}</span>
                          <span className="text-gray-400 dark:text-gray-600 text-xs tabular-nums">({fmt(cut.end - cut.start)})</span>
                        </div>
                        <button onClick={() => removeCut(cut.id!)} title="remove cut" className="text-gray-400 hover:text-red-400 transition-colors shrink-0">
                          <FaTimes size={10} />
                        </button>
                      </div>
                      {/* per-cut fades */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs flex justify-between">
                            <span className={cut.fade_out > 0 ? 'text-red-400' : 'text-gray-400'}>fade before</span>
                            <span className={`tabular-nums ${cut.fade_out > 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-600'}`}>{cut.fade_out.toFixed(1)}s</span>
                          </span>
                          <Slider
                            value={Math.min(cut.fade_out, maxFadeOut)} min={0} max={maxFadeOut} step={0.1}
                            onChange={v => updateCutFade(cut.id!, 'fade_out', v)}
                            disabled={maxFadeOut === 0}
                            label="fade before cut"
                          />
                          {maxFadeOut === 0 && <span className="text-[10px] text-gray-400">no room — move cut</span>}
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs flex justify-between">
                            <span className={cut.fade_in > 0 ? 'text-red-400' : 'text-gray-400'}>fade after</span>
                            <span className={`tabular-nums ${cut.fade_in > 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-600'}`}>{cut.fade_in.toFixed(1)}s</span>
                          </span>
                          <Slider
                            value={Math.min(cut.fade_in, maxFadeIn)} min={0} max={maxFadeIn} step={0.1}
                            onChange={v => updateCutFade(cut.id!, 'fade_in', v)}
                            disabled={maxFadeIn === 0}
                            label="fade after cut"
                          />
                          {maxFadeIn === 0 && <span className="text-[10px] text-gray-400">no room — move cut</span>}
                        </div>
                      </div>
                    </div>
                    )
                  })}
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
                    const trimStart = params.trim_start
                    const trimEnd = params.trim_end ?? duration
                    // max duration: from fade.start to nearest obstacle (or trim boundary)
                    let maxDur = isIn
                      ? Math.min(5, trimEnd - fade.start)
                      : Math.min(5, fade.end - trimStart)
                    for (const o of [...params.fades, ...params.cuts]) {
                      if (o.id === fade.id) continue
                      if (isIn && o.start >= fade.start) maxDur = Math.min(maxDur, o.start - fade.start)
                      if (!isIn && o.end <= fade.end) maxDur = Math.min(maxDur, fade.end - o.end)
                    }
                    maxDur = Math.max(0.5, maxDur)
                    return (
                      <div key={fade.id} className={`flex flex-col gap-2 rounded px-2 py-2 ${isIn ? 'bg-sky-950/30' : 'bg-amber-950/30'}`}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className={`text-xs font-medium ${isIn ? 'text-sky-400' : 'text-amber-400'}`}>{isIn ? 'fade in' : 'fade out'}</span>
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <span className="tabular-nums text-xs text-gray-500">{fmt(fade.start)}</span>
                            <span className="text-gray-400 text-xs">–</span>
                            <span className="tabular-nums text-xs text-gray-500">{fmt(fade.end)}</span>
                            <span className="text-gray-400 dark:text-gray-600 text-xs tabular-nums">({dur.toFixed(1)}s)</span>
                          </div>
                          <button onClick={() => removeFade(fade.id!)} className="text-gray-400 hover:text-red-400 transition-colors shrink-0"><FaTimes size={10} /></button>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs flex justify-between">
                            <span className={isIn ? 'text-sky-400' : 'text-amber-400'}>duration</span>
                            <span className={`tabular-nums ${isIn ? 'text-sky-400' : 'text-amber-400'}`}>{dur.toFixed(1)}s</span>
                          </span>
                          <Slider
                            value={Math.min(dur, maxDur)} min={0.5} max={maxDur} step={0.1}
                            onChange={v => updateFadeDuration(fade.id!, v)}
                            onStart={handleSliderStart}
                            onCommit={handleSliderCommit}
                            label={isIn ? 'fade in duration' : 'fade out duration'}
                          />
                        </div>
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

            {/* footer */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 flex-wrap">
                drag handles to trim ·
                <Kbd>Space</Kbd> play ·
                <Kbd>H</Kbd><Kbd>L</Kbd> seek ·
                <Kbd>J</Kbd><Kbd>K</Kbd> switch waveform ·
                <Kbd>Ctrl</Kbd><Kbd>Z</Kbd> undo ·
                <Kbd>Ctrl</Kbd><Kbd>⇧Z</Kbd> redo
              </p>
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
      </div>

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
