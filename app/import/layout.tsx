import NavBar from "../components/navbar";
import { fetchCurrentUser } from "../lib/data";
import { UserProvider } from "../lib/user-context";
import OfflineGuard from "../components/offline-guard";

export default async function Layout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser()
    return (
        <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''}>
            <NavBar />
            <OfflineGuard feature="import">
                {children}
            </OfflineGuard>
        </UserProvider>
    )
}
