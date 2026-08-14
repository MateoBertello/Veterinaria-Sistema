-- =====================================================================
-- MIGRACIÓN: el rol `authenticated` deja de poder escribir, y leer de más
-- =====================================================================
-- PROBLEMA (hallazgo crítico de seguridad):
--
-- `20260622000001_grants_supabase_roles.sql` otorgó SELECT+INSERT+UPDATE+DELETE
-- sobre TODAS las tablas a `anon`, `authenticated` y `service_role`, con la
-- deuda anotada de acotarlo antes de producción. `20260706000001` cerró `anon`,
-- pero `authenticated` quedó igual. Sumado a políticas RLS `FOR ALL` cuya única
-- condición era el tenant, cualquier usuario logueado podía saltearse la Edge
-- Function y operar directo contra PostgREST con su propio token válido:
--
--   PATCH /rest/v1/usuarios?id=eq.<uno mismo>  {"rol_id": <rol admin>}
--   POST  /rest/v1/rol_permiso                 (auto-asignarse permisos)
--   DELETE /rest/v1/registros_auditoria?...    (borrar la auditoría, RN-S3)
--   PATCH /rest/v1/mascotas?id=eq.X            {"estado":"Activa"}  (revertir
--                                               una eutanasia — regla 8)
--   GET   /rest/v1/historial_clinico           (sin view_medical_history ni
--                                               módulo licenciado)
--
-- El vector es alcanzable desde el navegador: el proxy `/rest/v1` del deploy
-- reenvía cualquier tabla y cualquier método con la apikey inyectada.
--
-- SOLUCIÓN (dos candados independientes):
--
--   1. PRIVILEGIOS: `authenticated` conserva SELECT y pierde INSERT/UPDATE/
--      DELETE. Toda escritura pasa por la Edge Function con `service_role`,
--      que es donde viven las reglas de negocio, los permisos y la auditoría.
--      Verificado antes de aplicar: NINGÚN service escribe con el cliente de
--      usuario — `getDb()` solo se usa para leer (middlewares, /auth/me,
--      módulos y dashboard).
--
--   2. RLS: las políticas `FOR ALL` se reemplazan por políticas de SOLO
--      LECTURA que además exigen (a) que el usuario esté ACTIVO y (b) el mismo
--      permiso que exigiría el endpoint dueño del dato. Sin (a), desactivar a
--      alguien no le sacaba la lectura mientras su token siguiera vivo. Sin
--      (b), la lectura por PostgREST ignoraba RN-S2.
--
-- Los catálogos globales (especies, razas, tipos_vacuna) NO se tocan: el
-- frontend los lee por PostgREST directo, por diseño (excepción documentada en
-- CLAUDE.md), y ya eran de solo lectura para `authenticated`.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. PRIVILEGIOS: authenticated queda de solo lectura
-- ─────────────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Las tablas que se creen a futuro tampoco heredan permisos de escritura.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM authenticated;

-- Las secuencias solo importan para INSERT; sin INSERT no hacen falta.
REVOKE USAGE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE ON SEQUENCES FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. HELPERS DE POLÍTICA
-- ─────────────────────────────────────────────────────────────────────

/**
 * ¿El usuario del JWT es un usuario ACTIVO de este tenant?
 *
 * SECURITY DEFINER (dueño: postgres) a propósito: al correr como dueño de la
 * tabla, la lectura de `usuarios` no vuelve a evaluar las políticas de
 * `usuarios`, que es justamente lo que evita la recursión infinita cuando esta
 * función se usa DENTRO de la política de esa misma tabla.
 */
CREATE OR REPLACE FUNCTION public.usuario_activo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM usuarios u
    WHERE u.id = auth.uid()
      AND u.active
      AND u.tenant_id = current_tenant_id()
  )
$$;

COMMENT ON FUNCTION public.usuario_activo() IS
  'true si el JWT corresponde a un usuario activo del tenant del propio token. Usada por las políticas RLS.';

/**
 * ¿El rol del usuario del JWT tiene el permiso pedido? (RN-S2 a nivel base)
 *
 * Es el mismo cálculo que hace el middleware `requirePermission`, pero aplicado
 * por la base: así el permiso vale también para quien consulta PostgREST
 * directamente, sin pasar por la Edge Function.
 */
