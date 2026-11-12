// A play is recorded once per load of a song, after 30 s of listening, however
// many times it is paused. The clock adds up the stretches the song was playing.
import { createListenClock } from '../app/lib/listen-clock'

describe('listen clock', () => {
    it('needs the full threshold when nothing has played', () => {
        expect(createListenClock(() => 0).remainingMs(30000)).toBe(30000)
    })

    it('counts a stretch of playing', () => {
        let now = 1000
        const clock = createListenClock(() => now)
        clock.start()
        now = 21000
        clock.stop()
        expect(clock.remainingMs(30000)).toBe(10000)
    })

    it('adds stretches across pauses, so 20 s + pause + 20 s is past 30 s', () => {
        let now = 0
        const clock = createListenClock(() => now)
        clock.start(); now = 20000; clock.stop()
        now = 50000
        clock.start()
        expect(clock.remainingMs(30000)).toBe(10000)
        now = 60000
        expect(clock.remainingMs(30000)).toBe(0)
    })

    it('counts the stretch still running', () => {
        let now = 0
        const clock = createListenClock(() => now)
        clock.start()
        now = 12000
        expect(clock.remainingMs(30000)).toBe(18000)
    })

    it('reset starts a new load from nothing', () => {
        let now = 0
        const clock = createListenClock(() => now)
        clock.start(); now = 25000; clock.stop()
        clock.reset()
        expect(clock.remainingMs(30000)).toBe(30000)
    })

    it('a second start while running does not double count', () => {
        let now = 0
        const clock = createListenClock(() => now)
        clock.start(); now = 5000; clock.start(); now = 10000
        expect(clock.remainingMs(30000)).toBe(20000)
    })
})
