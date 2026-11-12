import NavBar from "../components/navbar";
import { PlayerProvider } from "../components/player";
import { ToastProvider } from "../components/toast";
import { fetchCurrentUser } from "../lib/data";
import { OfflineSaveProvider } from "../lib/offline-save-context";
import { UserProvider } from "../lib/user-context";

export const dynamic = 'force-dynamic';

// The signed-in user is fetched here, once, not in each section's layout: a
// layout is kept when you move between sections, so a tab switch no longer
// waits on a current-user request.
export default async function AuthedGroupLayout({ children }: { children: React.ReactNode }) {
    const user = await fetchCurrentUser().catch(() => undefined)
    return (
        <ToastProvider><OfflineSaveProvider><PlayerProvider>
            <UserProvider isAdmin={user?.role === 'admin'} username={user?.username ?? ''} userLoaded={user !== undefined}>
                <NavBar />
                {children}
            </UserProvider>
        </PlayerProvider></OfflineSaveProvider></ToastProvider>
    )
}
