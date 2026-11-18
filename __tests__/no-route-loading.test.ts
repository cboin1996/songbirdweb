import { existsSync } from 'fs'
import { join } from 'path'

// A route-level loading.tsx is a Suspense fallback, and React holds a fallback on screen for
// about 300 ms before revealing content that is already ready. Every first click into the route
// then waits 300 ms behind a skeleton, however fast the server is. Lists show their own skeleton
// from their own query instead (it waits 200 ms, so a fast load shows none).
const ROUTES = ['library', 'explore', 'admin', 'info', 'download', 'import', 'settings']

describe('signed-in routes', () => {
    it.each(ROUTES)('%s has no route-level loading.tsx', route => {
        expect(existsSync(join(__dirname, '..', 'app', '(authed)', route, 'loading.tsx'))).toBe(false)
    })
})
