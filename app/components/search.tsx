'use client'
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import React, { HTMLInputTypeAttribute, useEffect, useState } from "react"
import Button from "./button"
import Input from "./input"
import { FaX } from "react-icons/fa6"
import { useDebouncedCallback } from "use-debounce"

export default function Search() {
    const SONG_MODE = "song"
    const ALBUM_MODE = "album"
    const URL_MODE = "url"
    const searchParams = useSearchParams()
    const [text, setText] = useState(searchParams.get('query')?.toString() || '')
    const [mode, setMode] = useState(searchParams.get('mode')?.toString() || 'song')
    const router = useRouter()
    const { replace } = useRouter()
    const pathname = usePathname()

    function getInputConfigs(mode: string) {
        let placeholder = " enter a song name"
        let type: HTMLInputTypeAttribute = "text"
        let buttonText: string = "search"
        if (mode === SONG_MODE) {
            placeholder = " enter a song name"
            type = "string"
            buttonText = "search"
        }
        if (mode === ALBUM_MODE) {
            placeholder = "enter an album name"
            type = "string"
            buttonText = "search"
        }
        if (mode === URL_MODE) {
            placeholder = "enter a URL from youtube, soundcloud, vimeo"
            type = URL_MODE
            buttonText = "download"
        }
        return {
            placeholder: placeholder,
            type: type,
            buttonText: buttonText
        }
    }

    function handleSearch(event: any) {
        event.preventDefault()
        const params = new URLSearchParams(searchParams)
        // we only support lookup via album mode
        params.delete('lookup')
        if (text) {
            params.set('query', text)
            params.set('mode', mode)
        } else {
            params.delete('query')
            params.delete('mode')
        }
        router.push(`/download/${mode}?${params.toString()}`)
    }

    function resetSearch(e: any) {
        e.preventDefault()
        setText("")
        const params = new URLSearchParams(searchParams)
        params.delete('query')
        params.delete('lookup')
        params.delete('limit')
        replace(`${pathname}?${params.toString()}`)
    }

    useEffect(() => {
        const params = new URLSearchParams(searchParams)
        params.set('mode', mode)
        replace(`${pathname}?${params.toString()}`)
    }, [mode])

    return (
        <form onSubmit={handleSearch}>
            <div className="flex-row flex gap-2 py-4 md:justify-items-center justify-items-stretch">
                <Input
                    placeholder={getInputConfigs(mode).placeholder}
                    onChange={(e: any) => setText(e.target.value)}
                    value={text}
                    width={96}
                    type={getInputConfigs(mode).type}
                />
                <button onClick={resetSearch} type="button">
                    <FaX className="-mx-8 text-gray-700 hover:bg-gray-500 rounded-lg"></FaX>
                </button>
                <Button
                    text={getInputConfigs(mode).buttonText}
                    disabled={text === ""}
                >
                </Button>
                <select name="mode" id="mode" value={mode} onChange={(e: any) => setMode(e.target.value)}>
                    <option value={SONG_MODE}>{SONG_MODE}</option>
                    <option value={ALBUM_MODE}>{ALBUM_MODE}</option>
                    <option value={URL_MODE}>{URL_MODE}</option>
                </select>
            </div>
        </form>
    )
}
