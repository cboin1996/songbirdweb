import { defaultFrostedBars, getFrostedBars, setFrostedBars, applyFrostedBars, getPerfOverlay, setPerfOverlay } from '../app/lib/device-settings'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.frosted
  window.matchMedia = ((q: string) => ({ matches: q.includes('min-width'), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})

describe('defaultFrostedBars', () => {
  it('desktop is on', () => expect(defaultFrostedBars({ desktop: true, reduceTransparency: false })).toBe(true))
  // Decided after the iPhone comparison (no measurable difference): on. Flip with PHONE_FROSTED_DEFAULT.
  it('phone default', () => expect(defaultFrostedBars({ desktop: false, reduceTransparency: false })).toBe(true))
  it('reduce transparency is off, desktop or not', () => {
    expect(defaultFrostedBars({ desktop: true, reduceTransparency: true })).toBe(false)
    expect(defaultFrostedBars({ desktop: false, reduceTransparency: true })).toBe(false)
  })
})

describe('stored choice', () => {
  it('falls back to the default when nothing is stored', () => {
    expect(getFrostedBars()).toBe(true)
  })
  it('setting survives a read and marks the page', () => {
    setFrostedBars(false)
    expect(getFrostedBars()).toBe(false)
    expect(document.documentElement.dataset.frosted).toBe('off')
    setFrostedBars(true)
    expect(document.documentElement.dataset.frosted).toBe('on')
  })
  it('ignores a garbage stored value', () => {
    localStorage.setItem('songbird-frosted-bars', 'maybe')
    expect(getFrostedBars()).toBe(true)
  })
  it('still works when storage throws', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getFrostedBars()).toBe(true)
    setFrostedBars(false)
    expect(document.documentElement.dataset.frosted).toBe('off')
    applyFrostedBars()
    get.mockRestore(); set.mockRestore()
  })
})

describe('performance overlay setting', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('is off until the device asks for it', () => {
    expect(getPerfOverlay()).toBe(false)
    setPerfOverlay(true)
    expect(getPerfOverlay()).toBe(true)
  })

  it('turning it off also drops the flag a ?perf=1 visit left for the session', () => {
    setPerfOverlay(true)
    sessionStorage.setItem('songbird:perf', '1')
    setPerfOverlay(false)
    expect(getPerfOverlay()).toBe(false)
    expect(sessionStorage.getItem('songbird:perf')).toBeNull()
  })
})
