import {
  artworkVersion, artworkVersionQuery, bumpArtworkVersion, mediaSessionArtwork,
  normalizeArtworkSize, optimizerWidth, resetArtworkVersions,
} from '../app/lib/artwork'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import nextConfig from '../next.config'
import { artworkUrl, songArtworkUrl } from '../app/lib/data'

beforeEach(() => { localStorage.clear(); resetArtworkVersions() })

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

describe('artwork versions', () => {
  it('start at zero and add nothing to the url', () => {
    expect(artworkVersion('abc')).toBe(0)
    expect(songArtworkUrl('abc', true, undefined, 200)).toBe('/v1/songs/abc/artwork/thumb')
  })
  it('bump adds ?v= to every local size of that song only', () => {
    expect(bumpArtworkVersion('abc')).toBe(1)
    expect(bumpArtworkVersion('abc')).toBe(2)
    expect(songArtworkUrl('abc', true, undefined, 200)).toBe('/v1/songs/abc/artwork/thumb?v=2')
    expect(songArtworkUrl('abc', true, undefined, 600)).toBe('/v1/songs/abc/artwork/full?v=2')
    expect(songArtworkUrl('other', true, undefined, 200)).toBe('/v1/songs/other/artwork/thumb')
    expect(artworkVersionQuery('abc')).toBe('?v=2')
  })
  it('survives a reload (read back from storage)', () => {
    bumpArtworkVersion('abc')
    resetArtworkVersions()
    expect(artworkVersion('abc')).toBe(1)
  })
})

describe('mediaSessionArtwork', () => {
  const urlFor = (song: { uuid: string; artwork_cached: boolean }) => (s: number) =>
    songArtworkUrl(song.uuid, song.artwork_cached, 'https://x/100x100bb.jpg', s)

  it('lists the stored thumbnail and full image for a song with a local copy', () => {
    const song = { uuid: 'abc', artwork_cached: true }
    expect(mediaSessionArtwork(song, urlFor(song), 'http://app')).toEqual([
      { src: 'http://app/v1/songs/abc/artwork/thumb', sizes: '200x200', type: 'image/jpeg' },
      { src: 'http://app/v1/songs/abc/artwork/full', sizes: '600x600', type: 'image/jpeg' },
    ])
  })
  it('lists only the large remote image otherwise', () => {
    const song = { uuid: 'abc', artwork_cached: false }
    expect(mediaSessionArtwork(song, urlFor(song), 'http://app')).toEqual([
      { src: 'https://x/600x600bb.jpg', sizes: '600x600', type: 'image/jpeg' },
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

describe('stored versions are validated', () => {
  it('keeps only whole positive numbers', () => {
    localStorage.setItem('songbird-artwork-versions', JSON.stringify({ a: 5, b: '5', c: 0, d: -1, e: 1.5, f: null, g: 2 }))
    resetArtworkVersions()
    expect([artworkVersion('a'), artworkVersion('b'), artworkVersion('c'), artworkVersion('d'), artworkVersion('e'), artworkVersion('f'), artworkVersion('g')])
      .toEqual([5, 0, 0, 0, 0, 0, 2])
  })
  it('ignores a stored value that is not an object', () => {
    localStorage.setItem('songbird-artwork-versions', '[1,2]')
    resetArtworkVersions()
    expect(artworkVersion('0')).toBe(0)
  })
})