CREATE OR REPLACE FUNCTION public.tiene_permiso(p_permiso TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM usuarios u
    JOIN rol_permiso rp ON rp.rol_id = u.rol_id
    JOIN permisos    p  ON p.id      = rp.permiso_id
    WHERE u.id = auth.uid()
      AND u.active
      AND u.tenant_id = current_tenant_id()
      AND p.name = p_permiso
  )
$$;

COMMENT ON FUNCTION public.tiene_permiso(TEXT) IS
  'true si el rol del usuario del JWT tiene el permiso indicado. Espejo en SQL de requirePermission (RN-S2).';

-- Ambas las evalúan las políticas con los privilegios de quien consulta, así
-- que `authenticated` necesita EXECUTE. No filtran nada: solo responden sobre
-- el propio usuario del token.
REVOKE ALL ON FUNCTION public.usuario_activo()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tiene_permiso(TEXT)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_activo()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tiene_permiso(TEXT)  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3. POLÍTICAS: de `FOR ALL` a solo lectura, con usuario activo
-- ─────────────────────────────────────────────────────────────────────
-- Tablas SIN gate de permiso: o bien son las que resuelven la identidad y los
-- permisos (gatearlas por permiso sería circular), o su lectura la necesitan
-- varios roles a la vez y el permiso único no las representa (doctores y
-- horarios los consultan quien agenda, quien arma horarios y quien atiende;
-- servicios y configuración son transversales).

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuracion_tenant', 'roles', 'usuarios', 'doctores', 'horarios_doctor',
    'servicios', 'notificaciones'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_%s_tenant_isolation ON %I;', t, t);
    EXECUTE format(
      'CREATE POLICY p_%s_lectura ON %I FOR SELECT
         USING (tenant_id = current_tenant_id() AND usuario_activo());',
      t, t
    );
  END LOOP;
END $$;

-- Tablas CON gate de permiso: el mismo permiso que pide el endpoint dueño del
-- dato (idéntico al mapa que usa el dashboard para decidir qué métrica mostrar).
DO $$
DECLARE
  reg RECORD;
BEGIN
  FOR reg IN
    SELECT * FROM (VALUES
      ('clientes',            'manage_clients'),
      ('mascotas',            'manage_pets'),
      ('cambios_propietario', 'manage_pets'),
      ('historial_clinico',   'view_medical_history'),
      ('adjuntos_medicos',    'view_medical_history'),
      ('plan_vacunacion',     'view_medical_history'),
      ('turnos',              'manage_appointments'),
      ('estadias',            'manage_daycare'),
      ('registros_auditoria', 'view_audit')
    ) AS v(tabla, permiso)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_%s_tenant_isolation ON %I;', reg.tabla, reg.tabla);
    EXECUTE format(
      'CREATE POLICY p_%s_lectura ON %I FOR SELECT
         USING (tenant_id = current_tenant_id() AND usuario_activo() AND tiene_permiso(%L));',
      reg.tabla, reg.tabla, reg.permiso
    );
  END LOOP;
END $$;

-- `rol_permiso` no tiene tenant_id propio: se valida por pertenencia del rol.
-- Queda de solo lectura, igual que el resto.
DROP POLICY IF EXISTS p_rol_permiso_tenant ON rol_permiso;
CREATE POLICY p_rol_permiso_lectura ON rol_permiso FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = rol_id
        AND r.tenant_id = current_tenant_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. NOTA SOBRE LAS ESCRITURAS
-- ─────────────────────────────────────────────────────────────────────
-- Ninguna tabla de negocio conserva política de INSERT/UPDATE/DELETE. No es un
-- olvido: las escrituras entran por la Edge Function con `service_role` (que
-- tiene BYPASSRLS) o por las RPC `SECURITY DEFINER`, cuyo dueño es `postgres` y
-- por lo tanto tampoco evalúan estas políticas. Así, si alguien volviera a
-- otorgarle INSERT a `authenticated` por error, RLS lo seguiría frenando.
