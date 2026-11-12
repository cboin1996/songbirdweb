import { useEffect } from 'react'
import { perfFlagFrom } from './perf-stats'
import { getPerfOverlay } from './device-settings'

// The render counter behind the ?perf=1 overlay. Whether it is on is decided once,
// when the page loads: from ?perf=1 (remembered for the session), the "performance
// overlay" device setting, or a test override set before the page runs. Off, `useRenderCount` is an empty function and
// nothing is stored.

const SESSION_KEY = 'songbird:perf'

export type PerfStore = {
  counts: Record<string, number>
  /** performance.now() when the counters were last reset */
  startedAt: number
}

type PerfWindow = Window & { __SONGBIRD_PERF__?: boolean; __songbirdPerf?: PerfStore }

function decide(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as PerfWindow
  let stored: string | null = null
  try { stored = sessionStorage.getItem(SESSION_KEY) } catch { /* private mode */ }
  const on = perfFlagFrom({ search: w.location.search, stored, override: w.__SONGBIRD_PERF__ === true, device: getPerfOverlay() })
  try {
    const asked = new URLSearchParams(w.location.search).get('perf')
    if (asked === '1') sessionStorage.setItem(SESSION_KEY, '1')
    else if (asked === '0') sessionStorage.removeItem(SESSION_KEY)
  } catch { /* private mode */ }
  if (on) w.__songbirdPerf = { counts: {}, startedAt: 0 }
  return on
}

export const perfEnabled: boolean = decide()

export function perfStore(): PerfStore | undefined {
  return typeof window === 'undefined' ? undefined : (window as PerfWindow).__songbirdPerf
}

/** Counts each committed update of the calling component under `name`. */
function useCommitCount(name: string): void {
  useEffect(() => {
    const store = perfStore()
    if (store) store.counts[name] = (store.counts[name] ?? 0) + 1
  })
}

function noop(): void {}

export const useRenderCount: (name: string) => void = perfEnabled ? useCommitCount : noop
