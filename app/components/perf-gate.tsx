'use client'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { perfEnabled } from '../lib/perf'
import { getPerfOverlay, setPerfOverlay } from '../lib/device-settings'

// The overlay's code is only fetched when ?perf=1 (or the test override) is on, so
// without the flag nothing is downloaded, run or shown.
const PerfOverlay = dynamic(() => import('./perf-overlay'), { ssr: false })

export default function PerfGate() {
  const [on, setOn] = useState(false)
  useEffect(() => setOn(perfEnabled), [])
  // Alt+Shift+P flips the device setting. The counter is decided when a page loads, so the page reloads.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.altKey && e.shiftKey) || e.ctrlKey || e.metaKey || e.code !== 'KeyP') return
      e.preventDefault()
      setPerfOverlay(!(perfEnabled || getPerfOverlay()))
      window.location.reload()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return on ? <PerfOverlay /> : null
}
