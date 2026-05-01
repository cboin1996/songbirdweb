import { request } from '@playwright/test'
const fs = require('fs')
const path = require('path')

let __dirname = '.'
try {
  __dirname = path.dirname(require.main?.filename || '.')
} catch (e) {
  __dirname = process.cwd()
}

try {
  for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) process.env[line.slice(0, eq).trim()] ??= line.slice(eq + 1).trim()
  }
} catch (e) {
  // Ignore if .env.local not found
}

const API_BASE = process.env.E2E_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
const API_V1 = `${API_BASE}/v1`

async function purgeUserPlaylists(username: string, password: string): Promise<void> {
    const ctx = await request.newContext({ baseURL: API_BASE })
    const login = await ctx.post(`${API_V1}/auth/login`, { data: { username, password } })
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
    if (purged > 0) console.log(`[global-teardown] purged ${purged} playlists for ${username}`)

    await ctx.dispose()
}

async function globalTeardown() {
    const users = [
        { username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD },
        { username: process.env.E2E_EDITOR_USERNAME, password: process.env.E2E_EDITOR_PASSWORD },
        { username: process.env.E2E_BULK_USERNAME, password: process.env.E2E_BULK_PASSWORD },
        { username: process.env.E2E_IMPORT_USERNAME, password: process.env.E2E_IMPORT_PASSWORD },
    ]

    for (const u of users) {
        if (u.username && u.password) {
            await purgeUserPlaylists(u.username, u.password)
        }
    }
}

export default globalTeardown
