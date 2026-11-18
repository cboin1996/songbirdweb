import { storedMediaArtwork, mediaSessionArtwork, loadableArtwork, noArtArtwork, normalizeArtworkSize, optimizerWidth } from '../app/lib/artwork'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import nextConfig from '../next.config'
import { artworkUrl, songArtworkUrl } from '../app/lib/data'

describe('normalizeArtworkSize', () => {
  it.each([[48, 200], [96, 200], [200, 200], [300, 200], [301, 600], [400, 600], [600, 600]])(
    '%i -> %i', (asked, got) => expect(normalizeArtworkSize(asked)).toBe(got))
})

describe('remote artwork urls', () => {
  const base = 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg'
  it('asks for one of two widths', () => {
    expect(artworkUrl(base, 128)).toBe('https://is1-ssl.mzstatic.com/image/thumb/x/200x200bb.jpg')
    expect(artworkUrl(base, 400)).toBe('https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg')
  })
})

describe('local artwork urls carry the song version in the path', () => {
  it('uses 0 for the original art', () => {
    expect(songArtworkUrl('abc', true, undefined, 200)).toBe('/v1/songs/abc/artwork/thumb/0')
    expect(songArtworkUrl('abc', true, undefined, 200, null)).toBe('/v1/songs/abc/artwork/thumb/0')
  })
  it('uses the song artwork_updated_at for every local size, and no query string', () => {
    expect(songArtworkUrl('abc', true, undefined, 200, 1763340000123)).toBe('/v1/songs/abc/artwork/thumb/1763340000123')
    expect(songArtworkUrl('abc', true, undefined, 600, 1763340000123)).toBe('/v1/songs/abc/artwork/full/1763340000123')
  })
  it('leaves remote art alone', () => {
    expect(songArtworkUrl('abc', false, 'https://x/100x100bb.jpg', 200, 5)).toBe('https://x/200x200bb.jpg')
  })
})

describe('mediaSessionArtwork', () => {
  const urlFor = (song: { uuid: string; artwork_cached: boolean }) => (s: number) =>
    songArtworkUrl(song.uuid, song.artwork_cached, 'https://x/100x100bb.jpg', s)

  it('lists the stored thumbnail and full image for a song with a local copy', () => {
    const song = { uuid: 'abc', artwork_cached: true }
    expect(mediaSessionArtwork(song, urlFor(song), 'http://app')).toEqual([
      { src: 'http://app/v1/songs/abc/artwork/thumb/0', sizes: '200x200', type: 'image/jpeg' },
      { src: 'http://app/v1/songs/abc/artwork/full/0', sizes: '600x600', type: 'image/jpeg' },
    ])
  })
  it('lists only the large remote image otherwise', () => {
    const song = { uuid: 'abc', artwork_cached: false }
    expect(mediaSessionArtwork(song, urlFor(song), 'http://app')).toEqual([
      { src: 'https://x/600x600bb.jpg', sizes: '600x600', type: 'image/jpeg' },
    ])
  })
  it('gives a song with no art the music note, not an empty list (iOS shows a blank tile)', () => {
    expect(mediaSessionArtwork({ uuid: 'abc', artwork_cached: false }, () => null, 'http://app')).toEqual([
      { src: 'http://app/icon-no-art.png', sizes: '512x512', type: 'image/png' },
    ])
  })
})

describe('optimizerWidth', () => {
  it.each([
    ['https://x/100x100bb.jpg', 200],
    ['https://x/200x200bb.jpg', 200],
    ['https://x/600x600bb.jpg', 600],
    ['https://x/no-size.jpg', 600],
  ])('%s -> %i', (url, w) => expect(optimizerWidth(url)).toBe(w))
})

