import { PlayerProvider } from "../components/player";

export const dynamic = 'force-dynamic';

export default function AuthedGroupLayout({ children }: { children: React.ReactNode }) {
    return <PlayerProvider>{children}</PlayerProvider>
}
