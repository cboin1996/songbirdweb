'use client'
import { useState } from "react";
import { UserInfo, updateUser, deleteUser, registerUser } from "../lib/data";
import Button from "../components/button";
import Input from "../components/input";
import { useScrollRestoration } from "../lib/use-scroll-restoration";

export default function UserTable({ initialUsers }: { initialUsers: UserInfo[] }) {
    const [users, setUsers] = useState<UserInfo[]>(initialUsers)
    useScrollRestoration()
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [inviteError, setInviteError] = useState('')

    async function handleToggleActive(user: UserInfo) {
        const updated = await updateUser(user.id, { is_active: !user.is_active })
        if (updated) setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
    }

    async function handleToggleRole(user: UserInfo) {
        const newRole = user.role === 'admin' ? 'user' : 'admin'
        const updated = await updateUser(user.id, { role: newRole })
        if (updated) setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
    }

    async function handleDelete(user: UserInfo) {
        const ok = await deleteUser(user.id)
        if (ok) setUsers(prev => prev.filter(u => u.id !== user.id))
    }

    async function handleInvite(e: React.FormEvent) {
        e.preventDefault()
        setInviteError('')
        const user = await registerUser(username, email, password)
        if (!user) {
            setInviteError('invite failed — username or email may already exist')
            return
        }
        setUsers(prev => [...prev, user])
        setUsername('')
        setEmail('')
        setPassword('')
    }

    return (
        <div className="flex flex-col gap-8 py-4">
            <div>
                <p className="text-gray-400 text-sm pb-2">users</p>
                <div className="flex flex-col gap-2">
                    {users.map(user => (
                        <div key={user.id} className="flex flex-row items-center justify-between gap-4 rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-900">
                            <div className="flex flex-col">
                                <span className="font-medium">{user.username}</span>
                                <span className="text-gray-500 text-sm">{user.email}</span>
                            </div>
                            <div className="flex flex-row gap-2 items-center">
                                <span className={`text-sm px-2 py-0.5 rounded ${user.role === 'admin' ? 'text-sky-500' : 'text-gray-400'}`}>
                                    {user.role}
                                </span>
                                <span className={`text-sm ${user.is_active ? 'text-green-600' : 'text-red-500'}`}>
                                    {user.is_active ? 'active' : 'inactive'}
                                </span>
                                <Button text={user.role === 'admin' ? 'make user' : 'make admin'} onClick={() => handleToggleRole(user)} />
                                <Button text={user.is_active ? 'deactivate' : 'activate'} onClick={() => handleToggleActive(user)} />
                                <Button text="delete" onClick={() => handleDelete(user)} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <p className="text-gray-400 text-sm pb-2">invite user</p>
                <form onSubmit={handleInvite} className="flex flex-col gap-2">
                    <div className="flex flex-row gap-2">
                        <Input placeholder="username" value={username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)} />
                        <Input placeholder="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
                        <Input placeholder="password" type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
                        <Button text="invite" disabled={!username || !email || !password} />
                    </div>
                    {inviteError && <p className="text-red-500 text-sm">{inviteError}</p>}
                </form>
            </div>
        </div>
    )
}
