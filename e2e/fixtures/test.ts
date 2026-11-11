import { test as base } from '@playwright/test'

export * from '@playwright/test'

// The API rotates refresh tokens and revokes a session when it sees a token it
// has already replaced. Tests running in parallel must therefore never share
// one login: global-setup logs every user in once per worker and saves
// e2e/.auth/<authUser>.w<N>.json, and each test starts from its own worker's
// file. Specs name the user with test.use({ authUser: 'player-user' }).
export const test = base.extend<{ authUser: string }>({
  authUser: ['test-user', { option: true }],
  storageState: async ({ authUser }, use, testInfo) => {
    await use(`e2e/.auth/${authUser}.w${testInfo.parallelIndex}.json`)
  },
})
