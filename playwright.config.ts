import { defineConfig, devices } from '@playwright/test'

try {
  const fs = require('fs')
  const path = require('path')
  const envPath = path.resolve(__dirname || '.', '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) process.env[line.slice(0, eq).trim()] ??= line.slice(eq + 1).trim()
    }
  }
} catch (e) {
  // Ignore if .env.local not found
}

const DEV_URL = process.env.E2E_WEB_URL || 'http://localhost:3000'
const PROD_URL = 'http://localhost:6996'

type ProjectCfg = NonNullable<Parameters<typeof defineConfig>[0]['projects']>[number]
// Both projects always present so worker subprocesses can resolve them; the CLI
// `--project=...` flag picks which one runs.
const projects: ProjectCfg[] = [
  {
    name: 'dev',
    testDir: './e2e',
    use: { ...devices['Desktop Chrome'], baseURL: DEV_URL, storageState: 'e2e/.auth/test-user.json' },
  },
  {
    name: 'prod',
    testDir: './e2e-prod',
    // Prod tests login fresh (no shared storageState) so they can verify cookie+SW lifecycle.
    use: { ...devices['Desktop Chrome'], baseURL: PROD_URL, storageState: { cookies: [], origins: [] } },
  },
  {
    name: 'mobile',
    testDir: './e2e-mobile',
    use: { ...devices['iPhone 13'], baseURL: DEV_URL, storageState: 'e2e/.auth/test-user.json' },
  },
]

const isProd = process.argv.includes('--project=prod') || !!process.env.PLAYWRIGHT_PROD

export default defineConfig({
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    trace: 'on-first-retry',
  },
  projects,
  webServer: isProd ? {
    command: 'npm run build && npm run start -- -p 6996',
    url: PROD_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  } : undefined,
})
