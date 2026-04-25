import NavBar from "../components/navbar";
import { Suspense } from "react";
import Search from "../components/search";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <NavBar />
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 px-2">
                <Suspense>
                    <Search />
                </Suspense>
            </div>
            <Suspense>
                {children}
            </Suspense>
        </>
    )
}
