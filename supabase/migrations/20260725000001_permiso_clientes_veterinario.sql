-- =====================================================================
-- MIGRACIÓN: el rol Veterinario recupera manage_clients
-- =====================================================================
-- El Documento Maestro pone al Veterinario como actor del caso de uso de
-- clientes ("Recepcionista / Administrador / Veterinario — permiso
-- manage_clients") y el ejemplo de perfil de un veterinario lo incluye entre
-- sus permisos. El seeder de Nivel 2 (on_tenant_created) nunca se lo otorgó,
-- así que en toda clínica el veterinario recibía 403 al consultar clientes —
-- no podía ni ver la ficha del dueño del paciente que estaba atendiendo.
--
-- No existe un permiso de solo lectura para clientes: `/clientes` entero
-- (incluido el GET) cuelga de manage_clients, así que otorgarlo es lo que
-- habilita la consulta.
--
-- Dos partes: (1) el seeder para los tenants NUEVOS, (2) el otorgamiento a los
-- tenants YA creados. Ambas idempotentes.
-- =====================================================================

-- ── 1. Seeder de Nivel 2 (tenants nuevos) ────────────────────────────────
-- Igual a 20260614000005_on_tenant_created.sql salvo el permiso agregado al
-- rol veterinario. CREATE OR REPLACE conserva el ACL acotado por la migración
-- 20260710000001 (REVOKE de PUBLIC + GRANT a service_role).
CREATE OR REPLACE FUNCTION public.on_tenant_created(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol_admin UUID;
  v_rol_vet   UUID;
  v_rol_recep UUID;
  v_plan      plan_tenant;
BEGIN
  -- 1. Crear los tres roles del sistema
  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'admin', 'Administrador', 'Acceso total a la clínica', true)
  RETURNING id INTO v_rol_admin;

  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'veterinario', 'Veterinario', 'Gestión clínica y de pacientes', true)
  RETURNING id INTO v_rol_vet;

  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'recepcionista', 'Recepcionista', 'Gestión de clientes, turnos y guardería', true)
  RETURNING id INTO v_rol_recep;

  -- 2. Admin: todos los permisos del sistema
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_admin, p.id FROM permisos p;

  -- 3. Veterinario: permisos clínicos, de agenda y de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_vet, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_medical_history',
    'manage_appointments',
    'manage_schedules'
  );

  -- 4. Recepcionista: permisos de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_recep, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_appointments',
    'manage_daycare'
  );

  -- 5. Configuración default del tenant (cupo 10, aviso 7 días)
  INSERT INTO configuracion_tenant (tenant_id, cupo_maximo_diario, dias_aviso_vacuna)
  VALUES (p_tenant_id, 10, 7);

  -- 6. Módulos según plan
  SELECT plan INTO v_plan FROM tenants WHERE id = p_tenant_id;

  INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta) VALUES
    (p_tenant_id, 'historial_clinico',
      true,
      CURRENT_DATE),
    (p_tenant_id, 'turnos',
      v_plan IN ('profesional', 'premium'),
      CASE WHEN v_plan IN ('profesional', 'premium') THEN CURRENT_DATE END),
    (p_tenant_id, 'guarderia',
      v_plan = 'premium',
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END);
END;
$$;

-- ── 2. Tenants ya existentes ─────────────────────────────────────────────
-- Otorga manage_clients a todo rol 'veterinario' que aún no lo tenga.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.name = 'veterinario'
  AND p.name = 'manage_clients'
ON CONFLICT DO NOTHING;
