import { test } from '@playwright/test'

/**
 * Specs that read the 1000-song bench library run only where it is seeded. Locally an
 * unseeded stack skips them; in CI an unseeded run would hide the whole benchmark behind
 * a green "skipped", so it fails loudly instead.
 */
export function skipWithoutBench(): void {
    if (process.env.E2E_SEED_BENCH) return
    if (process.env.CI) throw new Error('E2E_SEED_BENCH is not set in CI: the bench library is not seeded, so these specs would silently skip')
    test.skip(true, 'bench seeding is off (E2E_SEED_BENCH not set)')
}
