import { Suspense } from "react";
import Search from "../../components/search";
import OfflineGuard from "../../components/offline-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <OfflineGuard feature="download">
            <Suspense>
                <Search />
            </Suspense>
            <Suspense>
                {children}
            </Suspense>
        </OfflineGuard>
    )
}
