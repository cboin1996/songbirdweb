'use client'
import SystemStats from "./system-stats"
import UserTable from "./user-table"

export default function AdminContent() {
    return (
        <main className="p-4 flex flex-col gap-10">
            <SystemStats />
            <UserTable />
        </main>
    )
}
