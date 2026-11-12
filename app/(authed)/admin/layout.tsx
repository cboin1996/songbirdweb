import OfflineGuard from "../../components/offline-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
    return <OfflineGuard feature="admin">{children}</OfflineGuard>
}
