import { useState } from "react";
import { DownloadedSong, fetchSong } from "../lib/data";
import { useRouter, useSearchParams } from "next/navigation";
import { FaDownload } from "react-icons/fa";

export default function Song({ song, selected, onClick }: { song: DownloadedSong, selected: boolean, onClick: any }) {
    const color = song.songId !== undefined ? "text-green-700" : "text-red-700"
    return (
        <button onClick={onClick} disabled={selected} className="dark:disabled:bg-gray-800 dark:hover:bg-gray-900 hover:bg-gray-200 disabled:bg-gray-300 rounded-md p-2">
            <div className="flex flex-row justify-between">
                <div className="flew-row flex rounded-lg">
                    <div>
                        <img className="min-w-24 rounded-md object-contain" alt="" src={song.properties.artworkUrl100} />
                    </div>
                    <div className="flex flex-col px-3">
                        <span className="text-2xl font-medium text-left">{song.properties.trackName}</span>
                        <span className="font-medium text-sky-500 text-left">{`${song.properties.artistName} · ${song.properties.collectionName}`}</span>
                        <span className="flex gap-2 font-medium text-gray-500">
                            <span>{`${song.properties.trackNumber} of ${song.properties.trackCount}`}</span>
                            <span>·</span>
                            <span>{song.properties.releaseDate}</span>
                        </span>
                    </div>
                </div>
                <FaDownload
                    className={`${color} min-w-3 max-w-3`}
                />
            </div>
        </button>
    );
}
