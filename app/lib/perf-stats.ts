// Pure helpers behind the ?perf=1 overlay: no browser APIs, so they are unit tested.

/** Nearest-rank percentile; 0 for no samples. Does not reorder `values`. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]
}

export type RequestKind = 'position' | 'state' | 'play' | 'audio' | 'other'

/** Which kind of API call a resource-timing URL is, or null when it is not an API call. */
export function classifyRequest(url: string): RequestKind | null {
  let path: string
  try { path = new URL(url, 'http://localhost').pathname } catch { return null }
  if (!path.startsWith('/v1/')) return null
  if (path.startsWith('/v1/download/')) return 'audio'
  if (/^\/v1\/library\/[^/]+\/position$/.test(path)) return 'position'
  if (path === '/v1/player/state') return 'state'
  if (/^\/v1\/songs\/[^/]+\/play$/.test(path)) return 'play'
  return 'other'
}

/**
 * Frames missed in a list of gaps between animation frames. A gap over 1.5 frames
 * misses (gap / frame - 1) frames; a gap over a second is the page being hidden,
 * not jank, so it counts for nothing.
 */
export function droppedFrames(gaps: number[], frameMs: number): { dropped: number; worst: number } {
  let dropped = 0
  let worst = 0
  for (const gap of gaps) {
    if (gap > 1000) continue
    if (gap > worst) worst = gap
    if (gap > frameMs * 1.5) dropped += Math.round(gap / frameMs) - 1
  }
  return { dropped, worst }
}

/** Whether the overlay and render counter are on for this page load. */
export function perfFlagFrom(input: { search: string; stored: string | null; override: boolean; device?: boolean }): boolean {
  const asked = new URLSearchParams(input.search).get('perf')
  if (asked === '0') return false
  if (asked === '1') return true
  return input.stored === '1' || input.override || input.device === true
}
