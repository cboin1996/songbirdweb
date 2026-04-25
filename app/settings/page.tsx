'use client'
import { useEffect, useRef, useState } from "react";
import { changePassword } from "../lib/data";
import Button from "../components/button";
import Input from "../components/input";
import { FaEye, FaEyeSlash } from "react-icons/fa";

function PasswordField({ placeholder, value, onChange, inputRef }: {
    placeholder: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    inputRef?: React.Ref<HTMLInputElement>
}) {
    const [show, setShow] = useState(false)
    return (
        <div className="relative">
            <Input
                ref={inputRef}
                required
                type={show ? 'text' : 'password'}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                classAttrs="w-full pr-8"
            />
            <button
                type="button"
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShow(p => !p)}
            >
                {show ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
            </button>
        </div>
    )
}

export default function Page() {
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const confirmRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!confirmRef.current) return
        confirmRef.current.setCustomValidity(
            confirmPassword && newPassword !== confirmPassword ? 'passwords do not match' : ''
        )
    }, [newPassword, confirmPassword])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setSuccess(false)

        const ok = await changePassword(currentPassword, newPassword)
        if (!ok) {
            setError('incorrect current password')
            return
        }

        setSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
    }

    return (
        <main className="p-4">
            <div className="flex flex-col gap-8 py-4">
                <div>
                    <p className="text-gray-400 text-sm pb-2">change password</p>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-64">
                        <PasswordField
                            placeholder="current password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                        />
                        <PasswordField
                            placeholder="new password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <PasswordField
                            placeholder="confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            inputRef={confirmRef}
                        />
                        <Button
                            text="update password"
                            disabled={!currentPassword || !newPassword || !confirmPassword}
                        />
                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        {success && <p className="text-green-600 text-sm">password updated</p>}
                    </form>
                </div>
            </div>
        </main>
    )
}
