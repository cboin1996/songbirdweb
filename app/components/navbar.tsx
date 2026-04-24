'use client'
import { FaDove } from "react-icons/fa";
import Button from "./button";
import { useRouter } from "next/navigation";
import { logout } from "../lib/data";

export default function NavBar() {
    const router = useRouter()

    async function handleLogout() {
        await logout()
        router.push('/')
    }

    return (
        <nav className="flex flex-row justify-between">
            <div className="flex flex-row gap-2">
                <p>songbird.</p>
                <FaDove size="20" className="hover:text-sky-600" />
            </div>
            <div>
                <Button text="Log out" onClick={handleLogout} />
            </div>
        </nav>
    );
}
