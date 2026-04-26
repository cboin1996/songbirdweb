import { redirect } from "next/navigation";
import { fetchCurrentUser, fetchUsers, fetchAdminStats, fetchAdminErrors } from "../lib/data";
import UserTable from "./user-table";
import SystemStats from "./system-stats";
import { routes } from "../lib/routes";

export default async function Page() {
    const user = await fetchCurrentUser()
    if (user?.role !== 'admin') redirect(routes.download)

    const [users, stats, errors] = await Promise.all([fetchUsers(), fetchAdminStats(), fetchAdminErrors()])

    return (
        <main className="p-4 flex flex-col gap-10">
            <SystemStats stats={stats} errors={errors} />
            <UserTable initialUsers={users} />
        </main>
    )
}
