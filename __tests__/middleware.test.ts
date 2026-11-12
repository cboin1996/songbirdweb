/** @jest-environment node */
// middleware.ts refreshes server-side on a page navigation when the access
// token has expired. The API now rotates the refresh token, so
// the rotated cookie has to reach the browser; dropping it makes the browser's
// next refresh look like token reuse and the API revokes the session.
import { NextRequest } from 'next/server'
import { middleware, config } from '../middleware'

const fetchMock = jest.fn()

function jwtWithExp(expSeconds: number): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${b64({ alg: 'HS256' })}.${b64({ exp: expSeconds })}.sig`
}

const EXPIRED_ACCESS = jwtWithExp(1)
const OLD_REFRESH = 'old-refresh-value'
const NEW_ACCESS = 'new-access-value'
const NEW_REFRESH = 'new-refresh-value'
const ACCESS_LINE = `access_token=${NEW_ACCESS}; HttpOnly; Max-Age=900; Path=/; SameSite=lax`
const REFRESH_LINE = `refresh_token=${NEW_REFRESH}; HttpOnly; Max-Age=7000000; Path=/; SameSite=lax`

function apiResponds(status: number, setCookies: string[] = []) {
    const headers = new Headers()
    for (const line of setCookies) headers.append('set-cookie', line)
    fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, headers })
}

function pageRequest(): NextRequest {
    return new NextRequest('http://localhost:3000/library', {
        headers: { cookie: `access_token=${EXPIRED_ACCESS}; refresh_token=${OLD_REFRESH}; theme=dark` },
    })
}

function forwardedCookies(response: Response): string {
    return response.headers.get('x-middleware-request-cookie') ?? ''
}

beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
})

describe('middleware refresh', () => {
    it('sends both rotated cookies to the browser exactly as the API set them', async () => {
        apiResponds(200, [ACCESS_LINE, REFRESH_LINE])

        const response = await middleware(pageRequest())

        expect(response.headers.getSetCookie()).toEqual([ACCESS_LINE, REFRESH_LINE])
    })

    it('forwards the rotated cookies to the page, replacing the stale ones once', async () => {
        apiResponds(200, [ACCESS_LINE, REFRESH_LINE])

        const response = await middleware(pageRequest())

        const forwarded = forwardedCookies(response)
        expect(forwarded.match(/refresh_token=/g)).toHaveLength(1)
        expect(forwarded.match(/access_token=/g)).toHaveLength(1)
        expect(forwarded).toContain(`refresh_token=${NEW_REFRESH}`)
        expect(forwarded).toContain(`access_token=${NEW_ACCESS}`)
        expect(forwarded).toContain('theme=dark')
        expect(forwarded).not.toContain(OLD_REFRESH)
    })

    it('leaves the refresh cookie alone when the API sets only the access cookie', async () => {
        // The web release deploys before the API, so for a while the API still
        // answers a refresh with the access cookie alone.
        apiResponds(200, [ACCESS_LINE])

        const response = await middleware(pageRequest())

        expect(response.headers.getSetCookie()).toEqual([ACCESS_LINE])
        const forwarded = forwardedCookies(response)
        expect(forwarded.match(/refresh_token=/g)).toHaveLength(1)
        expect(forwarded).toContain(`refresh_token=${OLD_REFRESH}`)
        expect(forwarded).toContain(`access_token=${NEW_ACCESS}`)
    })

    it('sends the refresh request with the browser refresh cookie', async () => {
        apiResponds(200, [ACCESS_LINE, REFRESH_LINE])

        await middleware(pageRequest())

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][1].headers.Cookie).toBe(`refresh_token=${OLD_REFRESH}`)
    })

    it.each([401, 403])('sends the user to sign in when the API says %i', async (status) => {
        apiResponds(status)

        const response = await middleware(pageRequest())

        expect(response.status).toBe(307)
        expect(new URL(response.headers.get('location')!).pathname).toBe('/')
    })

    it('lets the page load when the API is failing, not a sign-out', async () => {
        apiResponds(500)

        const response = await middleware(pageRequest())

        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(response.headers.get('location')).toBeNull()
    })

    it('lets the page load when the API says ok but sets no access cookie, not a sign-out', async () => {
        apiResponds(200, [REFRESH_LINE])

        const response = await middleware(pageRequest())

        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(response.headers.get('location')).toBeNull()
    })

    it('lets the page load when the API cannot be reached', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

        const response = await middleware(pageRequest())

        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(response.headers.get('location')).toBeNull()
    })
})

// Next turns the matcher into a regex over the path; the same shape is built here.
describe('which requests the middleware sees', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)

    it.each(['/library', '/explore', '/settings', '/v1/download/abc.mp3'])('runs for %s', (path) => {
        expect(matcher.test(path)).toBe(true)
    })

    it.each([
        '/v1/songs/library', '/v1/player/state', '/v1/library/abc/position',
        '/v1/auth/refresh', '/v1/share/tok/info', '/_next/static/chunk.js', '/sw.js',
    ])('skips %s', (path) => {
        expect(matcher.test(path)).toBe(false)
    })
})

describe('where the middleware refreshes', () => {
    it('uses the API base the app is configured with', async () => {
        jest.resetModules()
        process.env.API_BASE_URL = 'http://api.internal:9000'
        const { middleware: fresh } = await import('../middleware')
        apiResponds(200, [ACCESS_LINE, REFRESH_LINE])
        await fresh(pageRequest())
        expect(fetchMock.mock.calls[0][0]).toBe('http://api.internal:9000/v1/auth/refresh')
        delete process.env.API_BASE_URL
    })
})
