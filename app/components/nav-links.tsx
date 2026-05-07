'use client'
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaBars, FaTimes } from "react-icons/fa";
import { routes } from "../lib/routes";
import { useOnline } from "../lib/use-online";
import { useUser } from "../lib/user-context";

const OFFLINE_SUPPORTED = new Set<string>([routes.library, routes.settings])

export default function NavLinks() {
    const { isAdmin } = useUser()
    const [open, setOpen] = useState(false)
    const pathname = usePathname()
    const online = useOnline()

    const links = [
        { href: routes.download, label: 'download' },
        { href: routes.import, label: 'import' },
        { href: routes.library, label: 'library' },
        { href: routes.explore, label: 'explore' },
        ...(isAdmin ? [{ href: routes.admin, label: 'admin' }] : []),
    ]

    function linkClass(href: string) {
        const active = pathname.startsWith(href)
        const disabled = !online && !OFFLINE_SUPPORTED.has(href)
        if (disabled) return 'opacity-30 cursor-not-allowed pointer-events-none'
        return active ? 'text-sky-500' : 'hover:text-sky-600'
    }

    function renderLink(l: { href: string; label: string }, onClick?: () => void) {
        const disabled = !online && !OFFLINE_SUPPORTED.has(l.href)
        if (disabled) {
            return (
                <span key={l.href} className={linkClass(l.href)} title="not available offline">
                    {l.label}
                </span>
            )
        }
        return (
            <Link key={l.href} href={l.href} className={linkClass(l.href)} onClick={onClick}>
                {l.label}
            </Link>
        )
    }

    return (
        <>
            <div className="hidden sm:flex flex-row gap-4 items-center">
                {links.map(l => renderLink(l))}
            </div>
            <div className="sm:hidden">
                <button onClick={() => setOpen(p => !p)} className="hover:text-sky-600">
                    {open ? <FaTimes size={16} /> : <FaBars size={16} />}
                </button>
                {open && (
                    <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex flex-col p-4 gap-4 z-40">
                        {links.map(l => renderLink(l, OFFLINE_SUPPORTED.has(l.href) ? () => setOpen(false) : undefined))}
                    </div>
                )}
            </div>
        </>
    )
}
