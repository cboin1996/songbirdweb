/* eslint-disable @typescript-eslint/no-require-imports */
// Turns bench-results/metrics.json into a Markdown table for the CI job summary, set against
// e2e-bench/baseline-metrics.json. A number that has moved more than the tolerance is
// printed as a GitHub warning annotation; nothing here fails the job (the budgets in
// e2e-bench/2-budgets.spec.ts do that).
//
//   node scripts/bench-summary.js [metrics.json] [baseline.json] >> "$GITHUB_STEP_SUMMARY"
const fs = require('fs')
const path = require('path')

const SKIP = new Set(['runStartedAt'])
const TOLERANCE = 0.25   // relative drift before a warning
const MIN_STEP = 3       // ...and at least this much in absolute terms, so 1 -> 2 is not news

// { a: { b: [1, { c: 2 }] } } -> { 'a.b.0': 1, 'a.b.1.c': 2 }; only numbers are kept.
function flatten(value, prefix = '', out = {}) {
    if (typeof value === 'number' && Number.isFinite(value)) out[prefix] = value
    else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out))
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            if (!prefix && SKIP.has(k)) continue
            flatten(v, prefix ? `${prefix}.${k}` : k, out)
        }
    }
    return out
}

function compare(current, baseline) {
    const now = flatten(current)
    const base = flatten(baseline)
    const rows = []
    for (const key of Object.keys(now).sort()) {
        const was = base[key]
        const drift = was === undefined ? null : now[key] - was
        const warn = drift !== null && Math.abs(drift) >= MIN_STEP && Math.abs(drift) > Math.abs(was) * TOLERANCE
        rows.push({ key, now: now[key], was, drift, warn })
    }
    const gone = Object.keys(base).filter(k => !(k in now)).sort()
    return { rows, gone }
}

function render({ rows, gone }, hasBaseline) {
    const lines = ['### Bench numbers', '']
    if (!hasBaseline) lines.push('No baseline file: showing this run only.', '')
    lines.push('| metric | now | baseline | drift |', '| --- | ---: | ---: | ---: |')
    for (const r of rows) {
        const drift = r.drift === null ? '' : `${r.drift > 0 ? '+' : ''}${r.drift}${r.warn ? ' ⚠️' : ''}`
        lines.push(`| ${r.key} | ${r.now} | ${r.was ?? ''} | ${drift} |`)
    }
    if (gone.length) lines.push('', `Not measured this run: ${gone.join(', ')}`)
    return lines.join('\n') + '\n'
}

function warnings({ rows }) {
    return rows.filter(r => r.warn).map(r => `::warning title=Bench drift::${r.key} is ${r.now}, the baseline is ${r.was}`)
}

function main() {
    const metricsPath = process.argv[2] || path.join('bench-results', 'metrics.json')
    const baselinePath = process.argv[3] || path.join('e2e-bench', 'baseline-metrics.json')
    if (!fs.existsSync(metricsPath)) { console.log('No bench metrics were written.'); return }
    const current = JSON.parse(fs.readFileSync(metricsPath, 'utf8'))
    const hasBaseline = fs.existsSync(baselinePath)
    const result = compare(current, hasBaseline ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {})
    process.stdout.write(render(result, hasBaseline))
    for (const w of warnings(hasBaseline ? result : { rows: [] })) console.error(w)
}

if (require.main === module) main()
module.exports = { flatten, compare, render, warnings }
