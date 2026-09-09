-- @modulo: comercial
-- =====================================================================
-- CORRECCIÓN 1.5 (auditoría final del Módulo Comercial)
-- FKs compuestas (usuario_id, tenant_id) en las tablas comerciales
-- =====================================================================
--
-- QUÉ ESTABA MAL
--
-- Las tablas comerciales resolvieron con FK COMPUESTA todas sus referencias
-- —producto, lote, proveedor, cliente, sesión de caja, mascota, historial— pero
-- las que apuntan a `usuarios` quedaron simples: `REFERENCES usuarios(id)`, sin
-- el tenant en la clave. Es exactamente el agujero que describe el CLAUDE.md
-- ("Un id que llega en el body o en la URL no está validado por venir de una
-- FK"): un `usuario_id` de OTRA clínica entra sin que la base diga nada, y queda
-- firmando un movimiento del libro mayor, una venta o una sesión de caja.
--
-- No es teórico: `movimientos_stock.profesional_prescriptor_id` lo escribe
-- `registrar_consumo_clinico` directamente desde el parámetro del RPC, sin
-- ninguna FK y sin ninguna verificación de tenant en el Service.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
--   1. `UNIQUE (id, tenant_id)` en `usuarios` — el lado referenciado necesita
--      esa constraint para que la FK compuesta pueda apoyarse en ella. El par
--      ya es único por construcción (`id` es PK); la constraint solo lo declara.
--   2. Cambia las 11 FKs simples por compuestas, con el MISMO `ON DELETE` que
--      tenían (`RESTRICT`), así que ninguna semántica de borrado cambia.
--   3. Le pone FK compuesta a las dos columnas de prescriptor que no tenían
--      ninguna. Son las que la spec dejó "reservadas, sin FK hasta que exista la
--      tabla" (D-14) — pero la tabla que referencian de hecho HOY es `usuarios`,
--      y `registrar_consumo_clinico` ya escribe una de ellas.
--
-- Ver §6.11 RN-SC2 de ADENDA_SPEC_COMERCIAL.md.

-- ─── 1. La UNIQUE que respalda las FKs compuestas ────────────────────────────

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_id_tenant_key UNIQUE (id, tenant_id);

-- ─── 2. Las 11 columnas que ya tenían FK simple ──────────────────────────────

-- lotes.usuario_id — quién dio de alta el lote
ALTER TABLE public.lotes DROP CONSTRAINT IF EXISTS lotes_usuario_id_fkey;
ALTER TABLE public.lotes
  ADD CONSTRAINT lotes_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- movimientos_stock.usuario_id — quién firma el asiento del libro mayor
ALTER TABLE public.movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_usuario_id_fkey;
ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT movimientos_stock_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- compras.usuario_id
ALTER TABLE public.compras DROP CONSTRAINT IF EXISTS compras_usuario_id_fkey;
ALTER TABLE public.compras
  ADD CONSTRAINT compras_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- sesiones_caja.apertura_usuario_id
ALTER TABLE public.sesiones_caja DROP CONSTRAINT IF EXISTS sesiones_caja_apertura_usuario_id_fkey;
ALTER TABLE public.sesiones_caja
  ADD CONSTRAINT sesiones_caja_apertura_usuario_tenant_fkey
  FOREIGN KEY (apertura_usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- sesiones_caja.cierre_usuario_id (nullable: MATCH SIMPLE la da por satisfecha si es NULL)
ALTER TABLE public.sesiones_caja DROP CONSTRAINT IF EXISTS sesiones_caja_cierre_usuario_id_fkey;
ALTER TABLE public.sesiones_caja
  ADD CONSTRAINT sesiones_caja_cierre_usuario_tenant_fkey
  FOREIGN KEY (cierre_usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- movimientos_caja.usuario_id
ALTER TABLE public.movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_usuario_id_fkey;
ALTER TABLE public.movimientos_caja
  ADD CONSTRAINT movimientos_caja_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- ventas.usuario_id — quién registró la venta
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_usuario_id_fkey;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- ventas.anulada_por_usuario_id (nullable)
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_anulada_por_usuario_id_fkey;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_anulada_por_usuario_tenant_fkey
  FOREIGN KEY (anulada_por_usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- recuentos.usuario_id
ALTER TABLE public.recuentos DROP CONSTRAINT IF EXISTS recuentos_usuario_id_fkey;
ALTER TABLE public.recuentos
  ADD CONSTRAINT recuentos_usuario_tenant_fkey
  FOREIGN KEY (usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- recuentos.aplicado_por_usuario_id (nullable)
-- El nombre no es libre: `ajustes.service.ts` ya embebe por
-- `usuarios!recuentos_aplicador_tenant_fkey`, un hint que apuntaba a una
-- constraint que NO EXISTÍA (por eso /recuentos daba 500 — hallazgo 2.1 de la
-- auditoría). Se crea con el nombre que el Service ya usa. Ídem
-- `recuentos_usuario_tenant_fkey`, arriba.
ALTER TABLE public.recuentos DROP CONSTRAINT IF EXISTS recuentos_aplicado_por_usuario_id_fkey;
ALTER TABLE public.recuentos
  ADD CONSTRAINT recuentos_aplicador_tenant_fkey
  FOREIGN KEY (aplicado_por_usuario_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- movimientos_stock.profesional_prescriptor_id — la 11ª.
-- Es la ÚNICA de las once que no tenía FK de ningún tipo, y la única que un RPC
-- escribe con un id que llega crudo desde el request (`registrar_consumo_clinico`,
-- parámetro `p_profesional_prescriptor_id`). D-14 la dejó "reservada, sin FK
-- hasta que exista la tabla" pensando en una tabla de recetas futura; el
-- prescriptor, en cambio, es un usuario de la clínica y ya se está escribiendo.
ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT movimientos_stock_prescriptor_tenant_fkey
  FOREIGN KEY (profesional_prescriptor_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- ─── 3. La 12ª: ventas_items.profesional_prescriptor_id ──────────────────────
--
-- No estaba en la lista de 11 de la auditoría porque hoy no la escribe nadie —
-- justamente por eso conviene ponerle la FK ahora y no el día que alguien la
-- empiece a escribir sin acordarse. Misma columna, misma tabla destino, mismo
-- agujero.
ALTER TABLE public.ventas_items
  ADD CONSTRAINT ventas_items_prescriptor_tenant_fkey
  FOREIGN KEY (profesional_prescriptor_id, tenant_id) REFERENCES usuarios(id, tenant_id) ON DELETE RESTRICT;

-- ─── 4. Índices de respaldo ──────────────────────────────────────────────────
--
-- Las FKs nuevas se apoyan en el índice de `usuarios(id, tenant_id)` del lado
-- referenciado. Del lado referenciante, las columnas que ya tenían índice por
-- (tenant_id, usuario_id) no necesitan nada; las dos de prescriptor no tenían y
-- se agregan parciales, que es como está indexado el resto de las columnas
-- nullable del libro mayor.
CREATE INDEX idx_mov_prescriptor ON movimientos_stock (tenant_id, profesional_prescriptor_id)
  WHERE profesional_prescriptor_id IS NOT NULL;
CREATE INDEX idx_ventas_items_prescriptor ON ventas_items (tenant_id, profesional_prescriptor_id)
  WHERE profesional_prescriptor_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
