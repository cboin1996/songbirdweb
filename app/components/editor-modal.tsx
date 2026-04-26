'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import {
  BASE_URL, createEditJob, deleteEditDraft, Cut, EditParams, fetchEditDraft,
  pollEditJob, Properties, saveEditDraft, songArtworkUrl, tagSong, artworkUrl,
  addToLibrary, removeFromLibrary,
} from '../lib/data'
import { FaPlay, FaPause, FaTimes, FaUndo, FaRedo, FaExternalLinkAlt, FaTrash, FaSync, FaCut } from 'react-icons/fa'
import Image from 'next/image'
import { usePlayer } from './player'

type Tab = 'audio' | 'properties'

function Slider({ value, min, max, step, onChange, onStart, onCommit, disabled, label }: {
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void; onStart?: () => void; onCommit?: () => void; disabled?: boolean; label?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`relative flex items-center h-5 group ${disabled ? 'opacity-30' : 'cursor-pointer'}`}>
      <div className="absolute inset-x-0 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full">
        <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="absolute w-2.5 h-2.5 bg-sky-500 rounded-full -translate-x-1/2 pointer-events-none"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-label={label}
        onMouseDown={onStart} onTouchStart={onStart}
        onChange={e => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit}
        className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default"
      />
    </div>
  )
}

const DEFAULT_PARAMS: EditParams = {
  trim_start: 0,
  trim_end: null,
  volume: 1.0,
  fade_in: 0,
  fade_out: 0,
  speed: 1.0,
  normalize: false,
  cuts: [],
}

