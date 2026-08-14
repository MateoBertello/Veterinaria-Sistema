-- =====================================================================
-- MIGRACIÓN: identidad de login insensible a mayúsculas/minúsculas
-- =====================================================================
-- SÍNTOMA que corrige: un usuario dado de alta como `Juanpa` no podía
-- iniciar sesión escribiendo `juanpa`. El login resuelve el usuario con
-- `WHERE username = $1` (igualdad de TEXT en Postgres: case-sensitive), así
-- que devolvía 0 filas y respondía el 401 genérico de RN-AUT1 — el mismo que
-- para una contraseña mal puesta, con lo cual el usuario culpaba a la
-- contraseña. Copiar y pegar el username exacto funcionaba; tipearlo no.
--
-- Un nombre de usuario NO es un identificador case-sensitive en ningún
-- sistema razonable, y tampoco lo es un email (GoTrue ya los normaliza a
-- minúscula). Se normaliza en la BASE, no en el Service, para que la
-- UNICIDAD también sea insensible: sin esto, un tenant podría tener a la vez
-- `juanpa` y `Juanpa` y el login sería ambiguo por diseño.
--
-- Se usan columnas generadas (no triggers): Postgres las mantiene siempre
-- consistentes con la columna base y son indexables.
-- =====================================================================

-- ── Guarda previa ────────────────────────────────────────────────────────
-- Si el entorno YA tiene colisiones (p. ej. `juanpa` y `Juanpa` en el mismo
-- tenant), los índices únicos de abajo fallarían con un mensaje críptico de
-- índice duplicado. Se aborta antes, diciendo exactamente qué filas arreglar.
DO $$
DECLARE
  colisiones TEXT;
BEGIN
  SELECT string_agg(format('tenant=%s username=%s (%s filas)', tenant_id, lower_username, n), '; ')
    INTO colisiones
  FROM (
    SELECT tenant_id, lower(username) AS lower_username, count(*) AS n
    FROM usuarios
    GROUP BY tenant_id, lower(username)
    HAVING count(*) > 1
  ) c;

  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede aplicar la unicidad case-insensitive de username: hay colisiones que resolver a mano → %',
      colisiones;
  END IF;

  SELECT string_agg(format('tenant=%s email=%s (%s filas)', tenant_id, lower_email, n), '; ')
    INTO colisiones
  FROM (
    SELECT tenant_id, lower(email) AS lower_email, count(*) AS n
    FROM usuarios
    GROUP BY tenant_id, lower(email)
    HAVING count(*) > 1
  ) c;

  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede aplicar la unicidad case-insensitive de email: hay colisiones que resolver a mano → %',
      colisiones;
  END IF;
END $$;

-- ── Columnas normalizadas ────────────────────────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN username_ci TEXT GENERATED ALWAYS AS (lower(username)) STORED,
  ADD COLUMN email_ci    TEXT GENERATED ALWAYS AS (lower(email))    STORED;

COMMENT ON COLUMN usuarios.username_ci IS
  'Username normalizado a minúscula. Lo usa el login (case-insensitive) y la unicidad por tenant. Generada: no escribir.';
COMMENT ON COLUMN usuarios.email_ci IS
  'Email normalizado a minúscula. Idem username_ci. Generada: no escribir.';

-- ── Unicidad por tenant, ahora insensible ────────────────────────────────
CREATE UNIQUE INDEX ux_usuarios_tenant_username_ci ON usuarios (tenant_id, username_ci);
CREATE UNIQUE INDEX ux_usuarios_tenant_email_ci    ON usuarios (tenant_id, email_ci);

-- Las UNIQUE case-sensitive quedan redundantes: las nuevas son estrictamente
-- más fuertes (todo lo que rechazaban aquéllas lo rechazan éstas).
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tenant_id_username_key;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tenant_id_email_key;

-- ── Índices del acceso real del login ────────────────────────────────────
-- El login resuelve el identificador ANTES de que exista un JWT, o sea SIN
-- tenant_id: el índice compuesto (tenant_id, username_ci) no sirve para ese
-- acceso porque tenant_id no es el prefijo del filtro. Sin estos índices cada
-- intento de login es un seq scan sobre los usuarios de TODOS los tenants.
CREATE INDEX idx_usuarios_username_ci ON usuarios (username_ci);
CREATE INDEX idx_usuarios_email_ci    ON usuarios (email_ci);
