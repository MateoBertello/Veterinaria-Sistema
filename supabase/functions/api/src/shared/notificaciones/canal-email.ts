import { DomainError, ErrorCode } from "../errors.ts";

/**
 * Mensaje a entregar por un canal. Es agnóstico del origen (turno/vacunación),
 * de modo que cualquier procesador del NotificacionService pueda reusarlo.
 */
export interface MensajeNotificacion {
  /** Destino del canal: email del cliente, teléfono, etc. */
  destino: string;
  asunto:  string;
  cuerpo:  string;
}

/**
 * Abstracción de canal de envío. Hoy solo `email` tiene implementación real;
 * WhatsApp/SMS se enchufarán como nuevas implementaciones sin tocar a los
 * consumidores (Addendum §674 — infraestructura de canales compartida).
 */
export interface CanalNotificacion {
  enviar(mensaje: MensajeNotificacion): Promise<void>;
}

function getEnv(key: string): string | undefined {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Canal de email vía la REST API de Resend (sin SDK: una llamada `fetch`).
 *
 * Secrets requeridos en el Edge Function:
 *  - `RESEND_API_KEY`   — clave de API de Resend.
 *  - `NOTIF_FROM_EMAIL` — remitente verificado (ej. "Veterinaria Leo <turnos@tu-dominio>").
 *
 * Si falta cualquiera de los dos, lanza NOTIFICATION_PROVIDER_NOT_CONFIGURED: el
 * procesador marca esa notificación como `fallida` y sigue con el resto del lote.
 */
export class CanalEmailResend implements CanalNotificacion {
  async enviar(mensaje: MensajeNotificacion): Promise<void> {
    const apiKey = getEnv("RESEND_API_KEY");
    const from   = getEnv("NOTIF_FROM_EMAIL");

    if (!apiKey || !from) {
      throw new DomainError(
        ErrorCode.NOTIFICATION_PROVIDER_NOT_CONFIGURED,
        503,
        "El proveedor de email no está configurado (faltan RESEND_API_KEY / NOTIF_FROM_EMAIL)",
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from,
        to:      [mensaje.destino],
        subject: mensaje.asunto,
        html:    mensaje.cuerpo,
      }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(`Resend respondió ${res.status}: ${detalle.slice(0, 300)}`);
    }
  }
}
