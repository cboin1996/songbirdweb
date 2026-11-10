// Timing knobs the e2e specs shorten so they need not wait real minutes. Read
// from window at the point of use rather than at load, because a spec sets them
// after the page is up. Nothing in the app sets them, so the default stands.
export type TestOverride =
  | '__tokenRefreshStaleMs'     // how old the token must be before a proactive refresh
  | '__playerStaleThresholdMs'  // how long the tab must be hidden before a resync
  | '__playerProgressResetSec'  // seconds of real playback that clear the failure budget

export function readTestOverride(name: TestOverride, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const value = (window as unknown as Record<string, unknown>)[name]
  return typeof value === 'number' ? value : fallback
}
