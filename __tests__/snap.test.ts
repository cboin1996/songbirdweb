import { snap } from '../app/lib/snap'

const TRIM = { start: 0, end: 30 }
const T = TRIM

function size(r: { start: number; end: number }) {
    return r.end - r.start
}

// ---- resize (preserveSize=false) ----

describe('resize mode', () => {
    it('no-op when within trim and no obstacles', () => {
        expect(snap(5, 10, [], undefined, T.start, T.end)).toEqual({ start: 5, end: 10 })
    })

    it('clamps start to trimStart', () => {
        const r = snap(-2, 5, [], undefined, T.start, T.end)
        expect(r.start).toBe(0)
        expect(r.end).toBe(5)
    })

    it('clamps end to trimEnd', () => {
        const r = snap(25, 35, [], undefined, T.start, T.end)
        expect(r.end).toBe(30)
    })

    it('pushes end to obstacle start when center is left of obstacle center', () => {
        // rawCenter=8, obsCenter=10 → push end to 9
        const r = snap(6, 10, [{ id: 'b', start: 9, end: 11 }], 'a', T.start, T.end)
        expect(r.end).toBe(9)
    })

    it('pushes start to obstacle end when center is right of obstacle center', () => {
        // rawCenter=12, obsCenter=10 → push start to 11
        const r = snap(10, 14, [{ id: 'b', start: 9, end: 11 }], 'a', T.start, T.end)
        expect(r.start).toBe(11)
    })
})

// ---- drag (preserveSize=true) ----

describe('drag mode (preserveSize)', () => {
    function obs_(id: string, start: number, end: number) {
        return { id, start, end }
    }

    type Obs = ReturnType<typeof obs_>

    const drag = (rS: number, rE: number, obs: Obs[], id?: string) =>
        snap(rS, rE, obs, id, T.start, T.end, true)

    it('no-op when within trim and no obstacles', () => {
        const r = drag(5, 10, [])
        expect(r).toEqual({ start: 5, end: 10 })
        expect(size(r)).toBe(5)
    })

    it('slides right when rawStart < trimStart', () => {
        const r = drag(-1, 4, [])
        expect(r.start).toBe(0)
        expect(size(r)).toBe(5)
    })

    it('slides left when rawEnd > trimEnd', () => {
        const r = drag(27, 32, [])
        expect(r.end).toBe(30)
        expect(size(r)).toBe(5)
    })

    it('does not compress when pushed left by obstacle with room', () => {
        // fade [5,10], cut [12,14], drag toward cut
        const r = drag(9, 14, [obs_('cut', 12, 14)], 'fade')
        expect(size(r)).toBe(5)
        expect(r.end).toBeLessThanOrEqual(12)
    })

    it('does not compress when pushed right by obstacle with room', () => {
        // fade [20,25], cut [12,14], drag toward cut
        const r = drag(11, 16, [obs_('cut', 12, 14)], 'fade')
        expect(size(r)).toBe(5)
        expect(r.start).toBeGreaterThanOrEqual(14)
    })

    it('tries opposite side when preferred side has no room (trimStart)', () => {
        // trimStart=7, fade size=5, obstacle [10,12]
        // Left side needs [5,10] but 5 < trimStart=7 → can't fit → try right [12,17]
        const r = snap(8, 13, [obs_('cut', 10, 12)], 'fade', 7, 30, true)
        expect(size(r)).toBe(5)
        expect(r.start).toBeGreaterThanOrEqual(12)
    })

    it('tries opposite side when preferred side has no room (trimEnd)', () => {
        // trimEnd=14, fade size=5, obstacle [10,12]
        // Right side needs [12,17] but 17 > trimEnd=14 → can't fit → try left [5,10]
        const r = snap(8, 13, [obs_('cut', 10, 12)], 'fade', 0, 14, true)
        expect(size(r)).toBe(5)
        expect(r.end).toBeLessThanOrEqual(10)
    })

    it('does not compress when trim gap is insufficient on one side', () => {
        // Any scenario — returned size must equal original
        const obs = [obs_('cut', 10, 12)]
        for (let rS = 0; rS <= 20; rS += 0.5) {
            const r = snap(rS, rS + 5, obs, 'fade', 0, 30, true)
            expect(size(r)).toBeCloseTo(5, 5)
        }
    })

    it('excludes self from obstacles', () => {
        const r = drag(5, 10, [obs_('fade', 5, 10)], 'fade')
        expect(r).toEqual({ start: 5, end: 10 })
    })

    it('multiple obstacles: correct side chosen', () => {
        // fade size=3, cut1=[5,7], cut2=[14,16], drag to center [10,13]
        const obs = [obs_('c1', 5, 7), obs_('c2', 14, 16)]
        const r = snap(10, 13, obs, 'fade', 0, 30, true)
        expect(size(r)).toBe(3)
        // Should be in the gap [7,14]
        expect(r.start).toBeGreaterThanOrEqual(7)
        expect(r.end).toBeLessThanOrEqual(14)
    })
})
