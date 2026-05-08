'use client'
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useUser } from "../../lib/user-context"
import { routes } from "../../lib/routes"
import AdminContent from "./admin-content"

export default function Page() {
    const { isAdmin, userLoaded } = useUser()
    const router = useRouter()

    useEffect(() => {
        if (userLoaded && !isAdmin) router.replace(routes.download)
    }, [isAdmin, userLoaded, router])

    if (userLoaded && !isAdmin) return null
    return <AdminContent />
}
