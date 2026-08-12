import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";

/**
 * Observabilidad del frontend (Sentry). Espejo de la política del backend
 * (middleware/errorHandler.ts, Regla 7): nunca viajan a Sentry datos de
 * usuario, requests ni entidades de negocio — solo tipo de error, mensaje
 * y environment.
 *
 * Sin `VITE_SENTRY_DSN` (dev local, tests) todo es no-op: no se inicializa
 * el SDK y el ErrorBoundary actúa como boundary común de React.
 */

/** Barrera anti-PII / datos clínicos: igual criterio que scrubEvent del backend. */
function scrubEvent<T>(event: T): T {
  const e = event as Record<string, unknown>;
  delete e["request"];
  delete e["user"];
  delete e["extra"];
  delete e["contexts"];
  delete e["breadcrumbs"];
  return event;
}

export function initSentry(): void {
  const dsn = import.meta.env["VITE_SENTRY_DSN"] as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      (import.meta.env["VITE_SENTRY_ENVIRONMENT"] as string | undefined) ??
      import.meta.env.MODE,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    // Los breadcrumbs registran navegación/fetch (URLs con ids de entidades):
    // se descartan en origen, no solo en beforeSend.
    beforeBreadcrumb: () => null,
  });
}

/**
 * Fallback accesible del ErrorBoundary raíz: pantalla mínima con recarga.
 * Markup plano (sin kit UI) para que un fallo en el árbol de la app no pueda
 * arrastrar también al fallback.
 */
function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div role="alert" className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Algo salió mal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocurrió un error inesperado en la aplicación. Podés recargar la página
          para continuar; si el problema persiste, contactá al administrador.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Recargar la página
        </button>
      </div>
    </div>
  );
}

/** ErrorBoundary raíz: reporta a Sentry si hay DSN; siempre muestra el fallback. */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
