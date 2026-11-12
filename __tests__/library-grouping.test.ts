import { groupAlbumsByLetter, groupSongsByGenre, groupSongsByLetter, letterKey } from '../app/lib/library-grouping'
import type { LibrarySong } from '../app/lib/data'

const song = (uuid: string, p: Record<string, unknown>): LibrarySong =>
  ({ uuid, properties: { trackName: '', artistName: '', collectionName: '', ...p } } as unknown as LibrarySong)

const ids = (m: Map<string, LibrarySong[]>) => [...m.entries()].map(([k, v]) => [k, v.map(s => s.uuid)])

describe('letterKey', () => {
  it('uppercases the first letter and files the rest under #', () => {
    expect(letterKey('banana')).toBe('B')
    expect(letterKey('  zed')).toBe('Z')
    expect(letterKey('7 rings')).toBe('#')
    expect(letterKey('')).toBe('#')
  })
})

describe('groupSongsByLetter', () => {
  const songs = [
    song('s1', { trackName: 'Zebra', artistName: 'Beta' }),
    song('s2', { trackName: '99 Problems', artistName: 'Alpha' }),
    song('s3', { trackName: 'apple', artistName: 'Beta' }),
    song('s4', { trackName: 'Apricot', artistName: 'Alpha' }),
  ]
  it('songs: by title, # last, groups in A..Z order', () => {
    expect(ids(groupSongsByLetter(songs, 'songs'))).toEqual([['A', ['s3', 's4']], ['Z', ['s1']], ['#', ['s2']]])
  })
  it('artists: by artist then title', () => {
    expect(ids(groupSongsByLetter(songs, 'artists'))).toEqual([['A', ['s2', 's4']], ['B', ['s3', 's1']]])
  })
  it('leaves out songs without properties and does not reorder its input', () => {
    const bare = { uuid: 'x' } as LibrarySong
    const input = [songs[0], bare]
    expect(ids(groupSongsByLetter(input, 'songs'))).toEqual([['Z', ['s1']]])
    expect(input.map(s => s.uuid)).toEqual(['s1', 'x'])
  })
})

describe('groupSongsByGenre', () => {
  it('genre then title, Unknown last', () => {
    const songs = [
      song('a', { trackName: 'B', primaryGenreName: 'Rock' }),
      song('b', { trackName: 'A' }),
      song('c', { trackName: 'C', primaryGenreName: 'Jazz' }),
      song('d', { trackName: 'A', primaryGenreName: 'Rock' }),
    ]
    expect(ids(groupSongsByGenre(songs))).toEqual([['Jazz', ['c']], ['Rock', ['d', 'a']], ['Unknown', ['b']]])
  })
})

describe('groupAlbumsByLetter', () => {
  it('groups tracks into albums in disc/track order, albums by name', () => {
    const songs = [
      song('t2', { collectionId: '2', collectionName: 'Zoo', artistName: 'Z', trackNumber: 2, discNumber: 1 }),
      song('t1', { collectionId: '2', collectionName: 'Zoo', artistName: 'Z', trackNumber: 1, discNumber: 1 }),
      song('u1', { collectionId: '1', collectionName: 'Ark', artistName: 'A', trackNumber: 1, discNumber: 1 }),
    ]
    const grouped = groupAlbumsByLetter(songs)
    expect([...grouped.keys()]).toEqual(['A', 'Z'])
    expect(grouped.get('Z')![0].songs.map(s => s.uuid)).toEqual(['t1', 't2'])
    expect(grouped.get('A')![0].collectionName).toBe('Ark')
  })
})

describe('titles with leading spaces', () => {
  it('sort by their first letter, so sections stay in alphabet order', () => {
    const m = groupSongsByLetter([
      song('z', { trackName: ' Zebra' }), song('y', { trackName: ' Yak' }),
      song('a', { trackName: 'Apple' }), song('n', { trackName: '7 up' }),
    ], 'songs')
    expect([...m.keys()]).toEqual(['A', 'Y', 'Z', '#'])
  })
})
