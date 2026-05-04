'use client'
import { useRef, useState } from 'react'

interface Props {
  value: number           // value in display space
  min: number
  max: number
  step: number            // display-space units per pixel dragged
  format: (v: number) => string
  parse: (s: string) => number
  onChange: (v: number) => void
  onStart?: () => void
  onCommit?: (v: number) => void
  disabled?: boolean
  label?: string
  modified?: boolean      // highlight when non-default
}

export default function ScrubInput({
  value, min, max, step, format, parse, onChange, onStart, onCommit, disabled, label, modified,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragY = useRef(0)
  const dragValue = useRef(0)
  const dragging = useRef(false)
  const moved = useRef(false)

  function clamp(v: number) { return Math.max(min, Math.min(max, v)) }

  function handlePointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    if (disabled || editing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragY.current = e.clientY
    dragValue.current = value
    dragging.current = true
    moved.current = false
    onStart?.()
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return
    const delta = dragY.current - e.clientY
    if (Math.abs(delta) > 2) moved.current = true
    onChange(clamp(dragValue.current + delta * step))
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragging.current) return
    dragging.current = false
    if (moved.current) {
      const final = clamp(dragValue.current + (dragY.current - e.clientY) * step)
      onCommit?.(final)
    }
  }

  function handleDoubleClick() {
    if (disabled) return
    setText(format(value))
    setEditing(true)
    setTimeout(() => { inputRef.current?.select() }, 0)
  }

  function commitEdit() {
    const parsed = parse(text)
    if (!isNaN(parsed)) {
      const v = clamp(parsed)
      // Snapshot the pre-change value before applying — mirrors the drag
      // flow's onStart in handlePointerDown so history (undo/redo) works
      // for typed input too.
      onStart?.()
      onChange(v)
      onCommit?.(v)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        className="w-20 text-center text-base md:text-xs font-mono bg-transparent border-b border-sky-500 outline-none text-sky-500"
        aria-label={label}
      />
    )
  }

  return (
    <span
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{ touchAction: 'none' }}
      className={[
        'select-none tabular-nums text-xs font-mono',
        disabled ? 'opacity-40 cursor-default' : 'cursor-ns-resize',
        modified ? 'text-sky-500' : 'text-gray-500 dark:text-gray-400',
        disabled ? '' : 'hover:text-sky-500 dark:hover:text-sky-400 transition-colors',
      ].join(' ')}
    >
      {format(value)}
    </span>
  )
}
