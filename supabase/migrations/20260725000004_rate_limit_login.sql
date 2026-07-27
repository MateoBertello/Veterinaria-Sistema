-- =====================================================================
-- MIGRACIÓN: rate limit del login persistido (RN-AUT5)
-- =====================================================================
-- PROBLEMA: el limitador vivía en un `Map` del módulo de la Edge Function.
-- Eso significa que:
--   • se perdía entero en cada arranque en frío (que en serverless es la
--     situación normal, no la excepción),
--   • no se compartía entre instancias: N instancias = N × 5 intentos, y
--   • se indexaba por `X-Forwarded-For`, un header que manda el cliente:
--     cambiándolo en cada intento, los reintentos eran infinitos.
--
-- O sea: la regla existía en el código pero no frenaba una fuerza bruta real.
--
-- SOLUCIÓN: el contador vive en la base (única para todas las instancias) y se
-- lleva por DOS claves independientes, CON UMBRALES DISTINTOS:
--   • `user:<identificador>` — la que importa, y la estricta (5). Un atacante
--     que va contra UNA cuenta no puede evadirla: el identificador es
--     justamente lo que necesita mantener fijo para atacarla.
--   • `ip:<ip>` — defensa secundaria contra el barrido de MUCHAS cuentas desde
--     un mismo origen, con un techo mucho más alto (50). Tiene que ser holgado
--     porque una clínica entera sale por una sola IP pública: con el mismo
--     umbral que el de usuario, cinco contraseñas mal tipeadas entre todo el
--     personal dejaban al local completo sin poder entrar durante 15 minutos.
--     Además se sabe que la IP es falsificable, así que no es la que sostiene
--     la regla.
--
-- El conteo y la verificación ocurren en la MISMA sentencia (UPSERT con
-- RETURNING), así que dos intentos concurrentes no pueden colarse por una
-- carrera entre "leer contador" y "escribir contador".
-- =====================================================================

CREATE TABLE intentos_login (
  -- Clave del bucket: 'user:<identificador>' o 'ip:<direccion>'.
  clave             TEXT        PRIMARY KEY,
  intentos          INT         NOT NULL DEFAULT 1,
  -- Momento en que arrancó la ventana vigente (no el primer intento histórico).
  ventana_inicio    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_intento_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Para la purga de buckets viejos.
CREATE INDEX idx_intentos_login_ultimo ON intentos_login (ultimo_intento_at);

COMMENT ON TABLE intentos_login IS
  'Contador de intentos de login por identificador y por IP (RN-AUT5). Sin tenant_id: el login ocurre ANTES de resolver el tenant.';

-- Tabla de infraestructura: no la toca ningún usuario, solo la Edge Function
-- con service_role. RLS activa + sin políticas = nadie más entra.
ALTER TABLE intentos_login ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE intentos_login FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Registrar un intento y decir si quedó bloqueado
-- ─────────────────────────────────────────────────────────────────────
-- Devuelve TRUE si alguna de las claves superó el máximo dentro de la ventana.
-- Se llama al PRINCIPIO del login (cuenta todo intento) y se limpia al lograr
-- entrar, con lo cual en la práctica cuenta intentos fallidos consecutivos.
-- `p_claves` y `p_maximos` son arreglos PARALELOS: cada bucket trae su propio
-- techo (ver la nota de arriba sobre por qué el de IP tiene que ser más alto).
CREATE OR REPLACE FUNCTION public.registrar_intento_login(
  p_claves          TEXT[],
  p_maximos         INT[],
  p_ventana_minutos INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clave     TEXT;
  v_intentos  INT;
  v_indice    INT := 0;
  v_bloqueado BOOLEAN := false;
BEGIN
  IF array_length(p_claves, 1) IS DISTINCT FROM array_length(p_maximos, 1) THEN
    RAISE EXCEPTION 'p_claves y p_maximos deben tener la misma longitud';
  END IF;

  FOREACH v_clave IN ARRAY p_claves LOOP
    v_indice := v_indice + 1;

    INSERT INTO intentos_login AS il (clave, intentos, ventana_inicio, ultimo_intento_at)
    VALUES (v_clave, 1, now(), now())
    ON CONFLICT (clave) DO UPDATE
      SET intentos = CASE
            WHEN il.ventana_inicio < now() - make_interval(mins => p_ventana_minutos)
              THEN 1                      -- ventana vencida: arranca de cero
            ELSE il.intentos + 1
          END,
          ventana_inicio = CASE
            WHEN il.ventana_inicio < now() - make_interval(mins => p_ventana_minutos)
              THEN now()
            ELSE il.ventana_inicio
          END,
          ultimo_intento_at = now()
    RETURNING il.intentos INTO v_intentos;

    IF v_intentos > p_maximos[v_indice] THEN
      v_bloqueado := true;
    END IF;
  END LOOP;

  RETURN v_bloqueado;
END $$;

COMMENT ON FUNCTION public.registrar_intento_login(TEXT[], INT[], INT) IS
  'Suma 1 a cada bucket y devuelve true si alguno superó SU máximo en la ventana (RN-AUT5). Atómico: cuenta y verifica en la misma sentencia.';

-- ─────────────────────────────────────────────────────────────────────
-- Limpiar los buckets tras un login exitoso
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.limpiar_intentos_login(p_claves TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM intentos_login WHERE clave = ANY(p_claves);

  -- Purga oportunista: los buckets que no se tocan hace un día ya no cuentan
  -- para ninguna ventana. Se hace en el camino del login EXITOSO (el menos
  -- frecuente y el que no está bajo ataque) para que la tabla no crezca sola,
  -- sin agregar otro job de cron.
  DELETE FROM intentos_login WHERE ultimo_intento_at < now() - INTERVAL '1 day';
END $$;

COMMENT ON FUNCTION public.limpiar_intentos_login(TEXT[]) IS
  'Borra los buckets indicados tras un login exitoso y purga los vencidos hace más de un día.';

-- Igual que el resto de las RPC sensibles (ver 20260710000001): solo la Edge
-- Function con service_role puede invocarlas. Si `authenticated` pudiera
-- llamarlas, cualquiera podría limpiar su propio bloqueo.
REVOKE ALL ON FUNCTION public.registrar_intento_login(TEXT[], INT[], INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpiar_intentos_login(TEXT[])           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_intento_login(TEXT[], INT[], INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_intentos_login(TEXT[])           TO service_role;
