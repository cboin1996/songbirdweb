'use client'
import Link from "next/link";
import { FaDove } from "react-icons/fa";
import Button from "./button";

export default function NavBar() {
    return (
        <nav className="flex flex-row justify-between">
            <div className="flex flex-row gap-2">
                <p>songbird.</p>
                <Link href="/">
                    <FaDove size="20" className="hover:text-sky-600" />
                </Link>
            </div>
            <div>
                <Link href="/">
                    <Button text="Log out" />
                </Link>
            </div>
        </nav>
    );
}
