import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:8000'

async function proxyImpl(req: NextRequest) {
    const path = req.nextUrl.pathname
    const search = req.nextUrl.search
    const target = `${API_BASE}${path}${search}`

    const headers = new Headers()
    const cookie = req.headers.get('cookie')
    if (cookie) headers.set('cookie', cookie)
    const auth = req.headers.get('authorization')
    if (auth) headers.set('authorization', auth)
    const contentType = req.headers.get('content-type') ?? ''

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    // For multipart, parse via formData() and let fetch regenerate the boundary.
    // For everything else, buffer the body (avoids stream races on parallel requests).
    let body: BodyInit | undefined
    if (hasBody) {
        if (contentType.startsWith('multipart/')) {
            body = await req.formData()
        } else {
            body = await req.arrayBuffer()
            if (contentType) headers.set('content-type', contentType)
        }
    }
    const res = await fetch(target, { method: req.method, headers, body })

    // Forward headers that affect how the browser handles the response.
    // 'content-disposition' makes downloads save to disk instead of playing
    // inline; range/accept-ranges are required for media seeking. Do NOT
    // forward content-length: Next computes its own from the stream and
    // forwarding the upstream value can mismatch and 500.
    const FORWARD_HEADERS = [
        'set-cookie',
        'content-type',
        'content-disposition',
        'content-range',
        'accept-ranges',
        'cache-control',
        'etag',
        'last-modified',
    ]
    const resHeaders = new Headers()
    for (const name of FORWARD_HEADERS) {
        const v = res.headers.get(name)
        if (v) resHeaders.set(name, v)
    }

    return new NextResponse(res.body, { status: res.status, headers: resHeaders })
}

async function proxy(req: NextRequest) {
    try {
        return await proxyImpl(req)
    } catch (err) {
        console.error('[v1 proxy]', req.method, req.nextUrl.pathname, err)
        return NextResponse.json(
            { detail: 'upstream unreachable' },
            { status: 502 },
        )
    }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
