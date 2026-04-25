'use client'
import { useRouter } from "next/navigation";
import { logout } from "../lib/data";
import Button from "./button";
import { routes } from "../lib/routes";

export default function LogoutButton() {
    const router = useRouter()

    async function handleLogout() {
        await logout()
        router.push(routes.home)
    }

    return <Button text="Log out" onClick={handleLogout} />
}
