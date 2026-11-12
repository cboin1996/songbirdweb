import { test, expect } from '@playwright/test'
import { API_V1, apiLoginAs } from './helpers'
import { BENCH_USER, BENCH_PASS, BENCH_SONG_COUNT, seedBenchLibrary } from './seed-bench'
import { skipWithoutBench } from './bench-gate'

// The benchmark flow needs a library big enough to show per-song cost. Global
// setup seeds it when E2E_SEED_BENCH=1 (set by the local harness and CI).
skipWithoutBench()

test.describe('benchmark library seed', () => {
    test('the bench user holds exactly 1000 varied songs', async () => {
        const api = await apiLoginAs(BENCH_USER, BENCH_PASS)
        try {
            const res = await api.get(`${API_V1}/songs/library`)
            expect(res.ok()).toBeTruthy()
            const songs = (await res.json()) as { uuid: string; properties?: { trackName?: string; artistName?: string; collectionName?: string } }[]
            expect(BENCH_SONG_COUNT).toBe(1000)
            expect(songs).toHaveLength(1000)
            expect(new Set(songs.map(s => s.uuid)).size).toBe(1000)

            // Titles start with every letter of the alphabet so grouping and the
            // letter rail have real work; artists and albums repeat across songs.
            const letters = new Set(songs.map(s => (s.properties?.trackName ?? '').charAt(0).toUpperCase()))
            expect([...letters].sort().join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            expect(new Set(songs.map(s => s.properties?.artistName)).size).toBe(60)
            expect(new Set(songs.map(s => s.properties?.collectionName)).size).toBe(120)
        } finally {
            await api.dispose()
        }
    })

    test('seeding again skips and stays within the time cap', async () => {
        const result = await seedBenchLibrary()
        expect(result.skipped).toBe(true)
        expect(result.inserted).toBe(0)
        expect(result.ms).toBeLessThan(5000)

        const api = await apiLoginAs(BENCH_USER, BENCH_PASS)
        try {
            const res = await api.get(`${API_V1}/songs/library`)
            expect(await res.json()).toHaveLength(1000)
        } finally {
            await api.dispose()
        }
    })
})
