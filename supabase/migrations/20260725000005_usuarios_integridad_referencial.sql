-- =====================================================================
-- MIGRACIÓN: integridad referencial de `usuarios`
-- =====================================================================
-- `usuarios` es el espejo de `auth.users` (mismo `id`, sin password propia),
-- pero nada lo ataba a nivel base. Dos agujeros concretos:
--
--   1. `id UUID PRIMARY KEY` sin FK a `auth.users`. Si alguien borraba la
--      cuenta desde el panel de Authentication, la fila espejo quedaba
--      huérfana ocupando el username y el email del tenant, y esa identidad
--      ya no podía volver a darse de alta. Es también la razón por la que el
--      alta hace "rollback a mano" (`deleteUser`) cuando el INSERT falla.
--
--   2. `rol_id` referenciaba `roles(id)` a secas, sin exigir que el rol fuera
--      DEL MISMO TENANT. Un roleId de otra clínica entraba sin error y dejaba
--      un usuario roto: al resolver permisos, RLS no le deja ver ese rol y se
--      queda sin ninguno (con lo cual ni siquiera podía loguear). El Service
--      ya valida el tenant del rol, pero la regla pertenece a la base — es
--      justamente lo que una FK compuesta expresa.
-- =====================================================================

-- ─── Guardas previas ─────────────────────────────────────────────────────
DO $$
DECLARE
  huerfanos   INT;
  cruzados    TEXT;
BEGIN
  SELECT count(*) INTO huerfanos
  FROM usuarios u
  WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id);

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Hay % fila(s) en `usuarios` sin su cuenta en auth.users. Resolvelas antes (borrarlas o recrear la cuenta): SELECT id, tenant_id, username FROM usuarios u WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id);',
      huerfanos;
  END IF;

  SELECT string_agg(format('usuario=%s rol=%s', u.username, u.rol_id), '; ')
    INTO cruzados
  FROM usuarios u
  JOIN roles r ON r.id = u.rol_id
  WHERE r.tenant_id <> u.tenant_id;

  IF cruzados IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay usuarios con un rol de OTRO tenant; corregí el rol antes de aplicar la FK compuesta → %',
      cruzados;
  END IF;
END $$;

-- ─── 1. El espejo sigue la vida de la cuenta de Auth ──────────────────────
-- ON DELETE CASCADE: si la cuenta se borra en Auth, la fila espejo se va con
-- ella en vez de quedar huérfana bloqueando el username.
--
-- Ojo con el efecto en cadena, que es DESEADO: si el usuario firmó historia
-- clínica, `historial_clinico_professional_id_fkey` frena el borrado entero y
-- la cuenta de Auth no se puede eliminar. Es lo correcto —un registro clínico
-- no puede quedarse sin autor— y la vía para dar de baja a alguien no es
-- borrarlo sino DESACTIVARLO (que además ahora lo banea en Auth). La auditoría
-- no se ve afectada: `registros_auditoria.user_id` no tiene FK y conserva
-- copia del nombre y el rol.
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_id_auth_users_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─── 2. El rol tiene que ser del mismo tenant ─────────────────────────────
-- La FK compuesta necesita una UNIQUE que la respalde en el lado referenciado.
-- `roles.id` ya es PK; el par (id, tenant_id) es único por construcción.
ALTER TABLE roles
  ADD CONSTRAINT roles_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_id_fkey;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_tenant_fkey
  FOREIGN KEY (rol_id, tenant_id) REFERENCES roles(id, tenant_id) ON DELETE RESTRICT;

-- ─── 3. Índice del lado de la FK ──────────────────────────────────────────
-- `rol_id` se usa para contar administradores activos (RN-SEC6) y lo recorre
-- toda resolución de permisos. Sin índice, cada verificación es un scan.
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol_id);
