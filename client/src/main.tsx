import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/context/auth";
import { TopbarActionsProvider } from "@/lib/topbar-actions-context";
import { queryClient } from "@/lib/query-client";
import { App } from "./App";
import "./globals.css";

// TopbarActionsProvider wraps the app exactly as the old Next.js layout.tsx did — the Topbar and
// per-page "topbar actions" (buttons a page injects into the top bar) read it via useTopbarActions.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TopbarActionsProvider>
            <App />
          </TopbarActionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
