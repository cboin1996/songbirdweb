import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { routes } from '@/app/lib/routes'

const API_BASE = `http://${process.env.NEXT_PUBLIC_API_HOST ?? 'localhost'}:8000`

function isExpired(token: string): boolean {
  try {
    const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(raw))
    return exp * 1000 < Date.now()
  } catch {
    return true
  }
}

// The API rotates the refresh token (once it is over a minute old) and sets both cookies.
// Hand its Set-Cookie lines to the browser exactly as sent (they carry the
// Max-Age and flags the API chose) and remember each cookie's new value so the
// page being rendered sees the same cookies the browser will hold.
// Resolves to the Set-Cookie lines, or null when the API rejects the session
// (401/403). Throws on anything else.
async function refreshSession(refreshToken: string): Promise<string[] | null> {
  const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `refresh_token=${refreshToken}` },
  })
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
  const lines = res.headers.getSetCookie()
  // An ok answer that sets no access cookie is the API misbehaving, not a
  // rejected session: treat it like a failure so nobody is signed out for it.
  if (!lines.some(line => line.startsWith('access_token='))) {
    throw new Error('refresh answered ok without an access cookie')
  }
  return lines
}

function cookieNameAndValue(setCookie: string): [string, string] {
  const pair = setCookie.split(';')[0]
  const eq = pair.indexOf('=')
  return [pair.slice(0, eq), pair.slice(eq + 1)]
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')
  const refreshToken = request.cookies.get('refresh_token')
  const isLoginPage = request.nextUrl.pathname === routes.home
  const isSharePage = request.nextUrl.pathname.startsWith('/share/')
  const isOfflinePage = request.nextUrl.pathname === '/offline'
  const isAuthApi = request.nextUrl.pathname.startsWith('/v1/auth/')
  // /v1/share/<token>/{info,download} are anon-accessible by design;
  // middleware must let them through for unauthed visitors clicking
  // a share link's download button. (POST /v1/share/songs/<id> for
  // creators is auth-gated by the API itself.)
  const isShareApi = request.nextUrl.pathname.startsWith('/v1/share/')

  const validToken = accessToken && !isExpired(accessToken.value)

  if (validToken && isLoginPage) return NextResponse.redirect(new URL(routes.download, request.url))
  if (validToken) return NextResponse.next()
  if (isLoginPage || isSharePage || isOfflinePage || isAuthApi || isShareApi) return NextResponse.next()

  if (refreshToken) {
    let setCookies: string[] | null = null
    try {
      setCookies = await refreshSession(refreshToken.value)
    } catch {
      // The API is failing or unreachable: that says nothing about the
      // session, so do not sign anyone out. Matches data.ts.
      return NextResponse.next()
    }
    if (setCookies) {
      const rotated = new Map(setCookies.map(cookieNameAndValue))
      const cookieStr = [
        ...request.cookies.getAll().filter(c => !rotated.has(c.name)).map(c => `${c.name}=${c.value}`),
        ...Array.from(rotated, ([name, value]) => `${name}=${value}`),
      ].join('; ')
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('cookie', cookieStr)
      const response = NextResponse.next({ request: { headers: requestHeaders } })
      for (const line of setCookies) response.headers.append('set-cookie', line)
      return response
    }
  }

  return NextResponse.redirect(new URL(routes.home, request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon-.*\\.png).*)'],
}
