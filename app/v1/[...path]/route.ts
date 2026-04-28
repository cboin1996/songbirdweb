import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:8000'

async function proxy(req: NextRequest) {
    const path = req.nextUrl.pathname
    const search = req.nextUrl.search
    const target = `${API_BASE}${path}${search}`

    const headers = new Headers()
    const cookie = req.headers.get('cookie')
    if (cookie) headers.set('cookie', cookie)
    const contentType = req.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    const auth = req.headers.get('authorization')
    if (auth) headers.set('authorization', auth)

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const res = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        // @ts-expect-error - duplex required for streaming body
        duplex: 'half',
    })

    const resHeaders = new Headers()
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) resHeaders.set('set-cookie', setCookie)
    const resContentType = res.headers.get('content-type')
    if (resContentType) resHeaders.set('content-type', resContentType)

    return new NextResponse(res.body, { status: res.status, headers: resHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
