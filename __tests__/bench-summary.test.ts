// The CI job summary for the bench numbers: a table, and a warning for a number that moved.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { flatten, compare, render, warnings } = require('../scripts/bench-summary.js')

describe('bench summary', () => {
    it('flattens numbers by path and leaves strings and the run time out', () => {
        expect(flatten({ runStartedAt: 5, a: { b: [1, { c: 2 }], s: 'x' }, d: 4 })).toEqual({ 'a.b.0': 1, 'a.b.1.c': 2, d: 4 })
    })

    it('warns when a number moved by more than a quarter and at least 3', () => {
        const result = compare({ cold: { api: 100, small: 2 } }, { cold: { api: 70, small: 1 } })
        expect(warnings(result)).toEqual(['::warning title=Bench drift::cold.api is 100, the baseline is 70'])
    })

    it('does not warn for a small move or a move inside the tolerance', () => {
        const result = compare({ a: 110, b: 4 }, { a: 100, b: 2 })
        expect(warnings(result)).toEqual([])
    })

    it('shows drift in the table and names numbers the run did not measure', () => {
        const table = render(compare({ a: 100 }, { a: 70, gone: 1 }), true)
        expect(table).toContain('| a | 100 | 70 | +30 ⚠️ |')
        expect(table).toContain('Not measured this run: gone')
    })

    it('says so when there is no baseline', () => {
        expect(render(compare({ a: 1 }, {}), false)).toContain('No baseline file')
    })
})
