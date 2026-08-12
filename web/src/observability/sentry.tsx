import * as Sentry from "@sentry/react";
import { useState, type ReactNode } from "react";

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
 * Fallback accesible del ErrorBoundary raíz: pantalla mínima con recarga y opción
 * de copiar detalles técnicos para reportar al soporte.
 */
function ErrorFallback({ error, resetError }: { error?: Error | null; resetError?: () => void }) {
  const [copied, setCopied] = useState(false);

  const errorDetails = error
    ? `${error.name}: ${error.message}\nStack: ${error.stack ?? 'No disponible'}`
    : 'Sin detalles disponibles';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(errorDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para navegadores sin clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = errorDetails;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div role="alert" className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Algo salió mal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocurrió un error inesperado en la aplicación. Podés recargar la página
          para continuar o copiar los detalles para contactar al administrador.
        </p>
        
        {error && (
          <div className="mt-4 max-h-40 overflow-auto rounded bg-muted p-3 text-left text-xs font-mono text-muted-foreground">
            <pre className="whitespace-pre-wrap">{error.message}</pre>
          </div>
        )}
        
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Recargar la página
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {copied ? '¡Copiado!' : 'Copiar detalles'}
          </button>
          {resetError && (
            <button
              type="button"
              onClick={resetError}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Intentar de nuevo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ErrorBoundary raíz: reporta a Sentry si hay DSN; siempre muestra el fallback. */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary 
      fallback={({ error, resetError }) => <ErrorFallback error={error} resetError={resetError} />}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
