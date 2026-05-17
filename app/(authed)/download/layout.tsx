import NavBar from "../../components/navbar";
import { Suspense } from "react";
import Search from "../../components/search";
import { fetchCurrentUser } from "../../lib/data";
import { UserProvider } from "../../lib/user-context";
import OfflineGuard from "../../components/offline-guard";
export default async function Layout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser().catch(() => undefined)
    return (
        <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''} userLoaded={user !== undefined}>
            <NavBar />
            <OfflineGuard feature="download">
                <Suspense>
                    <Search />
                </Suspense>
                <Suspense>
                    {children}
                </Suspense>
            </OfflineGuard>
        </UserProvider>
    )
}
