import Link from "next/link";
import { FaDove, FaInfoCircle, FaUser } from "react-icons/fa";
import LogoutButton from "./logout-button";
import NavLinks from "./nav-links";
import { fetchCurrentUser } from "../lib/data";
import { routes } from "../lib/routes";

export default async function NavBar() {
    const user = await fetchCurrentUser()

    return (
        <nav className="sticky top-0 z-50 h-11 flex flex-row justify-between items-center bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
            <div className="flex flex-row gap-4 items-center">
                <Link href={routes.download} className="flex flex-row gap-2 items-center">
                    <FaDove size="20" className="hover:text-sky-600" />
                    <p className="hidden sm:block">songbird.</p>
                </Link>
                <NavLinks isAdmin={user?.role === 'admin'} />
            </div>
            <div className="flex flex-row gap-3 items-center">
                <Link href={routes.info} className="hover:text-sky-600">
                    <FaInfoCircle size="16" />
                </Link>
                <Link href={routes.settings} className="hover:text-sky-600">
                    <FaUser size="16" />
                </Link>
                <LogoutButton />
            </div>
        </nav>
    )
}
