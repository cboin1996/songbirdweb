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

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    })
    if (!res.ok) return null
    const match = res.headers.get('set-cookie')?.match(/access_token=([^;]+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')
  const refreshToken = request.cookies.get('refresh_token')
  const isLoginPage = request.nextUrl.pathname === routes.home
  const isSharePage = request.nextUrl.pathname.startsWith('/share/')
  const isOfflinePage = request.nextUrl.pathname === '/offline'

  const validToken = accessToken && !isExpired(accessToken.value)

  if (validToken && isLoginPage) return NextResponse.redirect(new URL(routes.download, request.url))
  if (validToken) return NextResponse.next()
  if (isLoginPage || isSharePage || isOfflinePage) return NextResponse.next()

  if (refreshToken) {
    const newToken = await refreshAccessToken(refreshToken.value)
    if (newToken) {
      const cookieStr = request.cookies.getAll()
        .filter(c => c.name !== 'access_token')
        .map(c => `${c.name}=${c.value}`)
        .join('; ')
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('cookie', `access_token=${newToken}; ${cookieStr}`)
      const response = NextResponse.next({ request: { headers: requestHeaders } })
      response.cookies.set('access_token', newToken, { httpOnly: true, sameSite: 'lax', path: '/' })
      return response
    }
  }

  return NextResponse.redirect(new URL(routes.home, request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon-.*\\.png).*)'],
}
