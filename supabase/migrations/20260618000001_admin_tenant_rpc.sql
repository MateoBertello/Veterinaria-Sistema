-- =====================================================================
-- MIGRACIÓN 006: Super Admin — alta atómica de tenant
-- Caso de uso "Crear/Gestionar Tenant" (Addendum §7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estado de invitación del Admin (RN-SA2).
-- El alta del tenant + su estructura es atómica; la invitación del Admin
-- es un paso POSTERIOR idempotente y reintentable. Esta columna marca si
-- esa invitación ya fue cursada con éxito. Un tenant con admin_invitado=false
-- está "pendiente de invitar admin" y se puede reintentar sin borrar nada.
-- ---------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS admin_invitado BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- RPC crear_tenant — alta transaccional (RN-SA2)
-- Inserta el tenant y aprovisiona su estructura (on_tenant_created) en una
-- ÚNICA transacción. Si on_tenant_created falla, el INSERT del tenant se
-- revierte automáticamente (toda la función es una sola transacción).
-- La invitación del Admin NO va aquí: es un paso posterior reintentable.
--
-- SECURITY DEFINER: la consola Super Admin opera vía service role (bypass
-- RLS), pero la función se declara DEFINER para garantizar permisos sobre
-- las tablas de plataforma y de tenant de forma uniforme.
--
-- La unicidad de cuit_rut la garantiza el UNIQUE de la tabla: una violación
-- (SQLSTATE 23505) se propaga al caller, que la mapea a TENANT_DUPLICATE_TAXID.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tenant(
  p_nombre          TEXT,
  p_cuit_rut        TEXT,
  p_email_contacto  TEXT,
  p_plan            plan_tenant
)
RETURNS tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant tenants;
BEGIN
  INSERT INTO tenants (nombre, cuit_rut, email_contacto, plan)
  VALUES (p_nombre, p_cuit_rut, p_email_contacto, p_plan)
  RETURNING * INTO v_tenant;

  -- Aprovisionamiento Nivel 2 (roles, permisos, configuración, módulos).
  PERFORM public.on_tenant_created(v_tenant.id);

  RETURN v_tenant;
END;
$$;
