import AppLayout from "../../components/app-layout";
import OfflineGuard from "../../components/offline-guard";

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
    return <AppLayout><OfflineGuard feature="admin">{children}</OfflineGuard></AppLayout>
}
