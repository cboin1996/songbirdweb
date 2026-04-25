import { test, expect } from '@playwright/test'

const USERNAME = process.env.TEST_USERNAME!
const PASSWORD = process.env.TEST_PASSWORD!

const failures: { url: string; status: number; method: string; page: string }[] = []

async function login(page: any) {
  await page.goto('/')
  await page.getByPlaceholder('username').fill(USERNAME)
  await page.getByPlaceholder('password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/download/, { timeout: 10000 })
}

test('capture all 401s across the app', async ({ page }) => {
  await login(page)

  // only capture 401s on authenticated pages
  page.on('response', response => {
    if (response.status() === 401) {
      failures.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        page: page.url(),
      })
      console.log(`401: ${response.request().method()} ${response.url()} (on page: ${page.url()})`)
    }
  })

  const pages = [
    '/download',
    '/download/song',
    '/download/album',
    '/library',
    '/explore',
    '/explore?window=day',
    '/explore?window=week',
    '/explore?window=all',
    '/settings',
  ]

  for (const route of pages) {
    console.log(`\n--- navigating to ${route} ---`)
    await page.goto(route)
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    // wait a bit for deferred client-side fetches
    await page.waitForTimeout(2000)
  }

  if (failures.length === 0) {
    console.log('\nNo 401s found.')
  } else {
    console.log('\n=== 401 SUMMARY ===')
    for (const f of failures) {
      console.log(`  ${f.method} ${f.url}`)
      console.log(`    triggered on page: ${f.page}`)
    }
  }

  // don't fail the test — this is investigative
  expect(true).toBe(true)
})
