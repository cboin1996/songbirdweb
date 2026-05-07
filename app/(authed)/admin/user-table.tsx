'use client'
import React, { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { UserInfo, UsersPage, PerUser, updateUser, deleteUser, registerUser, fetchUsers, fetchAdminStats } from "../../lib/data";
import { queryKeys } from "../../lib/query-keys";
import { useDebouncedValue } from "../../lib/use-debounce";
import Button from "../../components/button";
import Input from "../../components/input";
import SearchInput from "../../components/search-input";
import QueryError from "../../components/query-error";

const USER_PAGE_SIZE = 10

export default function UserTable() {
    const [search, setSearch] = useState('')
    const [userPage, setUserPage] = useState(0)
    const debouncedSearch = useDebouncedValue(search)

    const { data: usersPage, error: usersError, refetch: refetchUsers, isLoading: usersLoading, isFetching: usersFetching } = useQuery({
        queryKey: ['admin-users', debouncedSearch, userPage],
        queryFn: () => fetchUsers(debouncedSearch, USER_PAGE_SIZE, userPage * USER_PAGE_SIZE),
        placeholderData: keepPreviousData,
        retry: false,
    })
    const usersData = usersPage?.users ?? []
    const usersTotal = usersPage?.total ?? 0
    const { data: statsData } = useQuery({
        queryKey: queryKeys.adminStats,
        queryFn: fetchAdminStats,
        retry: false,
    })
    const perUser = statsData?.per_user ?? []
    const [localUsers, setLocalUsers] = useState<UserInfo[] | null>(null)
    const users = localUsers ?? usersData

    function setUsers(updater: (prev: UserInfo[]) => UserInfo[]) {
        setLocalUsers(prev => updater(prev ?? usersData))
    }
    const [deleteTarget, setDeleteTarget] = useState<UserInfo | null>(null)
    const [deletePassword, setDeletePassword] = useState('')
    const [deleteError, setDeleteError] = useState('')
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [inviteError, setInviteError] = useState('')

    const statsMap = Object.fromEntries(perUser.map(p => [p.user_id, p]))

    const userTotalPages = Math.max(1, Math.ceil(usersTotal / USER_PAGE_SIZE))

    function handleSearchChange(v: string) { setSearch(v); setUserPage(0); setLocalUsers(null) }

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

    async function handleDeleteConfirm() {
        if (!deleteTarget) return
        setDeleteError('')
        try {
            await deleteUser(deleteTarget.id, deletePassword)
            setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
            setDeleteTarget(null)
            setDeletePassword('')
        } catch {
            setDeleteError('incorrect password or delete failed')
        }
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

    if (usersLoading) return null

    return (
        <div className="flex flex-col gap-10">

            {/* ── Users ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">users</p>
                {usersError && <QueryError error={usersError} retry={refetchUsers} context="users" />}
                <SearchInput
                    value={search}
                    onChange={handleSearchChange}
                    placeholder="filter by username, email, role…"
                    className="w-full max-w-sm"
                />
                <div className={`overflow-x-auto transition-opacity ${usersFetching ? 'opacity-50' : ''}`}>
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
                            {users.length === 0 ? (
                                <tr><td colSpan={8} className="py-2 text-gray-500">no results</td></tr>
                            ) : users.map(user => {
                                const s = statsMap[user.id]
                                return (<React.Fragment key={user.id}>
                                    <tr className="border-t border-gray-200 dark:border-gray-800 align-middle">
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
                                                <Button text="delete" onClick={() => { setDeleteTarget(user); setDeletePassword(''); setDeleteError('') }} />
                                            </div>
                                        </td>
                                    </tr>
                                    {deleteTarget?.id === user.id && (
                                        <tr className="bg-red-50 dark:bg-red-950/20">
                                            <td colSpan={8} className="py-2 px-4">
                                                <form onSubmit={e => { e.preventDefault(); handleDeleteConfirm() }} className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm text-red-600 dark:text-red-400">delete {user.username}?</span>
                                                    <Input
                                                        placeholder="your password"
                                                        type="password"
                                                        value={deletePassword}
                                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeletePassword(e.target.value)}
                                                    />
                                                    <Button text="confirm delete" type="submit" disabled={!deletePassword} />
                                                    <Button text="cancel" onClick={() => setDeleteTarget(null)} />
                                                    {deleteError && <span className="text-red-500 text-xs">{deleteError}</span>}
                                                </form>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>)
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
                        <span className="text-gray-400">{userPage + 1} / {userTotalPages}</span>
                        <button
                            onClick={() => setUserPage(p => Math.min(userTotalPages - 1, p + 1))}
                            disabled={userPage >= userTotalPages - 1}
                            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                        >
                            next
                        </button>
                        <span className="text-gray-500 text-xs">{usersTotal} total</span>
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
