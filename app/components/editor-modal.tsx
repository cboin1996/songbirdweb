'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import {
  BASE_URL, createEditJob, deleteEditDraft, EditParams, fetchEditDraft,
  pollEditJob, Properties, saveEditDraft, songArtworkUrl, tagSong,
} from '../lib/data'
import { FaPlay, FaPause, FaTimes, FaUndo } from 'react-icons/fa'
import Image from 'next/image'

type Tab = 'audio' | 'properties'

const DEFAULT_PARAMS: EditParams = {
  trim_start: 0,
  trim_end: null,
  volume: 1.0,
  fade_in: 0,
  fade_out: 0,
}

interface Props {
  songId: string
  properties: Properties
  artworkCached?: boolean
  isAdmin: boolean
  onClose: () => void
  onEditComplete?: (newSongId: string) => void
}

export default function EditorModal({
  songId, properties: initialProperties, artworkCached, isAdmin, onClose, onEditComplete,
}: Props) {
  const [tab, setTab] = useState<Tab>('audio')

  // --- audio params ---
  const [params, setParams] = useState<EditParams>(DEFAULT_PARAMS)
  const [duration, setDuration] = useState(0)

  // --- undo stack (local only) ---
  const historyRef = useRef<EditParams[]>([])
  const [canUndo, setCanUndo] = useState(false)

  // --- waveform ---
  const waveRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [wsReady, setWsReady] = useState(false)
  const [wfPlaying, setWfPlaying] = useState(false)

  // --- preview (Web Audio) ---
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)
  const [previewing, setPreviewing] = useState(false)

  // --- draft auto-save ---
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- job submit ---
  const [jobStatus, setJobStatus] = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [jobError, setJobError] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  // --- properties tab ---
  const [props, setProps] = useState<Properties>(initialProperties)
  const [propStatus, setPropStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // load draft on open
  useEffect(() => {
    fetchEditDraft(songId).then(draft => {
      if (draft) setParams(draft)
    })
  }, [songId])

  // debounced auto-save whenever params change
  const scheduleSave = useCallback((p: EditParams) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveEditDraft(songId, p), 1000)
  }, [songId])

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
      height: 88,
      plugins: [regions],
      fetchParams: { credentials: 'include' },
    })
    wsRef.current = ws
    ws.load(`${BASE_URL}/download/${songId}`)
    ws.on('ready', () => {
      const dur = ws.getDuration()
      setDuration(dur)
      setWsReady(true)
      // seed region from loaded params (or defaults)
      setParams(prev => {
        const end = prev.trim_end ?? dur
        regions.addRegion({
          id: 'trim', start: prev.trim_start, end,
          color: 'rgba(56,189,248,0.12)', drag: true, resize: true,
        })
        return { ...prev, trim_end: prev.trim_end ?? null }
      })
    })
    ws.on('play', () => setWfPlaying(true))
    ws.on('pause', () => setWfPlaying(false))
    ws.on('finish', () => setWfPlaying(false))
    regions.on('region-updated', r => {
      if (r.id !== 'trim') return
      setParams(prev => {
        const next = { ...prev, trim_start: r.start, trim_end: r.end }
        scheduleSave(next)
        return next
      })
    })
    return () => { ws.destroy() }
  }, [songId, scheduleSave])

  // sync volume to WaveSurfer when it changes
  useEffect(() => {
    wsRef.current?.setVolume(params.volume)
  }, [params.volume])

  function pushHistory(snapshot: EditParams) {
    historyRef.current = [...historyRef.current.slice(-19), snapshot]
    setCanUndo(true)
  }

  function undo() {
    const hist = historyRef.current
    if (hist.length === 0) return
    const prev = hist[hist.length - 1]
    historyRef.current = hist.slice(0, -1)
    setCanUndo(historyRef.current.length > 0)
    applyParams(prev)
    scheduleSave(prev)
  }

  function applyParams(p: EditParams) {
    setParams(p)
    const region = regionsRef.current?.getRegions().find(r => r.id === 'trim')
    if (region && duration > 0) {
      region.setOptions({ start: p.trim_start, end: p.trim_end ?? duration })
    }
    wsRef.current?.setVolume(p.volume)
  }

  function handleSliderChange(key: keyof EditParams, value: number) {
    setParams(prev => {
      const next = { ...prev, [key]: value }
      scheduleSave(next)
      return next
    })
  }

  function handleSliderCommit() {
    pushHistory(params)
  }

  function stopPreview() {
    previewSrcRef.current?.stop()
    previewCtxRef.current?.close()
    previewSrcRef.current = null
    previewCtxRef.current = null
    setPreviewing(false)
  }

  async function handlePreview() {
    if (previewing) { stopPreview(); return }
    wsRef.current?.pause()
    const raw = wsRef.current?.getDecodedData()
    if (!raw) return

    const ctx = new AudioContext()
    const sr = raw.sampleRate
    const startFrame = Math.floor(params.trim_start * sr)
    const endFrame = params.trim_end !== null
      ? Math.floor(params.trim_end * sr)
      : raw.length
    const frameCount = Math.max(1, endFrame - startFrame)
    const trimmed = ctx.createBuffer(raw.numberOfChannels, frameCount, sr)
    for (let ch = 0; ch < raw.numberOfChannels; ch++) {
      trimmed.getChannelData(ch).set(raw.getChannelData(ch).subarray(startFrame, startFrame + frameCount))
    }

    const source = ctx.createBufferSource()
    source.buffer = trimmed
    const gain = ctx.createGain()
    const now = ctx.currentTime
    const trimDur = frameCount / sr

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
    source.onended = () => { setPreviewing(false) }
  }

  function toggleWaveform() {
    if (!wsRef.current) return
    stopPreview()
    if (wfPlaying) wsRef.current.pause()
    else wsRef.current.play()
  }

  async function handleSave() {
    setJobStatus('submitting')
    setJobError('')
    const job = await createEditJob(songId, params, overwrite)
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
        if (result.result_song_id && !overwrite) onEditComplete?.(result.result_song_id)
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

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  const trimEnd = params.trim_end ?? duration
  const artSrc = songArtworkUrl(songId, artworkCached, initialProperties.artworkUrl100, 200)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          {artSrc && (
            <Image src={artSrc} alt="" width={40} height={40} className="rounded shrink-0 object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate text-sm">{initialProperties.trackName}</p>
            <p className="text-xs text-sky-500 truncate">{initialProperties.artistName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 p-1">
            <FaTimes size={14} />
          </button>
        </div>

        {/* tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 shrink-0">
          {(['audio', 'properties'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-sky-500 text-sky-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* audio tab */}
        {tab === 'audio' && (
          <div className="p-5 flex flex-col gap-5">
            {/* waveform */}
            <div
              ref={waveRef}
              className="w-full rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 min-h-[88px]"
            />

            {/* transport + time */}
            <div className="flex items-center gap-3">
              <button
                onClick={toggleWaveform}
                disabled={!wsReady}
                className="text-sky-500 hover:text-sky-400 disabled:opacity-30"
              >
                {wfPlaying ? <FaPause size={16} /> : <FaPlay size={16} />}
              </button>
              <span className="text-xs text-gray-400 tabular-nums">
                {fmt(params.trim_start)} – {fmt(trimEnd)}
                <span className="text-gray-600 dark:text-gray-600"> / {fmt(duration)}</span>
              </span>
              <div className="flex-1" />
              <button
                onClick={undo}
                disabled={!canUndo}
                title="undo"
                className="text-gray-400 hover:text-sky-500 disabled:opacity-20 transition-colors"
              >
                <FaUndo size={13} />
              </button>
            </div>

            {/* sliders */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-2">
                <span className="text-xs text-gray-400">
                  Volume <span className="text-gray-300 dark:text-gray-500">{Math.round(params.volume * 100)}%</span>
                </span>
                <input
                  type="range" min={0} max={2} step={0.05}
                  value={params.volume}
                  onChange={e => handleSliderChange('volume', parseFloat(e.target.value))}
                  onMouseUp={handleSliderCommit}
                  onTouchEnd={handleSliderCommit}
                  className="accent-sky-500"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-gray-400">
                  Fade in <span className="text-gray-300 dark:text-gray-500">{params.fade_in.toFixed(1)}s</span>
                </span>
                <input
                  type="range" min={0} max={15} step={0.1}
                  value={params.fade_in}
                  onChange={e => handleSliderChange('fade_in', parseFloat(e.target.value))}
                  onMouseUp={handleSliderCommit}
                  onTouchEnd={handleSliderCommit}
                  className="accent-sky-500"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-gray-400">
                  Fade out <span className="text-gray-300 dark:text-gray-500">{params.fade_out.toFixed(1)}s</span>
                </span>
                <input
                  type="range" min={0} max={15} step={0.1}
                  value={params.fade_out}
                  onChange={e => handleSliderChange('fade_out', parseFloat(e.target.value))}
                  onMouseUp={handleSliderCommit}
                  onTouchEnd={handleSliderCommit}
                  className="accent-sky-500"
                />
              </label>
            </div>

            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-gray-400 select-none">
                <input
                  type="checkbox" checked={overwrite}
                  onChange={e => setOverwrite(e.target.checked)}
                  className="accent-sky-500"
                />
                overwrite original (admin)
              </label>
            )}

            {/* actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handlePreview}
                disabled={!wsReady}
                className="px-4 py-2 border border-sky-500 text-sky-500 hover:bg-sky-500 hover:text-white disabled:opacity-30 rounded-lg text-sm font-medium transition-colors"
              >
                {previewing ? 'Stop preview' : 'Preview'}
              </button>
              <button
                onClick={handleSave}
                disabled={!wsReady || jobStatus === 'submitting' || jobStatus === 'polling' || jobStatus === 'done'}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {jobStatus === 'submitting' ? 'Starting…'
                  : jobStatus === 'polling' ? 'Processing…'
                  : jobStatus === 'done' ? 'Saved ✓'
                  : 'Save'}
              </button>
              {jobStatus === 'error' && (
                <span className="text-red-500 text-sm">{jobError}</span>
              )}
              {jobStatus === 'done' && !overwrite && (
                <span className="text-gray-400 text-sm">added to your library</span>
              )}
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-600">
              Draft auto-saved · drag waveform handles to trim
            </p>
          </div>
        )}

        {/* properties tab */}
        {tab === 'properties' && (
          <div className="p-5 flex flex-col gap-4">
            {(
              [
                ['trackName', 'Track name'],
                ['artistName', 'Artist'],
                ['collectionName', 'Album'],
                ['primaryGenreName', 'Genre'],
                ['artworkUrl100', 'Artwork URL'],
              ] as [keyof Properties, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="text"
                  value={String(props[key] ?? '')}
                  onChange={e => setProps(p => ({ ...p, [key]: e.target.value }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm focus:outline focus:outline-sky-500"
                />
              </label>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-400">Track #</span>
                <input
                  type="number"
                  value={props.trackNumber ?? ''}
                  onChange={e => setProps(p => ({ ...p, trackNumber: parseInt(e.target.value) || 0 }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm focus:outline focus:outline-sky-500"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-400">Release date</span>
                <input
                  type="text"
                  value={props.releaseDate ?? ''}
                  onChange={e => setProps(p => ({ ...p, releaseDate: e.target.value }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm focus:outline focus:outline-sky-500"
                />
              </label>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handlePropSave}
                disabled={propStatus === 'saving'}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {propStatus === 'saving' ? 'Saving…' : propStatus === 'saved' ? 'Saved ✓' : 'Save'}
              </button>
              {propStatus === 'error' && <span className="text-red-500 text-sm">save failed</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
