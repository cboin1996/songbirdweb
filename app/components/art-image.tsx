'use client'

import Image, { type ImageProps } from 'next/image'
import { useState, type ReactNode } from 'react'

type ArtImageProps = Omit<ImageProps, 'onError'> & {
    /** Shown instead of the image when it fails to load (the same stand-in a song with no art gets). */
    fallback: ReactNode
}

/**
 * Artwork that never leaves an empty box: when the request fails (a 404 for art the
 * server no longer has, an optimizer refusal, a dropped connection) the stand-in shows.
 * The failure is remembered per source, so a new source gets a fresh try.
 */
export function ArtImage({ fallback, src, ...rest }: ArtImageProps) {
    const [failedSrc, setFailedSrc] = useState<unknown>(null)
    if (failedSrc === src) return <>{fallback}</>
    return <Image {...rest} src={src} onError={() => setFailedSrc(src)} />
}
