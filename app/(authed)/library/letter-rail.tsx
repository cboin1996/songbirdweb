"use client"
import { memo, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react"
import { ALPHABET, letterKey } from "../../lib/library-grouping"

// The A-Z index at the screen edge. It owns the letter being scrubbed and the
// letter in view, so a scrub or a scroll re-renders these 27 letters and nothing
// else: the library list does not hear about either.
function LetterRailInner({ viewMode, presentLetters, genreNames, sectionRefs, stickyHeaderRef }: {
    viewMode: string
    presentLetters: Set<string>
    genreNames: string[]
    sectionRefs: MutableRefObject<Record<string, HTMLElement | null>>
    stickyHeaderRef: RefObject<HTMLDivElement | null>
}) {
    const [activeLetter, setActiveLetter] = useState<string | null>(null)
    const [scrubLetter, setScrubLetter] = useState<string | null>(null)
    const scrubbing = useRef(false)
    const lastScrub = useRef<string | null>(null)
    const barRef = useRef<HTMLDivElement>(null)

    function stickyOffset() {
        const navBottom = document.querySelector('nav')?.getBoundingClientRect().bottom ?? 0
        const headerBottom = stickyHeaderRef.current?.getBoundingClientRect().bottom ?? 0
        return Math.max(navBottom, headerBottom, 0)
    }

    function sectionFor(letter: string): HTMLElement | null {
        if (viewMode === 'genres') {
            const genre = genreNames.find(g => letterKey(g) === letter)
            return genre ? sectionRefs.current[genre] ?? null : null
        }
        return sectionRefs.current[letter] ?? null
    }

    function jump(letter: string, behavior: ScrollBehavior) {
        const el = sectionFor(letter)
        if (!el) return
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyOffset(), behavior })
    }

    function scrollTo(letter: string) {
        const params = new URLSearchParams(window.location.search)
        params.set('letter', letter)
        const qs = params.toString()
        window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
        jump(letter, 'smooth')
    }

    function letterFromPointer(e: React.PointerEvent): string | null {
        const bar = barRef.current
        if (!bar) return null
        const rect = bar.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        return ALPHABET[Math.floor(ratio * ALPHABET.length)] ?? null
    }

    function scrubTo(letter: string) {
        lastScrub.current = letter
        setScrubLetter(letter)
        jump(letter, 'instant')
    }

    function handlePointerDown(e: React.PointerEvent) {
        e.preventDefault()
        scrubbing.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter)) scrubTo(letter)
    }

    function handlePointerMove(e: React.PointerEvent) {
        if (!scrubbing.current) return
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter) && letter !== lastScrub.current) scrubTo(letter)
    }

    function endScrub() {
        scrubbing.current = false
        lastScrub.current = null
        setScrubLetter(null)
    }

    function handlePointerUp(e: React.PointerEvent) {
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter)) scrollTo(letter)
        endScrub()
    }

    // default the highlight to the first present letter when the content fits the viewport (nothing to scroll)
    useEffect(() => {
        if (activeLetter) return
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight) return
        const first = ALPHABET.find(l => presentLetters.has(l)) ?? null
        if (first) setActiveLetter(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presentLetters])

    // track the active letter: the last section whose header has scrolled to or past the sticky bar's bottom
    useEffect(() => {
        let rafId: number | null = null
        const handler = () => {
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                const threshold = stickyOffset() + 4
                const keys = viewMode === 'genres'
                    ? genreNames.map(g => ({ key: letterKey(g), el: sectionRefs.current[g] }))
                    : ALPHABET.map(l => ({ key: l, el: sectionRefs.current[l] }))
                let active: string | null = null
                for (const { key, el } of keys) {
                    if (!el) continue
                    if (el.getBoundingClientRect().top <= threshold) active = key
                    else break
                }
                // At scroll-y=0 no section is above the threshold yet, but the user is
                // looking at the first one: fall back to the first present key.
                if (!active) active = keys.find(k => k.el)?.key ?? null
                if (active) setActiveLetter(active)
            })
        }
        window.addEventListener('scroll', handler, { passive: true })
        handler()
        return () => { window.removeEventListener('scroll', handler); if (rafId) cancelAnimationFrame(rafId); setActiveLetter(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, genreNames, presentLetters])

    const shown = scrubLetter ?? activeLetter
    return (
        <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center">
            {scrubLetter && (
                <div className="mr-1 w-10 h-10 rounded-full bg-gray-500 dark:bg-gray-700 flex items-center justify-center shadow-lg pointer-events-none">
                    <span className="text-lg font-bold text-white leading-none">{scrubLetter}</span>
                </div>
            )}
            <div
                ref={barRef}
                data-testid="letter-rail"
                className="flex flex-col items-center py-2 touch-none select-none cursor-pointer"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={endScrub}
                onTouchEnd={endScrub}
            >
                {ALPHABET.map(letter => (
                    <span
                        key={letter}
                        {...(letter === shown ? { 'data-testid': 'letter-rail-active' } : {})}
                        className={`w-7 h-5 md:w-8 md:h-6 flex items-center justify-center leading-none transition-colors ${
                            letter === shown
                                ? 'text-sm md:text-base font-bold text-sky-500'
                                : presentLetters.has(letter)
                                    ? 'text-[10px] md:text-xs font-semibold text-sky-400 dark:text-sky-500'
                                    : 'text-[10px] md:text-xs font-semibold text-gray-200 dark:text-gray-700'
                        }`}
                    >
                        {letter}
                    </span>
                ))}
            </div>
        </div>
    )
}

export default memo(LetterRailInner)
