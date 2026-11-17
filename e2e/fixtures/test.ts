import { test as base } from '@playwright/test'

export * from '@playwright/test'

// The API rotates refresh tokens and revokes a session when it sees a token it
// has already replaced. Tests running in parallel must therefore never share
// one login: global-setup logs every user in once per worker and saves
// e2e/.auth/<authUser>.w<N>.json, and each test starts from its own worker's
// file. Specs name the user with test.use({ authUser: 'player-user' }).
//
// Limit: every test on a worker starts from the same saved login. That is fine
// while a run is short, because the access token (15 min) is still valid and
// nothing refreshes. A run long enough for two refreshes more than a minute
// apart on one worker would start a later test from a token the API has
// replaced and revoke the session. Saving the cookies back after each test was
// tried: a local run then hit reuse revocations and 22 flaky tests, cause not found.
export const test = base.extend<{ authUser: string; sharedSessionGuard: void }>({
  authUser: ['test-user', { option: true }],
  // A logout revokes the session on the server. If the test never logged in itself, the
  // session it logged out is the worker's shared one, and every later test on that worker
  // would start from a dead login. Fail it here, by name, rather than a few tests later.
  sharedSessionGuard: [async ({ context }, use) => {
    let loggedIn = false
    let loggedOut = false
    context.on('request', req => {
      if (req.method() !== 'POST') return
      if (/\/v1\/auth\/login/.test(req.url())) loggedIn = true
      if (/\/v1\/auth\/logout/.test(req.url())) loggedOut = true
    })
    await use()
    if (loggedOut && !loggedIn) {
      throw new Error('this test logged out the worker\'s shared session; clear the cookies and log in first (see e2e/fixtures/test.ts)')
    }
  }, { auto: true }],
  storageState: async ({ authUser }, use, testInfo) => {
    await use(`e2e/.auth/${authUser}.w${testInfo.parallelIndex}.json`)
  },
})
