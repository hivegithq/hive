import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startClerkIfSignedIn } from "./clerk.ts";
import "./styles.css";

// Clerk's script loads only for visitors who already have a session, or when someone asks to sign in.
startClerkIfSignedIn();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
