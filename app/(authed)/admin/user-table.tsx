'use client'
import { useState } from "react";
import { UserInfo, PerUser, updateUser, deleteUser, registerUser } from "../../lib/data";
import Button from "../../components/button";
import Input from "../../components/input";
import SearchInput from "../../components/search-input";

const USER_PAGE_SIZE = 20

interface Props {
    initialUsers: UserInfo[]
    perUser: PerUser[]
}

export default function UserTable({ initialUsers, perUser }: Props) {
    const [users, setUsers] = useState<UserInfo[]>(initialUsers)
    const [search, setSearch] = useState('')
    const [userPage, setUserPage] = useState(0)
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [inviteError, setInviteError] = useState('')

    const statsMap = Object.fromEntries(perUser.map(p => [p.user_id, p]))

    const filtered = users.filter(u => {
        const q = search.toLowerCase()
        return !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
    })
    const userTotalPages = Math.ceil(filtered.length / USER_PAGE_SIZE)
    const pagedUsers = filtered.slice(userPage * USER_PAGE_SIZE, (userPage + 1) * USER_PAGE_SIZE)

    function handleSearchChange(v: string) { setSearch(v); setUserPage(0) }

    async function handleToggleActive(user: UserInfo) {
        try {
            const updated = await updateUser(user.id, { is_active: !user.is_active })
            setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
        } catch {}
    }

    async function handleToggleRole(user: UserInfo) {
        const newRole = user.role === 'admin' ? 'user' : 'admin'
        try {
            const updated = await updateUser(user.id, { role: newRole })
            setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
        } catch {}
    }

    async function handleDelete(user: UserInfo) {
        try {
            await deleteUser(user.id)
            setUsers(prev => prev.filter(u => u.id !== user.id))
        } catch {}
    }

    async function handleInvite(e: React.FormEvent) {
        e.preventDefault()
        setInviteError('')
        if (password !== confirmPassword) {
            setInviteError('passwords do not match')
            return
        }
        try {
            const user = await registerUser(username, email, password)
            setUsers(prev => [...prev, user])
            setUsername('')
            setEmail('')
            setPassword('')
            setConfirmPassword('')
        } catch {
            setInviteError('invite failed — username or email may already exist')
        }
    }

    return (
        <div className="flex flex-col gap-10">

            {/* ── Users ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">users</p>
                <SearchInput
                    value={search}
                    onChange={handleSearchChange}
                    placeholder="filter by username, email, role…"
                    className="w-full max-w-sm"
                />
                <div className="overflow-x-auto">
                    <table className="text-sm w-full">
                        <thead>
                            <tr className="text-gray-400 text-left">
                                <th className="pr-4 font-normal pb-2">user</th>
                                <th className="pr-4 font-normal pb-2">role</th>
                                <th className="pr-4 font-normal pb-2">status</th>
                                <th className="pr-4 font-normal pb-2">library</th>
                                <th className="pr-4 font-normal pb-2">plays</th>
                                <th className="pr-4 font-normal pb-2">downloads</th>
                                <th className="pr-4 font-normal pb-2">last active</th>
                                <th className="font-normal pb-2">actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedUsers.length === 0 ? (
                                <tr><td colSpan={8} className="py-2 text-gray-500">no results</td></tr>
                            ) : pagedUsers.map(user => {
                                const s = statsMap[user.id]
                                return (
                                    <tr key={user.id} className="border-t border-gray-200 dark:border-gray-800 align-middle">
                                        <td className="pr-4 py-2">
                                            <div className="flex flex-col">
                                                <span className="font-medium">{user.username}</span>
                                                <span className="text-gray-500 text-xs">{user.email}</span>
                                            </div>
                                        </td>
                                        <td className="pr-4 py-2">
                                            <span className={`text-xs px-2 py-0.5 rounded ${user.role === 'admin' ? 'text-sky-500' : 'text-gray-400'}`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="pr-4 py-2">
                                            <span className={`text-xs ${user.is_active ? 'text-green-500' : 'text-red-500'}`}>
                                                {user.is_active ? 'active' : 'inactive'}
                                            </span>
                                        </td>
                                        <td className="pr-4 py-2 text-gray-300">{s?.song_count ?? '—'}</td>
                                        <td className="pr-4 py-2 text-gray-300">{s?.play_count ?? '—'}</td>
                                        <td className="pr-4 py-2 text-gray-300">{s?.download_count ?? '—'}</td>
                                        <td className="pr-4 py-2 text-gray-400 text-xs font-mono">
                                            {s?.last_active ? new Date(s.last_active).toISOString().slice(0, 10) : '—'}
                                        </td>
                                        <td className="py-2">
                                            <div className="flex flex-row gap-1 flex-wrap">
                                                <Button text={user.role === 'admin' ? 'make user' : 'make admin'} onClick={() => handleToggleRole(user)} />
                                                <Button text={user.is_active ? 'deactivate' : 'activate'} onClick={() => handleToggleActive(user)} />
                                                <Button text="delete" onClick={() => handleDelete(user)} />
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                {userTotalPages > 1 && (
                    <div className="flex items-center gap-3 text-sm">
                        <button
                            onClick={() => setUserPage(p => Math.max(0, p - 1))}
                            disabled={userPage === 0}
                            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                        >
                            prev
                        </button>
                        <span className="text-gray-400">page {userPage + 1} / {userTotalPages} · {filtered.length} total</span>
                        <button
                            onClick={() => setUserPage(p => Math.min(userTotalPages - 1, p + 1))}
                            disabled={userPage >= userTotalPages - 1}
                            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                        >
                            next
                        </button>
                    </div>
                )}
            </section>

            {/* ── Invite ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">invite user</p>
                <form onSubmit={handleInvite} className="flex flex-col gap-2">
                    <div className="flex flex-row flex-wrap gap-2">
                        <Input placeholder="username" value={username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)} />
                        <Input placeholder="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
                        <Input placeholder="password" type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
                        <Input placeholder="confirm password" type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)} />
                        <Button text="invite" type="submit" disabled={!username || !email || !password || !confirmPassword} />
                    </div>
                    {inviteError && <p className="text-red-500 text-sm">{inviteError}</p>}
                </form>
            </section>
        </div>
    )
}
