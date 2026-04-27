'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { startImport, listImportJobs, ImportJobResult } from '../lib/data'
import { FaUpload } from 'react-icons/fa'
import ImportJobsTable, { ImportJobsTableHandle } from '../components/import-jobs-table'
import { useOnline } from '../lib/use-online'

export default function ImportPage() {
  const online = useOnline()
  const [dragging, setDragging] = useState(false)
  const [initialJobs, setInitialJobs] = useState<ImportJobResult[]>([])
  const [initialTotal, setInitialTotal] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<ImportJobsTableHandle | null>(null)

  useEffect(() => {
    listImportJobs().then(data => { setInitialJobs(data.jobs); setInitialTotal(data.total) })
  }, [])

  const uploadFiles = useCallback(async (files: File[]) => {
    const arr = files.filter(f => /\.(mp3|m4a)$/i.test(f.name))
    if (arr.length === 0) return
    const CONCURRENCY = 5
    for (let i = 0; i < arr.length; i += CONCURRENCY) {
      await Promise.all(arr.slice(i, i + CONCURRENCY).map(async file => {
        const tempId = crypto.randomUUID()
        const optimistic: ImportJobResult = {
          job_id: tempId,
          status: 'pending',
          filename: file.name,
          created_at: new Date().toISOString(),
        }
        tableRef.current?.addJob(optimistic)
        const job = await startImport(file)
        if (job) {
          tableRef.current?.addJob(job, tempId)
        }
      }))
    }
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    uploadFiles(Array.from(e.dataTransfer.files))
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  return (
    <main className="flex flex-col items-center gap-6 p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold self-start">Import files</h1>

      <div
        data-testid="import-dropzone"
        className={`w-full flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 transition-colors ${!online ? 'opacity-40 cursor-not-allowed border-gray-300 dark:border-gray-700' : `cursor-pointer ${dragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30' : 'border-gray-300 dark:border-gray-700 hover:border-sky-500'}`}`}
        onDragOver={e => { if (!online) return; e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { if (!online) return; onDrop(e) }}
        onClick={() => { if (!online) return; inputRef.current?.click() }}
      >
        {!online && <p className="text-xs text-amber-700 font-medium">unavailable offline</p>}
        <FaUpload size={24} className="text-gray-400" />
        <p className="text-sm text-gray-500">drag & drop .mp3 / .m4a files, or click to select</p>
        <p className="text-xs text-gray-400">multiple files supported — uploads run in parallel</p>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.m4a"
          multiple
          className="hidden"
          onChange={onInputChange}
          data-testid="import-file-input"
        />
      </div>

      <ImportJobsTable initialJobs={initialJobs} total={initialTotal} tableRef={tableRef} />
    </main>
  )
}
