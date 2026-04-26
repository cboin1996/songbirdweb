'use client'
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaBars, FaTimes } from "react-icons/fa";
import { routes } from "../lib/routes";

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
    const [open, setOpen] = useState(false)
    const pathname = usePathname()

    const links = [
        { href: routes.download, label: 'download' },
        { href: routes.import, label: 'import' },
        { href: routes.library, label: 'library' },
        { href: routes.explore, label: 'explore' },
        ...(isAdmin ? [{ href: routes.admin, label: 'admin' }] : []),
    ]

    function linkClass(href: string) {
        return pathname.startsWith(href) ? 'text-sky-500' : 'hover:text-sky-600'
    }

    return (
        <>
            <div className="hidden sm:flex flex-row gap-4 items-center">
                {links.map(l => (
                    <Link key={l.href} href={l.href} className={linkClass(l.href)}>{l.label}</Link>
                ))}
            </div>
            <div className="sm:hidden">
                <button onClick={() => setOpen(p => !p)} className="hover:text-sky-600">
                    {open ? <FaTimes size={16} /> : <FaBars size={16} />}
                </button>
                {open && (
                    <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex flex-col p-4 gap-4 z-40">
                        {links.map(l => (
                            <Link key={l.href} href={l.href} className={linkClass(l.href)} onClick={() => setOpen(false)}>
                                {l.label}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </>
    )
}
