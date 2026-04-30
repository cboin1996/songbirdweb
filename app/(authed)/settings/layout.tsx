import AppLayout from "../../components/app-layout";

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
    return <AppLayout>{children}</AppLayout>
}
