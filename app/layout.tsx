import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "./components/sw-register";
import OfflineBanner from "./components/offline-banner";
import QueryProvider from "./components/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: "songbirdweb",
  description: "web ui for downloading formatted songs, for free!",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased p-2 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]`}
      >
        <QueryProvider>
          <OfflineBanner />
          <ServiceWorkerRegistrar />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