describe('image optimizer widths', () => {
  // The optimizer answers 400 for any width not in imageSizes + deviceSizes.
  it('every hard-coded w= in app/ and every optimizerWidth result is an allowed width', () => {
    const cfg = nextConfig.images!
    const allowed = new Set<number>([...cfg.imageSizes!, ...cfg.deviceSizes!])
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f: string) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
    })
    const found: number[] = []
    for (const file of walk(join(__dirname, '..', 'app'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/[?&]w=(\d+)/g)) found.push(Number(m[1]))
    }
    for (const w of found) expect(allowed.has(w)).toBe(true)
    for (const url of ['https://x/100x100bb.jpg', 'https://x/600x600bb.jpg', 'https://x/n.jpg']) {
      expect(allowed.has(optimizerWidth(url))).toBe(true)
    }
  })
})

describe('storedMediaArtwork (lock screen with no network)', () => {
  const entry = (src: string, px: number) => ({ src, sizes: `${px}x${px}`, type: 'image/jpeg' })
  const picture = (size: number, status = 200) => ({ ok: status < 300, status, clone() { return this }, blob: async () => ({ size }) }) as unknown as Response
  const makeUrl = (blob: Blob) => `blob:copy-${(blob as unknown as { size: number }).size}`

  it('offers only the sizes that are stored, each as a blob url of the stored copy', async () => {
    const list = [entry('http://x/v1/songs/a/artwork/thumb/1', 200), entry('http://x/v1/songs/a/artwork/full/1', 600)]
    const stored: Record<string, Response> = { 'http://x/v1/songs/a/artwork/full/1': picture(7) }
    const out = await storedMediaArtwork(list, async u => stored[u], makeUrl)
    expect(out).toEqual([{ src: 'blob:copy-7', sizes: '600x600', type: 'image/jpeg' }])
  })

  it('finds a saved copy of remote art by its remote url', async () => {
    const remote = 'https://is1.mzstatic.com/a/600x600bb.jpg'
    const list = [entry(`/_next/image?url=${encodeURIComponent(remote)}&w=600&q=75`, 600)]
    const out = await storedMediaArtwork(list, async u => (u === remote ? picture(5) : undefined), makeUrl)
    expect(out.map(a => a.src)).toEqual(['blob:copy-5'])
  })

  it('gives no entry at all when nothing is stored', async () => {
    const out = await storedMediaArtwork([entry('http://x/v1/songs/a/artwork/full/1', 600)], async () => undefined, makeUrl)
    expect(out).toEqual([])
  })

  it('skips an empty or partial stored copy', async () => {
    const list = [entry('http://x/a', 200), entry('http://x/b', 600)]
    const stored: Record<string, Response> = { 'http://x/a': picture(0), 'http://x/b': picture(9, 206) }
    expect(await storedMediaArtwork(list, async u => stored[u], makeUrl)).toEqual([])
  })

  it('treats a lookup that throws as not stored', async () => {
    const out = await storedMediaArtwork([entry('http://x/a', 200)], async () => { throw new Error('boom') }, makeUrl)
    expect(out).toEqual([])
  })
})

describe('loadableArtwork (art the OS would show as a blank tile)', () => {
  const note = noArtArtwork('http://app')
  const list = [
    { src: 'http://app/v1/songs/a/artwork/thumb/1', sizes: '200x200', type: 'image/jpeg' },
    { src: 'http://app/v1/songs/a/artwork/full/1', sizes: '600x600', type: 'image/jpeg' },
  ]

  it('keeps the art when its largest image loads, checking only that one', async () => {
    const asked: string[] = []
    const out = await loadableArtwork(list, async src => { asked.push(src); return true }, note)
    expect(out).toBe(list)
    expect(asked).toEqual(['http://app/v1/songs/a/artwork/full/1'])
  })

  it('swaps in the music note when the art fails to load', async () => {
    expect(await loadableArtwork(list, async () => false, note)).toEqual([note])
  })

  it('treats a load that throws as failed', async () => {
    expect(await loadableArtwork(list, async () => { throw new Error('x') }, note)).toEqual([note])
  })

  it('does not check the note itself', async () => {
    const loads = jest.fn(async () => false)
    expect(await loadableArtwork([note], loads, note)).toEqual([note])
    expect(loads).not.toHaveBeenCalled()
  })
})
