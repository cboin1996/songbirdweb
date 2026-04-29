import { request } from '@playwright/test'
import fs from 'fs'
import path from 'path'

for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) process.env[line.slice(0, eq).trim()] ??= line.slice(eq + 1).trim()
}

const API_BASE = process.env.E2E_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
const API_V1 = `${API_BASE}/v1`

async function globalTeardown() {
    const TEST_USER = process.env.TEST_USERNAME
    const TEST_PASS = process.env.TEST_PASSWORD
    if (!TEST_USER || !TEST_PASS) return

    const ctx = await request.newContext({ baseURL: API_BASE })
    const login = await ctx.post(`${API_V1}/auth/login`, {
        data: { username: TEST_USER, password: TEST_PASS },
    })
    if (!login.ok()) { await ctx.dispose(); return }

    const plRes = await ctx.get(`${API_V1}/playlists`)
    const playlists = plRes.ok() ? await plRes.json() : []
    let purged = 0
    for (const pl of playlists) {
        if (typeof pl?.name === 'string' && (pl.name.startsWith('e2e-') || pl.name.startsWith('pw-test-'))) {
            const r = await ctx.delete(`${API_V1}/playlists/${pl.id}`)
            if (r.ok()) purged++
        }
    }
    if (purged > 0) console.log(`[global-teardown] purged ${purged} e2e playlists`)

    await ctx.dispose()
}

export default globalTeardown
