# 0a — Verificación del tenant de prueba
> **Sin código.** Ya no es un paso manual de consola: el licenciamiento lo resuelve el seed.
> Esta tanda solo **comprueba** que el entorno quedó bien antes de arrancar F1.
> **Precondición:** B0 mergeada (B0.3 y B0.4 son los que dejan el licenciamiento fijado por
> un test) y `npm run seed` corrido.

## Por qué ya no hay nada que habilitar a mano

Los endpoints comerciales pasan por `requireModule("stock")` o `requireModule("ventas")`. Si
el tenant no los tiene contratados, todo devuelve `403 MODULE_NOT_LICENSED` y desde el
frontend se ve como un bug de la pantalla. Eso ya está resuelto por tres caminos que se
refuerzan:

1. **`crear_tenant` los inserta por plan.** En
   `supabase/migrations/20260901000002_comercial_permisos_licenciamiento.sql`, paso 6:
   `stock` queda habilitado para los planes `profesional` y `premium`, y `ventas` **solo para
   `premium`**. El paso 4 de esa misma migración hace el backfill de los tenants que ya
   existían antes.
2. **El seed crea el tenant como `premium`.** `scripts/seed.mjs` → `const TENANT = { ...,
   plan: "premium" }`, así que los cinco módulos vendibles quedan habilitados solos.
3. **B0.3 y B0.4 lo apoyan en su fixture**, que es lo que lo deja sostenido por un test en
   lugar de por una convención que alguien puede romper sin enterarse.

## La verificación

```
1. Entrar con un usuario del tenant de prueba (login normal, NO /admin/login).
2. GET /api/v1/productos    → 200
3. GET /api/v1/caja/cajas   → 200
4. El sidebar muestra "Stock" y "Ventas" bajo *Módulos contratados*.
```

## Cómo leer un resultado que no sea 200

| Síntoma | Qué significa | Dónde se arregla |
|---|---|---|
| `GET /productos` → **403 `MODULE_NOT_LICENSED`** | Falta `stock`. | El plan del tenant es `basico`. Es el seed o el plan, no el frontend. |
| `GET /productos` → 200 pero `GET /caja/cajas` → **403** | Falta `ventas`. **Son dos módulos distintos** y el mostrador necesita los dos. | El plan es `profesional`, no `premium`. |
| Los dos 200 pero el sidebar no los muestra | Problema de `buildNavItems` o de `GET /modulos-habilitados`. | Ahí sí es frontend, pero **no en esta tanda**: reportalo. |
| **403 en todo, incluso fuera de lo comercial** | El tenant está suspendido (`requireActiveTenant`). | Consola Super Admin. |

## Lo que NO hay que hacer

- **No** habilitar módulos a mano por la consola para "destrabar". Si hace falta, es que el
  seed o el plan están mal, y taparlo a mano hace que el próximo entorno vuelva a fallar.
- **No** habilitar módulos escribiendo en `modulos_contratados` por SQL. El camino auditado
  es `PUT /api/v1/admin/tenants/:id/modulos/:modulo`, y aun así no debería hacer falta.
- **No** tocar `web/src/lib/navigation.ts` ni `web/src/lib/planes.ts`: los dos ya conocen
  `stock` y `ventas`, y `buildNavItems` ya oculta el módulo no contratado (RN-G2).
- **No** agregar un modo "módulo con candado". RN-G2 dice ocultar, no deshabilitar.

## Definición de terminado

Los cuatro puntos de la verificación dan lo esperado. **No hay commit en esta tanda.**
