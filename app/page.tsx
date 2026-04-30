import { Suspense } from "react";
import Login from "./components/login";

export default function Home() {
    return (
        <Suspense>
            <Login />
        </Suspense>
    );
}
