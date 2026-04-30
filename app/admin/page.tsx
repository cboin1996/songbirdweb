import { redirect } from "next/navigation";
import { fetchCurrentUser, fetchUsers, fetchAdminStats } from "../lib/data";
import UserTable from "./user-table";
import SystemStats from "./system-stats";
import { routes } from "../lib/routes";

export const dynamic = 'force-dynamic';

export default async function Page() {
    const user = await fetchCurrentUser()
    if (user?.role !== 'admin') redirect(routes.download)

    const [users, stats] = await Promise.all([fetchUsers(), fetchAdminStats()])

    return (
        <main className="p-4 flex flex-col gap-10">
            <SystemStats stats={stats} />
            <UserTable initialUsers={users} perUser={stats?.per_user ?? []} />
        </main>
    )
}
