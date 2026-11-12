// Which artwork sizes the app asks for, and the version that makes a replaced
// image show. Pure apart from the version store, which falls back to memory when
// storage is unavailable.

/** Remote (iTunes) artwork comes in two widths only: a thumbnail and a large one. */
export const ARTWORK_SMALL_PX = 200
export const ARTWORK_LARGE_PX = 600

/** The two widths the app requests, whatever a caller asks for. */
export function normalizeArtworkSize(size: number): number {
  return size <= 300 ? ARTWORK_SMALL_PX : ARTWORK_LARGE_PX
}

/** Cache of artwork seen while browsing: capped by the service worker. */
export const BROWSE_ARTWORK_CACHE = 'songbird-artwork-v1'
/** Cache of artwork stored for offline songs: never trimmed. The service worker repeats this name. */
export const OFFLINE_ARTWORK_CACHE = 'songbird-artwork-saved-v1'

/** The `w` the image optimizer is asked for a remote artwork URL: its own size, folded to one of the two allowed. */
export function optimizerWidth(url: string): number {
  const m = /(\d+)x\d+bb/.exec(url)
  return m ? normalizeArtworkSize(Number(m[1])) : ARTWORK_LARGE_PX
}

export const ARTWORK_VERSIONS_KEY = 'songbird-artwork-versions'
const STORAGE_KEY = ARTWORK_VERSIONS_KEY
let versions: Record<string, number> | null = null

function load(): Record<string, number> {
  if (versions) return versions
  versions = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw) {
      // Storage is the user's to edit: keep only whole positive numbers.
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) versions[id] = v
        }
      }
    }
  } catch { /* memory only */ }
  return versions
}

/** The version of a song's stored artwork on this device; 0 until it is replaced. */
export function artworkVersion(songId: string): number {
  return load()[songId] ?? 0
}

/** Marks a song's artwork as replaced, so its URLs change and the old stored copies are not matched. */
export function bumpArtworkVersion(songId: string): number {
  const map = load()
  const next = (map[songId] ?? 0) + 1
  map[songId] = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch { /* memory only */ }
  return next
}

/** For tests: forget everything held in memory. */
export function resetArtworkVersions(): void {
  versions = null
}

/** `?v=N` once the song's artwork has been replaced on this device, else nothing. */
export function artworkVersionQuery(songId: string): string {
  const v = artworkVersion(songId)
  return v > 0 ? `?v=${v}` : ''
}

export interface MediaArtwork { src: string; sizes: string; type: string }

/**
 * The lock-screen artwork list: only sizes the app also stores for offline, at most
 * two. A song with a local copy has a thumbnail and a full image; a remote one has
 * its large image only.
 */
export function mediaSessionArtwork(
  song: { uuid: string; artwork_cached?: boolean },
  urlFor: (size: number) => string | null,
  origin: string,
): MediaArtwork[] {
  const sizes = song.artwork_cached ? [ARTWORK_SMALL_PX, ARTWORK_LARGE_PX] : [ARTWORK_LARGE_PX]
  const out: MediaArtwork[] = []
  for (const s of sizes) {
    const url = urlFor(s)
    if (!url) continue
    out.push({ src: url.startsWith('/') ? `${origin}${url}` : url, sizes: `${s}x${s}`, type: 'image/jpeg' })
  }
  return out
}
