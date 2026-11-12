import { execFileSync } from 'child_process'

// Seeds a 1000-song library for the benchmark user. The songs are synthetic
// rows that point at the audio and artwork files the fixture import already
// stored, so no new files are made and the API needs no change. Test setup only.

export const BENCH_USER = process.env.E2E_BENCH_USERNAME || 'e2e-bench'
export const BENCH_PASS = process.env.E2E_BENCH_PASSWORD || 'e2e-BenchPass-1'
export const BENCH_SONG_COUNT = 1000

const PG_CONTAINER = process.env.E2E_PG_CONTAINER || 'songbirdweb-e2e-postgres'
const ID_PREFIX = 'b00bfeed-0000-4000-8000-'

function psql(sql: string, vars: Record<string, string> = {}): string {
    const args = ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'songbirdapi', '-d', 'songbirdapi', '-v', 'ON_ERROR_STOP=1', '-At']
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
    return execFileSync('docker', args, { input: sql, encoding: 'utf-8' }).trim()
}

const COUNT_SQL = `
SELECT count(*) FROM user_songs us JOIN users u ON u.id = us.user_id
WHERE u.username = :'u' AND us.song_id LIKE :'prefix' || '%';
`

// 60 artists, 120 albums and titles starting with every letter, so grouping,
// search and the letter rail have realistic work. Templates are the songs the
// fixture import already stored; each synthetic song reuses one's files.
const INSERT_SQL = `
WITH tpl AS (
  SELECT row_number() OVER (ORDER BY uuid) - 1 AS n, file_path, artwork_thumb, artwork_full, source, properties
  FROM songs
  WHERE uuid NOT LIKE :'prefix' || '%' AND file_path LIKE 'data/downloads/%'
), cnt AS (SELECT count(*) AS c FROM tpl),
ins AS (
  INSERT INTO songs (uuid, url, file_path, properties, artwork_thumb, artwork_full, source)
  SELECT :'prefix' || lpad(g.i::text, 12, '0'), '', t.file_path,
         t.properties || jsonb_build_object(
           'trackName', chr(65 + (g.i - 1) % 26) || 'ench song ' || lpad(g.i::text, 4, '0'),
           'artistName', 'Bench Artist ' || lpad((((g.i - 1) % 60) + 1)::text, 2, '0'),
           'collectionName', 'Bench Album ' || lpad((((g.i - 1) % 120) + 1)::text, 3, '0'),
           'trackNumber', ((g.i - 1) % 12) + 1),
         t.artwork_thumb, t.artwork_full, t.source
  FROM generate_series(1, ${BENCH_SONG_COUNT}) AS g(i) CROSS JOIN cnt
  JOIN tpl t ON t.n = (g.i - 1) % cnt.c
  ON CONFLICT DO NOTHING
  RETURNING uuid
)
INSERT INTO user_songs (user_id, song_id, added_at)
SELECT (SELECT id FROM users WHERE username = :'u'), uuid, now() - (substr(uuid, 25)::int * interval '1 minute')
FROM ins
ON CONFLICT DO NOTHING;
`

export async function seedBenchLibrary(): Promise<{ inserted: number; skipped: boolean; ms: number }> {
    const start = Date.now()
    const vars = { u: BENCH_USER, prefix: ID_PREFIX }
    const before = Number(psql(COUNT_SQL, vars))
    if (before >= BENCH_SONG_COUNT) return { inserted: 0, skipped: true, ms: Date.now() - start }

    psql(INSERT_SQL, vars)
    const after = Number(psql(COUNT_SQL, vars))
    if (after !== BENCH_SONG_COUNT) {
        throw new Error(`bench seed expected ${BENCH_SONG_COUNT} songs for ${BENCH_USER}, found ${after}`)
    }
    return { inserted: after - before, skipped: false, ms: Date.now() - start }
}
