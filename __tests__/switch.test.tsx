import { render, screen, fireEvent } from '@testing-library/react'
import { Switch } from '../app/components/switch'

describe('Switch', () => {
    it('reports its state to assistive tech', () => {
        const { rerender } = render(<Switch checked={false} onChange={() => {}} label="frosted bars" />)
        expect(screen.getByRole('switch', { name: 'frosted bars' }).getAttribute('aria-checked')).toBe('false')
        rerender(<Switch checked onChange={() => {}} label="frosted bars" />)
        expect(screen.getByRole('switch', { name: 'frosted bars' }).getAttribute('aria-checked')).toBe('true')
    })

    it('asks for the opposite state when pressed', () => {
        const onChange = jest.fn()
        render(<Switch checked={false} onChange={onChange} label="x" />)
        fireEvent.click(screen.getByRole('switch'))
        expect(onChange).toHaveBeenCalledWith(true)
    })
})
