# TODO — Deuda técnica

Pendientes conocidos que no se abordan en la etapa donde se detectaron. Cada ítem indica origen, fix recomendado y cuándo se detectó.

| # | Origen | Descripción | Fix recomendado | Detectada en |
| :---- | :---- | :---- | :---- | :---- |
| DT-1 | Etapa 2 — `usuarios.service.ts` (RN-SEC5) | Al asignar/cambiar el rol a `veterinario`, tanto `crear` como `editar` hacen **`INSERT`** en `doctores` (no `UPSERT`): editar un usuario que ya tiene perfil profesional genera **doctores duplicados**. Además el alta no setea `specialty` por defecto pese a que RN-SEC5 lo pide ("especialidad por defecto"). | Agregar `UNIQUE(tenant_id, user_id)` en `doctores` (**requiere migración nueva**) y convertir el `INSERT` en `UPSERT`/`onConflict`; setear `specialty` por defecto en el alta. | Etapa 4 (al construir el ABM de Doctores). |


DT: enchufar envío real de resumen de historial (RN-EC9) — infra lista en 6c, TODO marcado en historial.service.ts