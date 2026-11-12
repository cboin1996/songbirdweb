import { render, screen, fireEvent } from '@testing-library/react'
import { ArtImage } from '../app/components/art-image'

const stand = <div data-testid="stand">music</div>

describe('ArtImage', () => {
    it('shows the image while it loads', () => {
        render(<ArtImage src="/v1/songs/a/artwork/thumb" alt="" data-testid="art" width={48} height={48} unoptimized fallback={stand} />)
        expect(screen.getByTestId('art')).toBeTruthy()
        expect(screen.queryByTestId('stand')).toBeNull()
    })

    it('swaps to the stand-in when the image fails', () => {
        render(<ArtImage src="/v1/songs/a/artwork/thumb" alt="" data-testid="art" width={48} height={48} unoptimized fallback={stand} />)
        fireEvent.error(screen.getByTestId('art'))
        expect(screen.getByTestId('stand')).toBeTruthy()
        expect(screen.queryByTestId('art')).toBeNull()
    })

    it('tries a new source afresh after one failed', () => {
        const { rerender } = render(<ArtImage src="/v1/songs/a/artwork/thumb" alt="" data-testid="art" width={48} height={48} unoptimized fallback={stand} />)
        fireEvent.error(screen.getByTestId('art'))
        rerender(<ArtImage src="/v1/songs/b/artwork/thumb" alt="" data-testid="art" width={48} height={48} unoptimized fallback={stand} />)
        expect(screen.getByTestId('art').getAttribute('src')).toContain('/v1/songs/b/')
        expect(screen.queryByTestId('stand')).toBeNull()
    })
})
