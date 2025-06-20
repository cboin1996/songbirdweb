'use client'
import Link from "next/link";
import { FaDove } from "react-icons/fa";
import React, { useState } from 'react'
import { useRouter } from "next/navigation";
import Input from "./input";
import Button from "./button";

export default function Login() {
    const router = useRouter()
    const statuses = {
        sending: "sending",
        authorized: "authorized",
        unauthorized: "unauthorized",
        login: "login"
    }
    const [text, setText] = useState('')
    const [status, setStatus] = useState(statuses.login)

    const isSending = status === statuses.sending

    async function handleSubmit(e: any) {
        e.preventDefault();
        setStatus(statuses.sending)
        const resp = await fetch("http://localhost:8000/",
            {
                method: "GET",
                headers: {
                    "x-api-key": text
                }
            }
        )
        if (resp.status === 401 || resp.status === 403) {
            setStatus(statuses.unauthorized)
        }
        if (resp.status === 200) {
            setStatus(statuses.authorized)
            router.push(`/download?apiKey=${text}`)
        }

    }

    return (
        <div className="grid min-h-screen grid-rows-[20px_1fr_20px] items-center justify-items-center gap-16 p-8 pb-20 sm:p-20">
            <main className="row-start-2 flex flex-col items-center gap-[32px]">
                <p className="font-medium">songbird.</p>
                <form>
                    <div className="row-start-2 flex flex-row items-center gap-3">
                        <Input
                            placeholder="enter api key"
                            disabled={isSending}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                        />
                        <button className="disabled:text-sky-500"
                            onClick={handleSubmit}
                            disabled={isSending}
                        >
                            <FaDove
                                size="20"
                                className="hover:text-sky-600"
                            />
                        </button>
                        <p>{status}</p>
                    </div>
                </form>
            </main>
        </div >
    );
}
