import { render, screen, fireEvent, act } from '@testing-library/react'
import { NavPendingProvider, PendingLink, PendingRoute } from '../app/components/pending-route'

let mockPath = '/library'
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }))
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, onNavigate, children, ...rest }: {
        href: string; onNavigate?: (e: { preventDefault(): void }) => void; children: React.ReactNode
    }) => (
        <a href={href} {...rest} onClick={e => { e.preventDefault(); onNavigate?.({ preventDefault() {} }) }}>{children}</a>
    ),
}))

function App() {
    return (
        <NavPendingProvider>
            <PendingLink href="/explore">explore</PendingLink>
            <PendingLink href="/download">download</PendingLink>
            <PendingRoute><p>page {mockPath}</p></PendingRoute>
        </NavPendingProvider>
    )
}

describe('navigation skeleton', () => {
    beforeEach(() => { jest.useFakeTimers(); mockPath = '/library' })
    afterEach(() => jest.useRealTimers())

    it('a navigation that lands within 200 ms never shows a skeleton', () => {
        const { rerender } = render(<App />)
        fireEvent.click(screen.getByText('explore'))
        act(() => { jest.advanceTimersByTime(150) })
        expect(screen.queryByTestId('route-skeleton')).toBeNull()
        mockPath = '/explore'
        rerender(<App />)
        act(() => { jest.advanceTimersByTime(500) })
        expect(screen.queryByTestId('route-skeleton')).toBeNull()
        expect(screen.getByText('page /explore')).toBeTruthy()
    })

    it('a slow navigation swaps in the route skeleton, then the page', () => {
        const { rerender } = render(<App />)
        fireEvent.click(screen.getByText('explore'))
        act(() => { jest.advanceTimersByTime(250) })
        expect(screen.getByTestId('route-skeleton')).toBeTruthy()
        expect(screen.queryByText('page /library')).toBeNull()
        mockPath = '/explore'
        rerender(<App />)
        expect(screen.queryByTestId('route-skeleton')).toBeNull()
        expect(screen.getByText('page /explore')).toBeTruthy()
    })

    it('returning to the page it left does not bring a stale skeleton back', () => {
        const { rerender } = render(<App />)
        fireEvent.click(screen.getByText('explore'))
        act(() => { jest.advanceTimersByTime(250) })
        mockPath = '/explore'
        rerender(<App />)
        mockPath = '/library' // browser back
        rerender(<App />)
        expect(screen.queryByTestId('route-skeleton')).toBeNull()
        expect(screen.getByText('page /library')).toBeTruthy()
    })

    it('a route without a skeleton keeps the old page while it loads', () => {
        render(<App />)
        fireEvent.click(screen.getByText('download'))
        act(() => { jest.advanceTimersByTime(1000) })
        expect(screen.queryByTestId('route-skeleton')).toBeNull()
        expect(screen.getByText('page /library')).toBeTruthy()
    })
})
