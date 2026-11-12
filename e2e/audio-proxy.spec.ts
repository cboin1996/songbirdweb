import { test, expect } from './fixtures/test'
import { login } from './helpers'

// The web app's own /v1 proxy is what production audio goes through (the e2e
// harness points the browser at the API directly, so the player never touches
// it). These ask the proxy for ranges the way a seeking browser does.
test.describe('audio through the web proxy', () => {
    let webBase: string
    let songUrl: string

    test.beforeEach(async ({ page, baseURL }) => {
        webBase = baseURL!
        await login(page)
        const list = await page.request.get(`${webBase}/v1/songs/library`)
        expect(list.status()).toBe(200)
        const songs = await list.json()
        const first = Array.isArray(songs) ? songs[0] : songs.songs[0]
        songUrl = `${webBase}/v1/download/${first.uuid ?? first.songId ?? first.id}`
    })

    test('a range request is answered 206 with only those bytes', async ({ page }) => {
        const whole = await page.request.get(songUrl)
        expect(whole.status()).toBe(200)
        const total = Number(whole.headers()['content-length'])
        expect(total).toBeGreaterThan(1_000_000)

        const part = await page.request.get(songUrl, { headers: { range: 'bytes=1000-1999' } })
        expect(part.status()).toBe(206)
        expect(part.headers()['content-range']).toBe(`bytes 1000-1999/${total}`)
        expect((await part.body()).length).toBe(1000)
    })

    test('a full response carries its length so the duration is right at once', async ({ page }) => {
        const res = await page.request.get(songUrl)
        const body = await res.body()
        expect(Number(res.headers()['content-length'])).toBe(body.length)
    })

    // 304 is not covered here: the API sends an etag but answers 200 to If-None-Match
    // and marks downloads no-store, so the proxy passing a 304 is only unit tested.
})
