import { classifyRequest, droppedFrames, percentile, type RequestKind } from './perf-stats'
import { perfStore } from './perf'

// Collectors for the ?perf=1 overlay. Only started once the overlay mounts, and
// every browser API is feature-detected: Chrome, Firefox and Safari each have a
// different subset, and a missing one just leaves its line out.

export type PerfSnapshot = {
  minutes: number
  counts: Record<string, number>
  requests: Record<RequestKind, number>
  bytes: number
  frames: { dropped: number; worst: number }
  lag: { p95: number; max: number }
  taps: { p75: number; worst: number; n: number }
  lcp: number | null
  audio: { stalls: number; lastGapMs: number | null }
  /** Chrome only */
  longFrames: { count: number; worst: number; culprit: string } | null
  /** Chrome only */
  cpu: string | null
}

const MAX_SAMPLES = 20000

function supports(entryType: string): boolean {
  return typeof PerformanceObserver !== 'undefined'
    && (PerformanceObserver.supportedEntryTypes ?? []).includes(entryType)
}

function emptyRequests(): Record<RequestKind, number> {
  return { position: 0, state: 0, play: 0, audio: 0, other: 0 }
}

export function startCollectors(): { snapshot: () => PerfSnapshot; reset: () => void; stop: () => void } {
  const cleanups: Array<() => void> = []
  let requests = emptyRequests()
  let bytes = 0
  let gaps: number[] = []
  let drifts: number[] = []
  let taps: number[] = []
  let stalls = 0
  let lastGapMs: number | null = null
  let endedAt: number | null = null
  let lcp: number | null = null
  let longFrames = { count: 0, worst: 0, culprit: '' }
  let cpu: string | null = null
  const hasLongFrames = supports('long-animation-frame')
  const hasPressure = typeof window !== 'undefined' && 'PressureObserver' in window

  const startedAt = () => perfStore()?.startedAt ?? 0
  const push = (list: number[], v: number) => { list.push(v); if (list.length > MAX_SAMPLES) list.shift() }

  function observe(type: string, onEntry: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}) {
    if (!supports(type)) return
    try {
      const observer = new PerformanceObserver(list => list.getEntries().forEach(onEntry))
      observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
      cleanups.push(() => observer.disconnect())
    } catch { /* unsupported option */ }
  }

  observe('resource', e => {
    if (e.startTime < startedAt()) return
    const kind = classifyRequest(e.name)
    if (kind) requests[kind]++
    const r = e as PerformanceResourceTiming
    bytes += r.transferSize || r.encodedBodySize || 0
  })

  observe('largest-contentful-paint', e => { lcp = e.startTime })

  observe('event', e => {
    if (e.startTime < startedAt()) return
    const ev = e as PerformanceEventTiming & { interactionId?: number }
    const isInteraction = ev.interactionId !== undefined
      ? ev.interactionId > 0
      : ['click', 'keydown', 'pointerup'].includes(ev.name)
    if (isInteraction) push(taps, ev.duration)
  }, { durationThreshold: 16 })

  if (hasLongFrames) {
    observe('long-animation-frame', e => {
      if (e.startTime < startedAt()) return
      longFrames.count++
      if (e.duration > longFrames.worst) {
        longFrames.worst = e.duration
        const script = (e as unknown as { scripts?: Array<{ sourceURL?: string; invoker?: string }> }).scripts?.[0]
        longFrames.culprit = script?.sourceURL?.split('/').pop() || script?.invoker || ''
      }
    })
  }

  if (hasPressure) {
    try {
      type PressureCtor = new (cb: (records: Array<{ state: string }>) => void) => { observe: (s: string) => Promise<void>; disconnect: () => void }
      const Pressure = (window as unknown as { PressureObserver: PressureCtor }).PressureObserver
      const po = new Pressure(records => { cpu = records[records.length - 1]?.state ?? cpu })
      po.observe('cpu').catch(() => { /* blocked by policy */ })
      cleanups.push(() => po.disconnect())
    } catch { /* unsupported */ }
  }

  // Gaps between animation frames. A hidden page stops painting, so restart the
  // clock on visibility changes instead of recording the pause as one huge gap.
  let raf = 0
  let lastFrame: number | null = null
  const frame = (now: number) => {
    if (lastFrame !== null) push(gaps, now - lastFrame)
    lastFrame = now
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const onVisibility = () => { lastFrame = null }
  document.addEventListener('visibilitychange', onVisibility)
  cleanups.push(() => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVisibility) })

  // Main-thread lag: how late a 50 ms timer fires.
  let lastTick = performance.now()
  const timer = window.setInterval(() => {
    const now = performance.now()
    push(drifts, Math.max(0, now - lastTick - 50))
    lastTick = now
  }, 50)
  cleanups.push(() => window.clearInterval(timer))

  // Media events don't bubble, so listen in the capture phase for any <audio>.
  const onWaiting = (e: Event) => { if (e.target instanceof HTMLMediaElement && !e.target.seeking) stalls++ }
  const onEnded = () => { endedAt = performance.now() }
  const onPlaying = () => {
    if (endedAt !== null) { lastGapMs = performance.now() - endedAt; endedAt = null }
  }
  document.addEventListener('waiting', onWaiting, true)
  document.addEventListener('ended', onEnded, true)
  document.addEventListener('playing', onPlaying, true)
  cleanups.push(() => {
    document.removeEventListener('waiting', onWaiting, true)
    document.removeEventListener('ended', onEnded, true)
    document.removeEventListener('playing', onPlaying, true)
  })

  function reset() {
    const store = perfStore()
    if (store) {
      for (const key of Object.keys(store.counts)) store.counts[key] = 0
      store.startedAt = performance.now()
    }
    requests = emptyRequests()
    bytes = 0
    gaps = []
    drifts = []
    taps = []
    stalls = 0
    lastGapMs = null
    longFrames = { count: 0, worst: 0, culprit: '' }
  }

  function snapshot(): PerfSnapshot {
    const store = perfStore()
    const elapsed = Math.max(performance.now() - startedAt(), 1000)
    const frameMs = Math.min(34, Math.max(6, percentile(gaps, 10) || 16.7))
    return {
      minutes: elapsed / 60000,
      counts: { ...(store?.counts ?? {}) },
      requests: { ...requests },
      bytes,
      frames: droppedFrames(gaps, frameMs),
      lag: { p95: percentile(drifts, 95), max: drifts.reduce((m, v) => Math.max(m, v), 0) },
      taps: { p75: percentile(taps, 75), worst: taps.reduce((m, v) => Math.max(m, v), 0), n: taps.length },
      lcp,
      audio: { stalls, lastGapMs },
      longFrames: hasLongFrames ? { ...longFrames } : null,
      cpu: hasPressure ? (cpu ?? 'n/a') : null,
    }
  }

  return { snapshot, reset, stop: () => cleanups.forEach(fn => fn()) }
}
