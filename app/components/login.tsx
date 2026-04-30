'use client'
import { FaDove } from "react-icons/fa";
import React, { useState } from 'react'
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Input from "./input";
import { login } from "../lib/data";
import { routes } from "../lib/routes";

export default function Login() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const next = searchParams.get('next')
    const statuses = {
        idle: "",
        sending: "signing in…",
        unauthorized: "invalid credentials",
        error: "error occurred",
    }
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [status, setStatus] = useState(statuses.idle)

    const isSending = status === statuses.sending

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setStatus(statuses.sending)
        const result = await login(username, password)
        if (result === 401) { setStatus(statuses.unauthorized); return }
        if (result === 'error') { setStatus(statuses.error); return }
        window.location.href = next ?? routes.download
    }

    return (
        <div className="grid min-h-screen grid-rows-[20px_1fr_20px] items-center justify-items-center gap-16 p-8 pb-20 sm:p-20">
            <main className="row-start-2 flex flex-col items-center gap-[32px]">
                <p className="font-medium">songbird.</p>
                <form onSubmit={handleSubmit}>
                    <div className="flex flex-col items-center gap-3">
                        <Input
                            placeholder="username"
                            disabled={isSending}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                            value={username}
                        />
                        <Input
                            placeholder="password"
                            type="password"
                            disabled={isSending}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                            value={password}
                        />
                        <div className="flex flex-row items-center gap-3">
                            <button
                                type="submit"
                                data-testid="login-submit"
                                className="disabled:text-sky-500"
                                disabled={isSending || username === '' || password === ''}
                            >
                                <FaDove size="20" className="hover:text-sky-600" />
                            </button>
                            {status && <p>{status}</p>}
                        </div>
                    </div>
                </form>
            </main>
        </div>
    );
}
