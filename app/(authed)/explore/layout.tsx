import AppLayout from "../../components/app-layout";
import OfflineGuard from "../../components/offline-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
    return <AppLayout><OfflineGuard feature="explore">{children}</OfflineGuard></AppLayout>
}
