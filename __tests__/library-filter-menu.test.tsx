import { render, screen, fireEvent } from '@testing-library/react'
import LibraryFilterMenu from '../app/(authed)/library/library-filter-menu'

describe('LibraryFilterMenu', () => {
    it('shows how many filters are on without opening', () => {
        const { rerender } = render(<LibraryFilterMenu savedOnly={false} onSavedOnlyChange={() => {}} savedCount={2} total={5} />)
        expect(screen.getByTestId('library-filter').textContent).toBe('filter')
        rerender(<LibraryFilterMenu savedOnly onSavedOnlyChange={() => {}} savedCount={2} total={5} />)
        expect(screen.getByTestId('library-filter').textContent).toBe('filter · 1')
    })

    it('lists saved only with its count, checked when on', () => {
        render(<LibraryFilterMenu savedOnly onSavedOnlyChange={() => {}} savedCount={2} total={5} />)
        expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
        fireEvent.click(screen.getByTestId('library-filter'))
        const item = screen.getByRole('menuitemcheckbox', { name: /saved only/ })
        expect(item.getAttribute('aria-checked')).toBe('true')
        expect(item.textContent).toContain('2 of 5')
    })

    it('asks for the opposite state when saved only is pressed', () => {
        const onChange = jest.fn()
        render(<LibraryFilterMenu savedOnly={false} onSavedOnlyChange={onChange} savedCount={0} total={5} />)
        fireEvent.click(screen.getByTestId('library-filter'))
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /saved only/ }))
        expect(onChange).toHaveBeenCalledWith(true)
    })

    it('closes on a click outside', () => {
        render(<div><span data-testid="outside" /><LibraryFilterMenu savedOnly={false} onSavedOnlyChange={() => {}} savedCount={0} total={5} /></div>)
        fireEvent.click(screen.getByTestId('library-filter'))
        expect(screen.getByRole('menu')).toBeTruthy()
        fireEvent.mouseDown(screen.getByTestId('outside'))
        expect(screen.queryByRole('menu')).toBeNull()
    })
})
