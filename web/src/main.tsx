import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { AuthProvider } from "./auth/AuthContext.tsx";
import { PlatformAuthProvider } from "./auth/PlatformAuthContext.tsx";
import { PreferencesProvider } from "./preferences/PreferencesContext.tsx";
import { App } from "./App.tsx";
import { initSentry, RootErrorBoundary } from "./observability/sentry.tsx";
import "./components/styles/index.css";

initSentry();

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró el elemento #root");

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <PlatformAuthProvider>
            <PreferencesProvider>
              <TooltipProvider>
                <App />
                <Toaster richColors position="top-right" />
              </TooltipProvider>
            </PreferencesProvider>
          </PlatformAuthProvider>
        </AuthProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);
