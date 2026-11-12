// Lighthouse CI on the library page, signed in as the 1000-song bench user.
// Scores are recorded for trend-watching; there is no hard millisecond gate
// (shared runners are too noisy), so every assertion is a warning at most.
const web = process.env.E2E_WEB_URL || 'http://localhost:3000'

module.exports = {
    ci: {
        collect: {
            url: [`${web}/library`],
            numberOfRuns: 3,
            puppeteerScript: './scripts/lhci-login.js',
            // GitHub's runners cannot start Chrome's sandbox; a local run keeps it.
            puppeteerLaunchOptions: { args: process.env.CI ? ['--no-sandbox'] : [] },
            settings: {
                onlyCategories: ['performance'],
                disableStorageReset: true,
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['warn', { minScore: 0.5 }],
            },
        },
        upload: { target: 'filesystem', outputDir: './lhci-results' },
    },
}
