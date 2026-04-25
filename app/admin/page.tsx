import { redirect } from "next/navigation";
import { fetchCurrentUser, fetchUsers } from "../lib/data";
import UserTable from "./user-table";
import { routes } from "../lib/routes";

export default async function Page() {
    const user = await fetchCurrentUser()
    if (user?.role !== 'admin') redirect(routes.download)

    const users = await fetchUsers()

    return (
        <main className="p-4">
            <UserTable initialUsers={users} />
        </main>
    )
}
