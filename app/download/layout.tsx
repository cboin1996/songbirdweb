import NavBar from "../components/navbar";
import { Suspense } from "react";
import Search from "../components/search";
import { fetchCurrentUser } from "../lib/data";
import { UserProvider } from "../lib/user-context";
import OfflineGuard from "../components/offline-guard";

export default async function Layout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser()
    return (
        <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''}>
            <NavBar />
            <OfflineGuard feature="download">
                <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 px-2">
                    <Suspense>
                        <Search />
                    </Suspense>
                </div>
                <Suspense>
                    {children}
                </Suspense>
            </OfflineGuard>
        </UserProvider>
    )
}
