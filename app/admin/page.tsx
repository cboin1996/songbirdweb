import { redirect } from "next/navigation";
import { fetchCurrentUser, fetchUsers } from "../lib/data";
import UserTable from "./user-table";

export default async function Page() {
    const user = await fetchCurrentUser()
    if (user?.role !== 'admin') redirect('/download')

    const users = await fetchUsers()

    return (
        <main className="p-4">
            <UserTable initialUsers={users} />
        </main>
    )
}
