import Link from "next/link";
import { FaDove, FaUser } from "react-icons/fa";
import LogoutButton from "./logout-button";
import { fetchCurrentUser } from "../lib/data";

export default async function NavBar() {
    const user = await fetchCurrentUser()

    return (
        <nav className="flex flex-row justify-between items-center">
            <div className="flex flex-row gap-4 items-center">
                <Link href="/download" className="flex flex-row gap-2 items-center">
                    <FaDove size="20" className="hover:text-sky-600" />
                    <p>songbird.</p>
                </Link>
                <Link href="/download" className="hover:text-sky-600">download</Link>
                {user?.role === 'admin' && (
                    <Link href="/admin" className="hover:text-sky-600">admin</Link>
                )}
            </div>
            <div className="flex flex-row gap-3 items-center">
                <Link href="/settings" className="hover:text-sky-600">
                    <FaUser size="16" />
                </Link>
                <LogoutButton />
            </div>
        </nav>
    )
}
