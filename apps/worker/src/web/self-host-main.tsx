import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SelfHostedApp } from "./SelfHostedApp.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<SelfHostedApp />
	</StrictMode>,
);
