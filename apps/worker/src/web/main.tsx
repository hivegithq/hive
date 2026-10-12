import { ClerkProvider } from "@clerk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ACCESS, CLERK_KEY } from "./clerk.ts";
import "./styles.css";

// Clerk's components in Hive's colours.
const appearance = {
	variables: {
		colorPrimary: "#fbad41",
		colorPrimaryForeground: "#0d0d0f",
		colorBackground: "#141417",
		colorForeground: "#fff4e0",
		colorMutedForeground: "#a1a1aa",
		colorInput: "#1c1c20",
		colorInputForeground: "#fff4e0",
		colorNeutral: "#fff4e0",
		colorBorder: "#2e2e33",
		colorModalBackdrop: "rgba(13,13,15,0.75)",
		borderRadius: "0.375rem",
	},
};

const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

createRoot(document.getElementById("root")!).render(
	ACCESS === "clerk" ? (
		<ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/" appearance={appearance}>
			{app}
		</ClerkProvider>
	) : (
		app
	),
);
