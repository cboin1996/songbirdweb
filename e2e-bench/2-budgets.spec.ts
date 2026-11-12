import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { skipWithoutBench } from '../e2e/bench-gate'

// Budgets on the counts 1-scenarios.spec.ts records. Counts, never milliseconds.
// Each budget marked test.fail() is not met on the baseline commit: the ticket
// that fixes it deletes the test.fail() line, so the budget starts to bite.
// Budgets without it already hold and guard against regressions.

skipWithoutBench()

type Counts = Record<string, number>
type Metrics = {
    runStartedAt: number
    coldLoad: { libraryRequests: number }
    playback: { counts: Counts; layouts: number }
    trackChange: Counts
    trackChangeAudioRequests: number
    trackChangeAudioRanges: string[]
    playPause: { pause: Counts; resume: Counts }
    toast: Counts
    seek: { all: { status: number; range: string | null; contentRange: string | null; contentLength: string | null }[]; played?: { currentTime: number; duration: number } }
    searchKeystrokes: Counts[]
    letterRailScrub: Counts | null
    queueOpen: { counts: Counts }
}

// 1-scenarios.spec.ts runs first (one worker, file name order) and writes the file; read it only when the tests run.
let m: Metrics
test.beforeAll(() => {
    m = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../bench-results/metrics.json'), 'utf-8'))
    // A file left by an earlier run would keep these green whatever the code now does.
    if (!m.runStartedAt || Date.now() - m.runStartedAt > 30 * 60_000) {
        throw new Error('bench-results/metrics.json is not from this run: run the whole bench project (make test-e2e-bench)')
    }
})

test('library is fetched once on a cold load (T4)', () => {
    expect(m.coldLoad.libraryRequests).toBeLessThanOrEqual(1)
})

test('20 s of playback re-renders the player at most once (T2)', () => {
    expect(m.playback.counts.player).toBeLessThanOrEqual(1)
})

test('10 s of playback with the queue open re-renders the queue list at most 2 times', () => {
    expect(m.queueOpen.counts.queueList).toBeLessThanOrEqual(2)
    expect(m.queueOpen.counts.row).toBe(0)
})

test('playback re-renders no library rows', () => {
    expect(m.playback.counts.row).toBe(0)
})

test('a track change re-renders at most 2 rows (T3)', () => {
    expect(m.trackChange.row).toBeLessThanOrEqual(2)
})

test('play and pause re-render at most 2 rows each (T3)', () => {
    expect(Math.max(m.playPause.pause.row, m.playPause.resume.row)).toBeLessThanOrEqual(2)
})

test('a track change asks for the audio once (T5)', () => {
    // Requests from the start of the file; a later range is the browser reading the tail.
    expect(m.trackChangeAudioRequests, JSON.stringify(m.trackChangeAudioRanges)).toBeLessThanOrEqual(1)
})

test('a toast re-renders no library rows (T3)', () => {
    expect(m.toast.row).toBe(0)
})

test('a keystroke in search re-renders at most 2 lists and no rows', () => {
    for (const k of m.searchKeystrokes) {
        expect(k.list).toBeLessThanOrEqual(2)
        expect(k.row).toBe(0)
    }
})

test('a letter-rail scrub re-renders the list at most twice (T7)', () => {
    // The rail is shown on the desktop project; a layout change that hides it must not pass quietly.
    expect(m.letterRailScrub).not.toBeNull()
    expect(m.letterRailScrub!.list).toBeLessThanOrEqual(2)
})

test('a seek is answered with a partial response, not the whole file', () => {
    const seek = m.seek.all[m.seek.all.length - 1]
    const seen = JSON.stringify(m.seek, null, 1)
    expect(seek.status, seen).toBe(206)
    expect(seek.range, seen).toMatch(/^bytes=\d+-/)
    // The answer starts past the beginning and carries a tail, not the whole file again.
    // How far in depends on the file (its container and bitrate decide where the browser
    // asks for a time), so the budget is "not from the start, not all of it", and the run's
    // own numbers are in the failure message.
    const total = Number(/\/(\d+)$/.exec(seek.contentRange ?? '')?.[1])
    const start = Number(/^bytes (\d+)-/.exec(seek.contentRange ?? '')?.[1])
    expect(total, seen).toBeGreaterThan(0)
    expect(start, seen).toBeGreaterThan(0)
    expect(Number(seek.contentLength), seen).toBeLessThan(total * 0.9)
})