function stripCutIds(params: EditParams): EditParams {
  return { ...params, cuts: params.cuts.map(({ start, end, fade_in, fade_out }) => ({ start, end, fade_in, fade_out })) }
}

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

  // --- undo/redo ---
  const historyRef = useRef<EditParams[]>([])
  const redoStackRef = useRef<EditParams[]>([])
  const paramsRef = useRef<EditParams>(DEFAULT_PARAMS)
  const pendingSnapshotRef = useRef<EditParams | null>(null)
  const regionPreDragRef = useRef<EditParams | null>(null)
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
  const [zoom, setZoom] = useState(0) // 0 = auto-fit to container
  const loopingRef = useRef(false)
  const trimParamsRef = useRef({ trim_start: 0, trim_end: null as number | null })

  // --- preview (Web Audio) ---
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)
  const [previewing, setPreviewing] = useState(false)
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

  // focus modal on mount so Space key is captured
  useEffect(() => { modalRef.current?.focus() }, [])

  // stop editor audio when global player starts
  useEffect(() => {
    if (playerIsPlaying) {
      wsRef.current?.pause()
      stopPreview()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIsPlaying])

  // load draft on open
  useEffect(() => {
    fetchEditDraft(songId).then(draft => {
      if (draft) {
        const cuts: Cut[] = (draft.cuts ?? []).map(c => ({ ...c, fade_in: c.fade_in ?? 0, fade_out: c.fade_out ?? 0, id: crypto.randomUUID() }))
        const p = { ...draft, cuts }
        setParams(p)
        if (wsReadyRef.current) syncCutRegions(cuts)
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
    saveTimerRef.current = setTimeout(() => saveEditDraft(songId, stripCutIds(p)), 1000)
  }, [songId])

  // init WaveSurfer
  useEffect(() => {
    if (!waveRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: '#475569',
      progressColor: '#475569',
      cursorColor: '#38bdf8',
      height: 112,
      plugins: [regions],
      fetchParams: { credentials: 'include' },
    })
    wsRef.current = ws
    ws.load(`${BASE_URL}/download/${songId}`).catch((err: Error) => {
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
    regions.on('region-updated', r => {
      if (programmaticRegionRef.current) return
      if (r.id === 'trim') {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const next = { ...prev, trim_start: r.start, trim_end: r.end }
          scheduleSave(next)
          return next
        })
      } else {
        setParams(prev => {
          if (!regionPreDragRef.current) regionPreDragRef.current = prev
          const next = { ...prev, cuts: prev.cuts.map(c => c.id === r.id ? { ...c, start: r.start, end: r.end } : c) }
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
      wsRef.current = null
      regionsRef.current = null
      ws.destroy()
    }
  }, [songId, scheduleSave])

  // sync volume — clamp to [0,1] since HTMLMediaElement.volume only accepts that range
  useEffect(() => { wsRef.current?.setVolume(Math.min(1, params.volume)) }, [params.volume])

  // sync zoom
  useEffect(() => { if (wsReady) wsRef.current?.zoom(zoom) }, [zoom, wsReady])

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
    regionsRef.current.getRegions().filter(r => r.id !== 'trim').forEach(r => r.remove())
    cuts.forEach(cut => {
      regionsRef.current!.addRegion({
        id: cut.id ?? crypto.randomUUID(),
        start: cut.start, end: cut.end,
        color: 'rgba(239,68,68,0.15)', drag: true, resize: true,
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
  }

  function addCut() {
    if (!wsReady || !duration) return
    const center = wsRef.current?.getCurrentTime() ?? duration / 2
    const start = Math.max(0, Math.min(duration - 2, center - 1))
    const end = Math.min(duration, start + 2)
    const id = crypto.randomUUID()
    pushHistory(paramsRef.current)
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

  function stopPreview() {
    const wasWebAudio = previewSrcRef.current !== null
    previewSrcRef.current?.stop()
    previewCtxRef.current?.close()
    previewSrcRef.current = null
    previewCtxRef.current = null
    if (!wasWebAudio && wsPreviewRef.current) wsRef.current?.pause()
    wsPreviewRef.current = false
    setPreviewing(false)
  }

  async function handlePreview() {
    if (previewing) { stopPreview(); return }
    wsRef.current?.pause()
    pausePlayer()

    const hasCuts = params.cuts.length > 0

    if (!hasCuts) {
      // Native WaveSurfer playback — identical quality to pressing play
      wsRef.current?.setVolume(params.volume)
      wsRef.current?.play(params.trim_start, params.trim_end ?? undefined)
      wsPreviewRef.current = true
      setPreviewing(true)
      return
    }

    // Web Audio: splice out cut segments
    const raw = wsRef.current?.getDecodedData()
    if (!raw) return
    const ctx = new AudioContext({ sampleRate: raw.sampleRate })
    if (ctx.state === 'suspended') await ctx.resume()

    const sr = raw.sampleRate
    const startFrame = Math.floor(params.trim_start * sr)
    const endFrame = params.trim_end !== null ? Math.floor(params.trim_end * sr) : raw.length

    const cutsInRange = [...params.cuts]
      .filter(c => c.end > params.trim_start && c.start < (params.trim_end ?? duration))
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

    const source = ctx.createBufferSource()
    source.buffer = trimmed
    const gain = ctx.createGain()
    const now = ctx.currentTime
    const trimDur = totalFrames / sr

    gain.gain.setValueAtTime(params.fade_in > 0 ? 0 : params.volume, now)
    if (params.fade_in > 0) gain.gain.linearRampToValueAtTime(params.volume, now + params.fade_in)
    if (params.fade_out > 0) {
      gain.gain.setValueAtTime(params.volume, now + Math.max(0, trimDur - params.fade_out))
      gain.gain.linearRampToValueAtTime(0, now + trimDur)
    }

    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
    previewSrcRef.current = source
    previewCtxRef.current = ctx
    setPreviewing(true)
    source.onended = () => { previewSrcRef.current = null; previewCtxRef.current = null; setPreviewing(false) }
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

  async function handleRestoreOriginal() {
    if (!rootSongId) return
    setRestoring(true)
    await removeFromLibrary(songId)
    await addToLibrary(rootSongId)
    setRestoring(false)
    onEditComplete?.()
    onClose()
  }

  async function handleRevertLastSave() {
    if (!parentSongId) return
    setRestoring(true)
    await removeFromLibrary(songId)
    await addToLibrary(parentSongId)
    setRestoring(false)
    onEditComplete?.()
    onClose()
  }

  async function handleSave() {
    setJobStatus('submitting')
    setJobError('')
    const job = await createEditJob(songId, stripCutIds(params), overwrite)
    if (!job) { setJobStatus('error'); setJobError('failed to start'); return }
    setJobStatus('polling')
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      const result = await pollEditJob(job.job_id)
      if (!result || attempts > 60) {
        clearInterval(interval)
        setJobStatus('error')
        setJobError(result?.error ?? 'timed out')
        return
      }
      if (result.status === 'done') {
        clearInterval(interval)
        setJobStatus('done')
        await deleteEditDraft(songId)
        onEditComplete?.()
        if (overwrite) {
          setWsReady(false)
          setParams(DEFAULT_PARAMS)
          historyRef.current = []
          setCanUndo(false)
          regionsRef.current?.getRegions().forEach(r => r.remove())
          wsRef.current?.load(`${BASE_URL}/download/${songId}`).catch((err: Error) => {
            if (err?.name !== 'AbortError') console.error('WaveSurfer reload:', err)
          })
        }
      }
      if (result.status === 'failed') {
        clearInterval(interval)
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
    return p.trim_start !== 0 || p.trim_end !== null || p.volume !== 1 || p.fade_in !== 0 || p.fade_out !== 0 || p.speed !== 1 || p.normalize || p.cuts.length > 0
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
    wsRef.current?.seekTo(progress)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement
    const inInput = ['INPUT', 'TEXTAREA'].includes(target.tagName)

    if (e.key === 'Escape') { e.preventDefault(); handleClose(); return }

    if (e.key === ' ' && !inInput) {
      e.preventDefault()
      e.stopPropagation()
      if (previewing) stopPreview()
      else toggleWaveform()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    }
    if (!inInput && wsReady && duration) {
      const SEEK_SEC = 5
      if (e.key === 'h') {
        e.preventDefault()
        const t = Math.max(0, (wsRef.current?.getCurrentTime() ?? 0) - SEEK_SEC)
        wsRef.current?.setTime(t)
      }
      if (e.key === 'l') {
        e.preventDefault()
        const t = Math.min(duration, (wsRef.current?.getCurrentTime() ?? 0) + SEEK_SEC)
        wsRef.current?.setTime(t)
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
            {/* waveform with fade overlays */}
            <div className="relative">
              <div ref={waveRef} data-testid="waveform" onClick={handleWaveformClick} className="w-full rounded-lg overflow-hidden bg-white dark:bg-gray-950 min-h-[112px] cursor-crosshair" />
              <span data-testid="version-badge" className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded pointer-events-none select-none font-medium ${rootSongId ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {rootSongId ? 'edited' : 'original'}
              </span>
              {!wsReady && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-sky-500 animate-spin" />
                </div>
              )}
              {duration > 0 && params.fade_in > 0 && (
                <div
                  className="absolute inset-y-0 bg-sky-400/25 pointer-events-none"
                  style={{
                    left: `${(params.trim_start / duration) * 100}%`,
                    width: `${Math.min(100, (params.fade_in / duration) * 100)}%`,
                    clipPath: 'polygon(0% 50%, 100% 0%, 100% 100%)',
                  }}
                />
              )}
              {duration > 0 && params.fade_out > 0 && (
                <div
                  className="absolute inset-y-0 bg-sky-400/25 pointer-events-none"
                  style={{
                    right: `${((duration - trimEnd) / duration) * 100}%`,
                    width: `${Math.min(100, (params.fade_out / duration) * 100)}%`,
                    clipPath: 'polygon(0% 0%, 0% 100%, 100% 50%)',
                  }}
                />
              )}
            </div>

            {/* transport row */}
            <div className="flex items-center gap-3">
              <button onClick={toggleWaveform} disabled={!wsReady} title={wfPlaying ? 'pause' : 'play'} className={`shrink-0 ${wsReady ? 'text-sky-500 hover:text-sky-400' : 'text-gray-300 dark:text-gray-700'}`}>
                {wfPlaying ? <FaPause size={14} /> : <FaPlay size={14} />}
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

            {/* zoom */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400 shrink-0">zoom</span>
              <Slider value={zoom} min={0} max={400} step={10} onChange={setZoom} disabled={!wsReady} label="zoom" />
            </div>

            {/* sliders */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {([
                ['volume', 'Volume', 0, 2, 0.05, `${Math.round(params.volume * 100)}%`, params.volume !== 1],
                ['fade_in', 'Fade in', 0, 15, 0.1, `${params.fade_in.toFixed(1)}s`, params.fade_in > 0],
                ['fade_out', 'Fade out', 0, 15, 0.1, `${params.fade_out.toFixed(1)}s`, params.fade_out > 0],
              ] as [keyof EditParams, string, number, number, number, string, boolean][]).map(([key, label, min, max, step, display, active]) => (
                <div key={key} className="flex flex-col gap-2">
                  <span className="text-sm flex justify-between">
                    <span className={active ? 'text-sky-500' : 'text-gray-400'}>{label}</span>
                    <span className={`tabular-nums ${active ? 'text-sky-500' : 'text-gray-400 dark:text-gray-600'}`}>{display}</span>
                  </span>
                  <Slider
                    value={params[key] as number} min={min} max={max} step={step}
                    onChange={v => handleSliderChange(key, v)}
                    onStart={handleSliderStart}
                    onCommit={handleSliderCommit}
                    label={label}
                  />
                </div>
              ))}
            </div>

            {/* speed + normalize */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex flex-col gap-2 flex-1 min-w-40">
                <span className="text-sm flex justify-between">
                  <span className={params.speed !== 1 ? 'text-sky-500' : 'text-gray-400'}>Speed</span>
                  <span className={`tabular-nums ${params.speed !== 1 ? 'text-sky-500' : 'text-gray-400 dark:text-gray-600'}`}>{params.speed.toFixed(2)}×</span>
                </span>
                <Slider
                  value={params.speed} min={0.25} max={4} step={0.05}
                  onChange={v => handleSliderChange('speed', v)}
                  onStart={handleSliderStart}
                  onCommit={handleSliderCommit}
                  disabled={!wsReady}
                  label="speed"
                />
              </div>
              <label className="flex items-center gap-2 text-sm select-none shrink-0">
                <input
                  type="checkbox"
                  checked={params.normalize}
                  onChange={e => {
                    pushHistory(paramsRef.current)
                    setParams(prev => { const next = { ...prev, normalize: e.target.checked }; scheduleSave(next); return next })
                  }}
                  className="accent-sky-500"
                />
                <span className={params.normalize ? 'text-sky-500' : 'text-gray-400'}>Normalize</span>
              </label>
            </div>

            {/* cuts */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Cuts</span>
                <button onClick={addCut} disabled={!wsReady} className="text-sm text-sky-500 hover:text-sky-400 transition-colors disabled:opacity-40">
                  + add cut
                </button>
              </div>
              {params.cuts.length > 0 && (
                <div className="flex flex-col gap-2">
                  {params.cuts.map(cut => (
                    <div key={cut.id} className="flex flex-col gap-1.5 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <FaCut size={10} className="text-red-400 shrink-0" />
                        <span className="text-gray-500 dark:text-gray-400 tabular-nums flex-1">
                          {fmt(cut.start)} – {fmt(cut.end)}
                          <span className="text-gray-400 dark:text-gray-600 ml-1.5">({fmt(cut.end - cut.start)})</span>
                        </span>
                        <button onClick={() => removeCut(cut.id!)} title="remove cut" className="text-gray-400 hover:text-red-400 transition-colors">
                          <FaTimes size={10} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(['fade_out', 'fade_in'] as const).map(key => (
                          <div key={key} className="flex flex-col gap-1">
                            <span className="text-xs flex justify-between">
                              <span className={cut[key] > 0 ? 'text-red-400' : 'text-gray-400'}>{key === 'fade_out' ? 'fade before' : 'fade after'}</span>
                              <span className={`tabular-nums ${cut[key] > 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-600'}`}>{cut[key].toFixed(1)}s</span>
                            </span>
                            <Slider
                              value={cut[key]} min={0} max={5} step={0.1}
                              onChange={v => updateCutFade(cut.id!, key, v)}
                              label={key === 'fade_out' ? 'fade before cut' : 'fade after cut'}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-gray-400 select-none">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-sky-500" />
                overwrite original
              </label>
            )}

            {/* actions */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button onClick={handlePreview} disabled={!wsReady} className={`px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-40 border border-sky-500 text-sky-500 hover:bg-sky-500 hover:text-white`}>
                {previewing ? 'Stop preview' : 'Preview'}
              </button>
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

            {/* footer */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                drag handles to trim · space to play · h/l to seek · Ctrl+Z undo · Ctrl+Shift+Z redo
              </p>
              <div className="flex items-center gap-3">
                {restoreConfirm ? (
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-gray-400">{restoreConfirm === 'original' ? 'restore original?' : 'revert to last save?'}</span>
                    <button
                      onClick={restoreConfirm === 'original' ? handleRestoreOriginal : handleRevertLastSave}
                      disabled={restoring}
                      className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                    >
                      {restoring ? 'restoring…' : 'yes'}
                    </button>
                    <button onClick={() => setRestoreConfirm(null)} className="text-gray-400 hover:text-gray-300 transition-colors">
                      cancel
                    </button>
                  </span>
                ) : (
                  <>
                    {rootSongId && rootSongId !== songId && (
                      <button onClick={() => setRestoreConfirm('original')} className="text-sm text-gray-400 hover:text-sky-500 transition-colors">
                        restore original
                      </button>
                    )}
                    {parentSongId && parentSongId !== rootSongId && (
                      <button onClick={() => setRestoreConfirm('last')} className="text-sm text-gray-400 hover:text-sky-500 transition-colors">
                        revert to last save
                      </button>
                    )}
                  </>
                )}
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
    </div>
  )
}
