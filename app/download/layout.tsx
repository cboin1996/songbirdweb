import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";

import "../globals.css";
import NavBar from "../components/navbar";
import { Suspense } from "react";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});


export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <section
            className={`${geistSans.variable} ${geistMono.variable} antialiased p-8`}
        >
            <NavBar></NavBar>
            <Suspense>
                {children}
            </Suspense>
        </section>
    );
}
