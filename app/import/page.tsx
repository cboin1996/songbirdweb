'use client'
import { useCallback, useRef, useState } from 'react'
import { importSong } from '../lib/data'
import { FaCheckCircle, FaTimesCircle, FaUpload } from 'react-icons/fa'

type FileStatus = 'pending' | 'uploading' | 'done' | 'error'

interface FileEntry {
  id: string
  file: File
  status: FileStatus
  trackName?: string
  errorMsg?: string
}

export default function ImportPage() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f => /\.(mp3|m4a)$/i.test(f.name))
    if (arr.length === 0) return
    const newEntries: FileEntry[] = arr.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
    }))
    setEntries(prev => [...prev, ...newEntries])
    newEntries.forEach(entry => uploadEntry(entry))
  }

  const uploadEntry = useCallback(async (entry: FileEntry) => {
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'uploading' } : e))
    const result = await importSong(entry.file)
    if (!result) {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'error', errorMsg: 'upload failed' } : e))
      return
    }
    setEntries(prev => prev.map(e => e.id === entry.id ? {
      ...e,
      status: 'done',
      trackName: result.properties?.trackName ?? entry.file.name,
    } : e))
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  function clearDone() {
    setEntries(prev => prev.filter(e => e.status !== 'done'))
  }

  const doneCount = entries.filter(e => e.status === 'done').length
  const errorCount = entries.filter(e => e.status === 'error').length
  const activeCount = entries.filter(e => e.status === 'uploading' || e.status === 'pending').length

  return (
    <main className="flex flex-col items-center gap-6 p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold self-start">Import files</h1>

      {/* drop zone */}
      <div
        data-testid="import-dropzone"
        className={`w-full flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${dragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30' : 'border-gray-300 dark:border-gray-700 hover:border-sky-500'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
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

      {/* file list */}
      {entries.length > 0 && (
        <div className="w-full flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>
              {activeCount > 0 && <span className="text-sky-500">{activeCount} uploading</span>}
              {activeCount > 0 && (doneCount > 0 || errorCount > 0) && <span className="mx-1">·</span>}
              {doneCount > 0 && <span className="text-emerald-500">{doneCount} done</span>}
              {doneCount > 0 && errorCount > 0 && <span className="mx-1">·</span>}
              {errorCount > 0 && <span className="text-red-500">{errorCount} failed</span>}
            </span>
            {doneCount > 0 && (
              <button onClick={clearDone} className="text-xs text-gray-400 hover:text-sky-500 transition-colors">
                clear done
              </button>
            )}
          </div>

          {entries.map(entry => (
            <div
              key={entry.id}
              data-testid="import-file-row"
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
            >
              <div className="shrink-0">
                {entry.status === 'done' && <FaCheckCircle className="text-emerald-500" size={14} />}
                {entry.status === 'error' && <FaTimesCircle className="text-red-500" size={14} />}
                {(entry.status === 'uploading' || entry.status === 'pending') && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-sky-500 animate-spin" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{entry.trackName ?? entry.file.name}</p>
                {entry.status === 'uploading' && <p className="text-xs text-sky-500">uploading…</p>}
                {entry.status === 'pending' && <p className="text-xs text-gray-400">pending…</p>}
                {entry.status === 'done' && <p className="text-xs text-emerald-500">added to library</p>}
                {entry.status === 'error' && <p className="text-xs text-red-500">{entry.errorMsg}</p>}
              </div>
              <button
                onClick={() => setEntries(prev => prev.filter(e => e.id !== entry.id))}
                className="text-gray-300 hover:text-gray-500 dark:text-gray-700 dark:hover:text-gray-400 transition-colors shrink-0 text-xs"
                title="remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
