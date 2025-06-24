'use client'
import { useEffect, useState } from "react";
import { AlbumProps, DownloadedSong, downloadSongViaUrl, fetchSong, tagSong } from "../lib/data";
import Album from "./album";
import { useRouter, useSearchParams } from "next/navigation";

export default function Albums({ albums }: { albums: AlbumProps[] }) {
    const searchParams = useSearchParams()

    const noActiveIndex = -1
    const [activeIndex, setActiveIndex] = useState(noActiveIndex);
    const router = useRouter()

    // trigger handleSongSelection() on index selection change
    async function goToSongs() {
        if (noActiveIndex === activeIndex) {
            return
        }
        const params = new URLSearchParams(searchParams)
        const activeAlbum = albums[activeIndex]
        params.set('query', activeAlbum.collectionId.toString())
        params.set('lookup', "true")
        params.set('mode', "song")
        params.set('limit', activeAlbum.trackCount.toString())
        router.push(`/download/song?${params.toString()}`)
    }

    useEffect(() => {
        goToSongs()
    }, [activeIndex])



    return (
        <div>
           <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 md:gap-8 rounded-2xl justify-items-stretch py-2">
                {
                    albums.length > 0 ? (
                    albums.map((
                        album: AlbumProps, i) => <Album key={i} album={album} selected={activeIndex === i} onClick={() => setActiveIndex(i)}></Album>
                    )
                    ) :
                    (
                        <p>no albums found.</p>
                    )
                }
            </div>
        </div>
    );
} 
