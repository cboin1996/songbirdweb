'use client'

export default function Slider({ value, min, max, step, onChange, onStart, onCommit, disabled, label }: {
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void; onStart?: () => void; onCommit?: () => void; disabled?: boolean; label?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`relative flex items-center h-5 group ${disabled ? 'opacity-30' : 'cursor-pointer'}`}>
      <div className="absolute inset-x-0 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full">
        <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="absolute w-2.5 h-2.5 bg-sky-500 rounded-full -translate-x-1/2 pointer-events-none"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-label={label}
        onMouseDown={onStart} onTouchStart={onStart}
        onChange={e => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit}
        className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default"
      />
    </div>
  )
}
