// The numbers the ?perf=1 overlay shows come from these pure helpers, so the
// maths and the on/off decision are checked here with literal expected values.
import { classifyRequest, droppedFrames, percentile, perfFlagFrom } from '../app/lib/perf-stats'

describe('percentile', () => {
  it('takes the nearest rank, so p95 of 1..20 is 19', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(19)
  })

  it('takes p75 of four values as the third', () => {
    expect(percentile([40, 10, 30, 20], 75)).toBe(30)
  })

  it('returns 0 for no samples', () => {
    expect(percentile([], 95)).toBe(0)
  })

  it('does not reorder the caller\'s array', () => {
    const values = [3, 1, 2]
    percentile(values, 50)
    expect(values).toEqual([3, 1, 2])
  })
})

describe('classifyRequest', () => {
  it('names the polled and saved requests', () => {
    expect(classifyRequest('http://x/v1/library/abc/position')).toBe('position')
    expect(classifyRequest('http://x/v1/player/state')).toBe('state')
    expect(classifyRequest('http://x/v1/songs/abc/play')).toBe('play')
    expect(classifyRequest('http://x/v1/download/abc.mp3')).toBe('audio')
  })

  it('files other API calls under other', () => {
    expect(classifyRequest('http://x/v1/songs/library')).toBe('other')
    expect(classifyRequest('http://x/v1/playlists')).toBe('other')
  })

  it('ignores anything that is not an API call', () => {
    expect(classifyRequest('http://x/_next/static/chunk.js')).toBeNull()
    expect(classifyRequest('http://x/library')).toBeNull()
  })
})

describe('droppedFrames', () => {
  it('counts the frames missed inside a long gap', () => {
    // 16.7 ms frames, then one 50 ms gap: three frames' worth, two were missed.
    expect(droppedFrames([16.7, 16.7, 50, 16.7], 16.7)).toEqual({ dropped: 2, worst: 50 })
  })

  it('does not count a gap under one and a half frames', () => {
    expect(droppedFrames([16.7, 24, 16.7], 16.7)).toEqual({ dropped: 0, worst: 24 })
  })

  it('ignores a gap over a second: the page was hidden, not janky', () => {
    expect(droppedFrames([16.7, 5000, 16.7], 16.7)).toEqual({ dropped: 0, worst: 16.7 })
  })
})

describe('perfFlagFrom', () => {
  it('is on for ?perf=1', () => {
    expect(perfFlagFrom({ search: '?perf=1', stored: null, override: false })).toBe(true)
  })

  it('stays on for the session once the flag was seen', () => {
    expect(perfFlagFrom({ search: '', stored: '1', override: false })).toBe(true)
  })

  it('is on for the test override', () => {
    expect(perfFlagFrom({ search: '', stored: null, override: true })).toBe(true)
  })

  it('is on when this device asked for it', () => {
    expect(perfFlagFrom({ search: '', stored: null, override: false, device: true })).toBe(true)
  })

  it('is off for ?perf=0 even when this device asked for it', () => {
    expect(perfFlagFrom({ search: '?perf=0', stored: '1', override: true, device: true })).toBe(false)
  })

  it('is off by default', () => {
    expect(perfFlagFrom({ search: '?x=1', stored: null, override: false })).toBe(false)
  })

  it('?perf=0 turns a stored flag off', () => {
    expect(perfFlagFrom({ search: '?perf=0', stored: '1', override: false })).toBe(false)
  })
})
