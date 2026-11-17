// Which artwork sizes the app asks for, and the lock-screen list. Pure.

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

/** The parts of a local art url: `/v1/songs/<id>/artwork/<size>[/<version>]`, absolute or not. Null for anything else. */
export function parseArtworkPath(url: string): { id: string; size: string; version: string | null; stem: string } | null {
  const m = /^(?:https?:\/\/[^/]+)?(\/v1\/songs\/([^/]+)\/artwork\/([^/?#]+))(?:\/([^/?#]+))?/.exec(url)
  return m ? { stem: m[1], id: m[2], size: m[3], version: m[4] ?? null } : null
}

/** A whole picture: found, not a partial (206) answer. An empty body still needs the blob check. */
export function completeResponse(res: Response | undefined): res is Response {
  return !!res && res.ok && res.status !== 206
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

/** The remote art url inside an optimizer url, or the url itself: how a saved copy of remote art is keyed. */
function storedKeyCandidates(src: string): string[] {
  try {
    const raw = new URL(src, 'http://x').searchParams.get('url')
    return raw ? [src, raw] : [src]
  } catch { return [src] }
}

/**
 * The lock-screen list for a device with no network: the OS fetches a lock-screen
 * image itself and cannot reach the service worker's cache, so only art the device has
 * stored is offered, as a `blob:` url of that copy, at the sizes it stored. Nothing stored
 * gives an empty list: no entry, rather than a white square.
 */
export async function storedMediaArtwork(
  list: MediaArtwork[],
  lookup: (url: string) => Promise<Response | undefined>,
  objectUrl: (blob: Blob) => string,
): Promise<MediaArtwork[]> {
  const out: MediaArtwork[] = []
  for (const entry of list) {
    for (const key of storedKeyCandidates(entry.src)) {
      let res: Response | undefined
      try { res = await lookup(key) } catch { res = undefined }
      if (!res || !res.ok || res.status === 206) continue
      const blob = await res.clone().blob()
      if (blob.size === 0) continue
      out.push({ ...entry, src: objectUrl(blob) })
      break
    }
  }
  return out
}
