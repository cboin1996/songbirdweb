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
export const test = base.extend<{ authUser: string }>({
  authUser: ['test-user', { option: true }],
  storageState: async ({ authUser }, use, testInfo) => {
    await use(`e2e/.auth/${authUser}.w${testInfo.parallelIndex}.json`)
  },
})
