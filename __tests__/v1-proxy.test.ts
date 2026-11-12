/** @jest-environment node */
// The /v1 proxy sits between the browser and the API in production. Audio
// seeking and resuming only fetch the bytes they need if the proxy passes the
// range and validator headers up and the 206/304 answers back down.
import { NextRequest } from 'next/server'
import { GET } from '../app/v1/[...path]/route'

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => { global.fetch = realFetch })

function download(headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost:3000/v1/download/abc.mp3', { headers })
}
function sentHeaders(): Headers {
    return fetchMock.mock.calls[0][1].headers
}

describe('request headers sent to the API', () => {
    it.each([
        ['range', 'bytes=6225920-'],
        ['if-range', '"etag-1"'],
        ['if-none-match', '"etag-1"'],
        ['if-modified-since', 'Wed, 01 Jan 2025 00:00:00 GMT'],
    ])('forwards %s', async (name, value) => {
        fetchMock.mockResolvedValueOnce(new Response('x', { status: 200 }))
        await GET(download({ [name]: value }))
        expect(sentHeaders().get(name)).toBe(value)
    })

    it('still forwards the cookie', async () => {
        fetchMock.mockResolvedValueOnce(new Response('x', { status: 200 }))
        await GET(download({ cookie: 'access_token=a' }))
        expect(sentHeaders().get('cookie')).toBe('access_token=a')
    })
})

describe('response passed back to the browser', () => {
    it('passes a 206 with its content-range and content-length', async () => {
        fetchMock.mockResolvedValueOnce(new Response('abc', {
            status: 206,
            headers: { 'content-range': 'bytes 5-7/10', 'content-length': '3', 'accept-ranges': 'bytes' },
        }))
        const res = await GET(download({ range: 'bytes=5-' }))
        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe('bytes 5-7/10')
        expect(res.headers.get('content-length')).toBe('3')
        expect(await res.text()).toBe('abc')
    })

    it('gives a full response its length so the player knows the duration at once', async () => {
        fetchMock.mockResolvedValueOnce(new Response('abcd', { status: 200, headers: { 'content-length': '4' } }))
        const res = await GET(download())
        expect(res.headers.get('content-length')).toBe('4')
    })

    it('drops the length when the API compressed the body (it no longer matches what is sent)', async () => {
        fetchMock.mockResolvedValueOnce(new Response('abcd', {
            status: 200,
            headers: { 'content-length': '2', 'content-encoding': 'gzip' },
        }))
        const res = await GET(download())
        expect(res.headers.get('content-length')).toBeNull()
    })

    it('passes a 304 through with its etag and no body', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"etag-1"' } }))
        const res = await GET(download({ 'if-none-match': '"etag-1"' }))
        expect(res.status).toBe(304)
        expect(res.headers.get('etag')).toBe('"etag-1"')
    })
})

describe('a dead API', () => {
    it('answers 502 on a download', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        const res = await GET(download())
        expect(res.status).toBe(502)
        expect(await res.json()).toEqual({ detail: 'upstream unreachable' })
    })
})
