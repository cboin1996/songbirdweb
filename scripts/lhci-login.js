// Lighthouse CI puppeteer hook: signs in as the 1000-song bench user so the
// audit loads the real library page, not the login redirect.
module.exports = async (browser, context) => {
    const web = process.env.E2E_WEB_URL || 'http://localhost:3000'
    const api = process.env.E2E_API_BASE_URL || 'http://localhost:8000'
    const page = await browser.newPage()
    await page.goto(web)
    const status = await page.evaluate(async (url, username, password) => {
        const resp = await fetch(`${url}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include',
        })
        return resp.status
    }, api, process.env.E2E_BENCH_USERNAME || 'e2e-bench', process.env.E2E_BENCH_PASSWORD || 'e2e-BenchPass-1')
    if (status !== 200) throw new Error(`lhci login failed: ${status}`)
    await page.close()
}
