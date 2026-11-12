'use client'
import { useEffect, useRef, useState } from 'react'
import { startCollectors, type PerfSnapshot } from '../lib/perf-collect'

// The ?perf=1 panel: a corner readout of renders, requests, frames, lag and taps,
// refreshed once a second and counted since the last reset. It sits above the
// player bar and lets taps through everywhere except its two buttons. Its own renders are
// not counted (it never calls useRenderCount).

const RENDER_NAMES = ['player', 'progress', 'list', 'row', 'album', 'queueList']

type Line = { id: string; label: string; text: string }

function perMinute(n: number, minutes: number): string {
  return String(Math.round(n / minutes))
}

function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function buildLines(s: PerfSnapshot): Line[] {
  const requestTotal = Object.values(s.requests).reduce((a, b) => a + b, 0)
  const lines: Line[] = [
    { id: 'renders', label: 'renders/min', text: RENDER_NAMES.map(n => `${n} ${perMinute(s.counts[n] ?? 0, s.minutes)}`).join('  ') },
    { id: 'api', label: 'api/min', text: `${perMinute(requestTotal, s.minutes)}  (position ${perMinute(s.requests.position, s.minutes)}, state ${perMinute(s.requests.state, s.minutes)}, play ${perMinute(s.requests.play, s.minutes)}, audio ${perMinute(s.requests.audio, s.minutes)})` },
    { id: 'bytes', label: 'bytes in', text: megabytes(s.bytes) },
    { id: 'frames', label: 'frames', text: `dropped ${perMinute(s.frames.dropped, s.minutes)}/min  worst gap ${Math.round(s.frames.worst)} ms` },
    { id: 'lag', label: 'main thread', text: `lag p95 ${Math.round(s.lag.p95)} ms  max ${Math.round(s.lag.max)} ms` },
    { id: 'taps', label: 'taps', text: s.taps.n ? `p75 ${Math.round(s.taps.p75)} ms  worst ${Math.round(s.taps.worst)} ms  (${s.taps.n})` : 'none yet' },
    { id: 'load', label: 'load (LCP)', text: s.lcp === null ? 'n/a' : `${Math.round(s.lcp)} ms` },
    { id: 'audio', label: 'audio', text: `stalls ${s.audio.stalls}  last track gap ${s.audio.lastGapMs === null ? 'n/a' : `${(s.audio.lastGapMs / 1000).toFixed(1)} s`}` },
  ]
  if (s.longFrames) lines.push({ id: 'longframes', label: 'long frames', text: `${s.longFrames.count}  worst ${Math.round(s.longFrames.worst)} ms  ${s.longFrames.culprit}`.trim() })
  if (s.cpu) lines.push({ id: 'cpu', label: 'cpu pressure', text: s.cpu })
  return lines
}

/** Copies text. The async clipboard API needs a secure context (https or localhost), so over plain http to a LAN address it is missing: fall back to a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to the textarea */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch { return false }
}

function elapsed(minutes: number): string {
  const total = Math.round(minutes * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function PerfOverlay() {
  const [snap, setSnap] = useState<PerfSnapshot | null>(null)
  const collectors = useRef<ReturnType<typeof startCollectors> | null>(null)
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)

  useEffect(() => {
    const c = startCollectors()
    collectors.current = c
    const refresh = () => setSnap(c.snapshot())
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => { window.clearInterval(timer); c.stop() }
  }, [])

  if (!snap) return null
  const lines = buildLines(snap)

  async function copy() {
    if (!snap) return
    const text = [`perf ${elapsed(snap.minutes)}`, ...buildLines(snap).map(l => `${l.label}: ${l.text}`)].join('\n')
    setCopied((await copyText(text)) ? 'copied' : 'failed')
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div data-testid="perf-overlay" className="pointer-events-none fixed bottom-24 left-1 z-[9998] max-w-[96vw] rounded bg-black/80 p-2 font-mono text-[10px] leading-tight text-white">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>perf {elapsed(snap.minutes)}</span>
        <span className="pointer-events-auto flex gap-1">
          <button data-testid="perf-reset" className="rounded bg-white/20 px-1" onClick={() => { collectors.current?.reset(); setSnap(collectors.current?.snapshot() ?? null) }}>reset</button>
          <button data-testid="perf-copy" className="rounded bg-white/20 px-1" onClick={copy}>{copied ?? 'copy'}</button>
        </span>
      </div>
      {lines.map(l => (
        <div key={l.id} data-testid={`perf-line-${l.id}`}><span className="text-white/60">{l.label}</span> {l.text}</div>
      ))}
    </div>
  )
}
