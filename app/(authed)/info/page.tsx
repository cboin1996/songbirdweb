'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchVersion } from '../../lib/data'
import { queryKeys } from '../../lib/query-keys'
import QueryError from '../../components/query-error'

const repos = {
  songbirdweb: 'https://github.com/cboin1996/songbirdweb',
  songbirdapi: 'https://github.com/cboin1996/songbirdapi',
  songbirdcore: 'https://github.com/cboin1996/songbirdcore',
}

function VersionCard({ name, version, repo }: { name: string; version: string; repo: string }) {
  return (
    <div data-testid="version-card" className="flex flex-col gap-1 p-4 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 w-56">
      <p className="text-sm font-medium">{name} <span className="text-gray-400">v{version}</span></p>
      <Link href={`${repo}/issues/new`} target="_blank" className="text-xs text-sky-500 hover:text-sky-400">
        file a bug report
      </Link>
    </div>
  )
}

export default function Page() {
  const { data: versions, error, refetch, isLoading } = useQuery({
    queryKey: queryKeys.version,
    queryFn: fetchVersion,
    retry: false,
  })
  const webVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'

  if (isLoading) return null
  if (error) return (
    <main className="p-4">
      <QueryError error={error} retry={refetch} context="app info" />
    </main>
  )

  return (
    <main className="p-4">
      <div className="flex flex-col gap-6 py-4">
        <p className="text-gray-400 text-sm">about</p>
        <div className="flex flex-row flex-wrap gap-4">
          <VersionCard name="songbirdweb" version={webVersion} repo={repos.songbirdweb} />
          <VersionCard name="songbirdapi" version={versions?.api_version ?? 'unknown'} repo={repos.songbirdapi} />
          <VersionCard name="songbirdcore" version={versions?.core_version ?? 'unknown'} repo={repos.songbirdcore} />
        </div>
      </div>
    </main>
  )
}
