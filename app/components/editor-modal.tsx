'use client'
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import { BASE_URL, createEditJob, EditParams, pollEditJob, Properties, tagSong } from '../lib/data'
import { FaPlay, FaPause, FaTimes } from 'react-icons/fa'
import Image from 'next/image'
import { songArtworkUrl } from '../lib/data'

type Tab = 'audio' | 'properties'

interface Props {
  songId: string
  properties: Properties
  artworkCached?: boolean
  isAdmin: boolean
  onClose: () => void
  onEditComplete?: (newSongId: string) => void
}

export default function EditorModal({ songId, properties: initialProperties, artworkCached, isAdmin, onClose, onEditComplete }: Props) {
  const [tab, setTab] = useState<Tab>('audio')

  // --- audio tab state ---
  const waveRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState<number | null>(null)
  const [volume, setVolume] = useState(1.0)
  const [fadeIn, setFadeIn] = useState(0)
  const [fadeOut, setFadeOut] = useState(0)
  const [audioStatus, setAudioStatus] = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [audioError, setAudioError] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  // --- properties tab state ---
  const [props, setProps] = useState<Properties>(initialProperties)
  const [propStatus, setPropStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    if (!waveRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: '#64748b',
      progressColor: '#38bdf8',
      cursorColor: '#38bdf8',
      height: 80,
      plugins: [regions],
      fetchParams: { credentials: 'include' },
    })
    wsRef.current = ws
    ws.load(`${BASE_URL}/download/${songId}`)
    ws.on('ready', () => {
      const dur = ws.getDuration()
      setDuration(dur)
      setTrimEnd(dur)
      regions.addRegion({ id: 'trim', start: 0, end: dur, color: 'rgba(56,189,248,0.15)', drag: true, resize: true })
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    regions.on('region-updated', (r) => {
      if (r.id === 'trim') {
        setTrimStart(r.start)
        setTrimEnd(r.end)
      }
    })
    return () => { ws.destroy() }
  }, [songId])

  useEffect(() => {
    wsRef.current?.setVolume(volume)
  }, [volume])

  function togglePlay() {
    if (!wsRef.current) return
    if (playing) wsRef.current.pause()
    else wsRef.current.play()
  }

  async function handleAudioSave() {
    setAudioStatus('submitting')
    setAudioError('')
    const params: EditParams = {
      trim_start: trimStart,
      trim_end: trimEnd !== null && trimEnd < duration ? trimEnd : null,
      volume,
      fade_in: fadeIn,
      fade_out: fadeOut,
    }
    const job = await createEditJob(songId, params, overwrite)
    if (!job) { setAudioStatus('error'); setAudioError('failed to start job'); return }

    setAudioStatus('polling')
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      const result = await pollEditJob(job.job_id)
      if (!result || attempts > 60) {
        clearInterval(interval)
        setAudioStatus('error')
        setAudioError(result?.error ?? 'timed out')
        return
      }
      if (result.status === 'done') {
        clearInterval(interval)
        setAudioStatus('done')
        if (result.result_song_id && !overwrite) onEditComplete?.(result.result_song_id)
      }
      if (result.status === 'failed') {
        clearInterval(interval)
        setAudioStatus('error')
        setAudioError(result.error ?? 'ffmpeg failed')
      }
    }, 1500)
  }

  async function handlePropSave() {
    setPropStatus('saving')
    const result = await tagSong(songId, props)
    if (result) { setPropStatus('saved'); setTimeout(() => setPropStatus('idle'), 2000) }
    else setPropStatus('error')
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const artSrc = songArtworkUrl(songId, artworkCached, initialProperties.artworkUrl100, 200)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
          {artSrc && <Image src={artSrc} alt="" width={40} height={40} className="rounded shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{initialProperties.trackName}</p>
            <p className="text-sm text-sky-500 truncate">{initialProperties.artistName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
            <FaTimes />
          </button>
        </div>

        {/* tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800">
          {(['audio', 'properties'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-sky-500 text-sky-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* audio tab */}
        {tab === 'audio' && (
          <div className="p-5 flex flex-col gap-5">
            <div ref={waveRef} className="w-full rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800" />

            <div className="flex items-center gap-4">
              <button onClick={togglePlay} className="text-sky-500 hover:text-sky-400">
                {playing ? <FaPause size={18} /> : <FaPlay size={18} />}
              </button>
              <span className="text-xs text-gray-400 tabular-nums">
                {fmt(trimStart)} – {fmt(trimEnd ?? duration)} / {fmt(duration)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Volume {Math.round(volume * 100)}%</span>
                <input type="range" min={0} max={2} step={0.05} value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="accent-sky-500" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Fade in {fadeIn.toFixed(1)}s</span>
                <input type="range" min={0} max={10} step={0.1} value={fadeIn}
                  onChange={e => setFadeIn(parseFloat(e.target.value))}
                  className="accent-sky-500" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Fade out {fadeOut.toFixed(1)}s</span>
                <input type="range" min={0} max={10} step={0.1} value={fadeOut}
                  onChange={e => setFadeOut(parseFloat(e.target.value))}
                  className="accent-sky-500" />
              </label>
            </div>

            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-sky-500" />
                overwrite original (admin)
              </label>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleAudioSave}
                disabled={audioStatus === 'submitting' || audioStatus === 'polling' || audioStatus === 'done'}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {audioStatus === 'submitting' ? 'starting…' : audioStatus === 'polling' ? 'processing…' : audioStatus === 'done' ? 'done ✓' : 'apply edit'}
              </button>
              {audioStatus === 'error' && <span className="text-red-500 text-sm">{audioError}</span>}
              {audioStatus === 'done' && !overwrite && <span className="text-gray-400 text-sm">saved to your library</span>}
            </div>
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
              <label key={key} className="flex flex-col gap-1">
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
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Track #</span>
                <input
                  type="number"
                  value={props.trackNumber ?? ''}
                  onChange={e => setProps(p => ({ ...p, trackNumber: parseInt(e.target.value) || 0 }))}
                  className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm focus:outline focus:outline-sky-500"
                />
              </label>
              <label className="flex flex-col gap-1">
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
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {propStatus === 'saving' ? 'saving…' : propStatus === 'saved' ? 'saved ✓' : 'save'}
              </button>
              {propStatus === 'error' && <span className="text-red-500 text-sm">save failed</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
