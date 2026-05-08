import { PlayerProvider } from "../components/player";
import { ToastProvider } from "../components/toast";
import { OfflineSaveProvider } from "../lib/offline-save-context";

export const dynamic = 'force-dynamic';

export default function AuthedGroupLayout({ children }: { children: React.ReactNode }) {
    return <ToastProvider><OfflineSaveProvider><PlayerProvider>{children}</PlayerProvider></OfflineSaveProvider></ToastProvider>
}
