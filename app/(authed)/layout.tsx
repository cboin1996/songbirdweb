import { PlayerProvider } from "../components/player";
import { ToastProvider } from "../components/toast";

export const dynamic = 'force-dynamic';

export default function AuthedGroupLayout({ children }: { children: React.ReactNode }) {
    return <ToastProvider><PlayerProvider>{children}</PlayerProvider></ToastProvider>
}
