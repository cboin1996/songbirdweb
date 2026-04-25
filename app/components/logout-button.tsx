'use client'
import { useRouter } from "next/navigation";
import { logout } from "../lib/data";
import Button from "./button";

export default function LogoutButton() {
    const router = useRouter()

    async function handleLogout() {
        await logout()
        router.push('/')
    }

    return <Button text="Log out" onClick={handleLogout} />
}
