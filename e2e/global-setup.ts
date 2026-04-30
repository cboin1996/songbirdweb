import { request } from '@playwright/test'
const fs = require('fs')
const path = require('path')

// __dirname should be the e2e directory (where this file lives)
let __dirname = path.resolve(path.dirname(__filename || '.'), '.')
// Fallback if __filename isn't available
if (!__dirname || __dirname === '.') {
  __dirname = path.resolve(process.cwd(), 'e2e')
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
const TEST_USER = process.env.TEST_USERNAME!
const TEST_PASS = process.env.TEST_PASSWORD!
const ADMIN_USER = process.env.E2E_ADMIN_USERNAME!
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD!

// Songs to import into the test user's library. no-tags.mp3 is intentionally
// excluded — it's used by import.spec.ts to test the failed-import path.
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/songs')
const SEED_FILES = [
    'Nothing Else Matters.mp3',
    'The Sound of Silence.mp3',
    'Take It Easy.mp3',
    'Landslide.m4a',
    'TheWinnerTakesItAll-ABBA.mp3',
    'Beverly Hills.mp3',
    'Night Train.mp3',
    'deja vu.m4a',
    'AURORA - When The Dark Dresses Light.m4a',
]

async function importAndWait(ctx: Awaited<ReturnType<typeof request.newContext>>, filePath: string): Promise<void> {
    const filename = path.basename(filePath)
    const buffer = fs.readFileSync(filePath)
    const mimeType = filePath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4'

    const res = await ctx.post(`${API_V1}/import`, {
        multipart: { file: { name: filename, mimeType, buffer } },
    })
    if (!res.ok()) {
        console.warn(`[global-setup] import POST failed for ${filename}: ${res.status()}`)
        return
    }
    const { job_id } = await res.json()

    // Poll until terminal status (done / duplicate / failed).
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500))
        const poll = await ctx.get(`${API_V1}/import/${job_id}`)
        if (!poll.ok()) continue
        const job = await poll.json()
        if (job.status === 'done') {
            console.log(`[global-setup] imported: ${filename}`)
            return
        }
        if (job.status === 'duplicate') {
            // Song already in system — add it to this user's library.
            const uuid = job.duplicate_of
            if (uuid) await ctx.post(`${API_V1}/library/${uuid}`)
            console.log(`[global-setup] duplicate (added to library): ${filename}`)
            return
        }
        if (job.status === 'failed') {
            console.warn(`[global-setup] import failed: ${filename} — ${job.error ?? ''}`)
            return
        }
    }
    console.warn(`[global-setup] import timed out: ${filename}`)
}

async function globalSetup() {
    if (!TEST_USER || !TEST_PASS) throw new Error('TEST_USERNAME and TEST_PASSWORD must be set in .env.local')
    if (!ADMIN_USER || !ADMIN_PASS) throw new Error('E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD must be set in .env.local')

    // --- Admin: create test user if missing, ensure admin role ---
    const admin = await request.newContext({ baseURL: API_BASE })
    const adminLogin = await admin.post(`${API_V1}/auth/login`, {
        data: { username: ADMIN_USER, password: ADMIN_PASS },
    })
    if (!adminLogin.ok()) throw new Error(`Admin login failed: ${adminLogin.status()}`)

    const usersRes = await admin.get(`${API_V1}/admin/users`)
    const users = usersRes.ok() ? await usersRes.json() : []
    const exists = Array.isArray(users) && users.some((u: any) => u.username === TEST_USER)

    if (!exists) {
        const reg = await admin.post(`${API_V1}/auth/register`, {
            data: { username: TEST_USER, password: TEST_PASS, email: `${TEST_USER}@e2e.local` },
        })
        if (!reg.ok()) throw new Error(`Failed to create test user: ${reg.status()} ${await reg.text()}`)
        console.log(`[global-setup] created test user: ${TEST_USER}`)
    }

    // Ensure admin role (needed for admin.spec.ts).
    const usersAfter = (await (await admin.get(`${API_V1}/admin/users`)).json()) as any[]
    const testUserRecord = usersAfter.find((u: any) => u.username === TEST_USER)
    if (testUserRecord && testUserRecord.role !== 'admin') {
        await admin.patch(`${API_V1}/admin/users/${testUserRecord.id}`, { data: { role: 'admin' } })
        console.log(`[global-setup] promoted ${TEST_USER} to admin`)
    }
    await admin.dispose()

    // --- Test user: login, RESET library + playlists to known seed state ---
    const ctx = await request.newContext({ baseURL: API_BASE })
    const testLogin = await ctx.post(`${API_V1}/auth/login`, {
        data: { username: TEST_USER, password: TEST_PASS },
    })
    if (!testLogin.ok()) throw new Error(`Test user login failed: ${testLogin.status()}`)

    // Purge all songs from test user's library so seeding is deterministic each run.
    const libRes = await ctx.get(`${API_V1}/songs/library`)
    const lib = libRes.ok() ? await libRes.json() : []
    if (Array.isArray(lib) && lib.length > 0) {
        const song_ids = lib.map((s: any) => s.uuid).filter(Boolean)
        if (song_ids.length > 0) {
            await ctx.delete(`${API_V1}/library/bulk`, { data: { song_ids } })
            console.log(`[global-setup] purged ${song_ids.length} songs from test user library`)
        }
    }

    // Purge ALL playlists on the test user (dedicated account — anything there is e2e cruft).
    const plRes = await ctx.get(`${API_V1}/playlists`)
    const playlists = plRes.ok() ? await plRes.json() : []
    let purged = 0
    for (const pl of playlists) {
        if ((await ctx.delete(`${API_V1}/playlists/${pl.id}`)).ok()) purged++
    }
    if (purged > 0) console.log(`[global-setup] purged ${purged} playlists on test user`)

    // Re-seed library from fixtures.
    console.log(`[global-setup] seeding library from fixtures…`)
    for (const filename of SEED_FILES) {
        await importAndWait(ctx, path.join(FIXTURES_DIR, filename))
    }

    // Persist storage state (cookies) for test user to avoid per-test login.
    const authDir = path.resolve(__dirname, '.auth')
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true })
    }
    const storageFile = path.join(authDir, 'test-user.json')
    await ctx.storageState({ path: storageFile })
    console.log(`[global-setup] saved test-user storage state to ${storageFile}`)

    await ctx.dispose()
}

export default globalSetup
