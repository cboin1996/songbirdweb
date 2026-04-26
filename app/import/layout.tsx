import NavBar from "../components/navbar";
import { Suspense } from "react";
import { fetchCurrentUser } from "../lib/data";
import { UserProvider } from "../lib/user-context";

export default async function Layout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser()
    return (
        <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''}>
            <NavBar />
            <Suspense>
                {children}
            </Suspense>
        </UserProvider>
    )
}
