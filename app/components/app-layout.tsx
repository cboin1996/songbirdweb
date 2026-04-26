import NavBar from "./navbar";
import { fetchCurrentUser } from "../lib/data";
import { UserProvider } from "../lib/user-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser()
    return (
        <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''}>
            <NavBar />
            {children}
        </UserProvider>
    )
}
