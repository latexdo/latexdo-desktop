import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import appIconUrl from "../build/icon.svg";
import App from "./App";
import { installBrowserApis } from "./browserApi";
import { CollaborationProvider } from "./collaboration/CollaborationProvider";
import { RendererErrorBoundary } from "./RendererErrorBoundary";
import { installRendererDiagnostics } from "./rendererDiagnostics";
import "./styles/tokens.css";
import "./styles.css";

const favicon =
  document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
  document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = appIconUrl;

if (!favicon.parentElement) {
  document.head.appendChild(favicon);
}

installBrowserApis();
installRendererDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RendererErrorBoundary>
      <CollaborationProvider>
        <App />
      </CollaborationProvider>
    </RendererErrorBoundary>
  </StrictMode>,
);
