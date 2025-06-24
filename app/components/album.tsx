import { useState } from "react";
import { AlbumProps, DownloadedSong, fetchSong } from "../lib/data";
import { useRouter, useSearchParams } from "next/navigation";
import { FaDownload } from "react-icons/fa";

export default function Album({ album, selected, onClick }: { album: AlbumProps, selected: boolean, onClick: any }) {
    return (
        <button onClick={onClick} disabled={selected} className="dark:disabled:bg-gray-800 dark:hover:bg-gray-900 disabled:bg-gray-300 hover:bg-gray-200 rounded-md p-2">
            <div className="flew-row flex rounded-lg">
                <div className="flex flex-col px-3">
                    <span className="text-1xl font-medium text-left">{album.collectionName}</span>
                    <span className="font-medium text-sky-500 text-left">{album.artistName}</span>
                    <span className="flex gap-2 font-medium text-gray-500">
                        <span>{`${album.trackCount} songs`}</span>
                    </span>
                </div>
            </div>
        </button>
    );
}
