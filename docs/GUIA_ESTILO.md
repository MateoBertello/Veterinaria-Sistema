# Referencia UI — Reconciliada con v1.1 \+ backend construido

⚠️ **Referencia ESTÉTICA y de LAYOUT, no contrato.**

## 0\. Patrones globales (sin cambios estéticos)

Se mantiene todo lo del prototipo: header de página (h1 \+ ícono lucide \+ `text-orange-800` \+ descripción), botones de export Excel (outline verde) / PDF (sólido naranja), cards con `CardHeader` degradado `from-orange-50 to-white`, tabs con `bg-orange-50`, tablas con header `bg-orange-50` y ocultamiento progresivo de columnas (`hidden md/lg/xl:table-cell`), `AlertDialog` para destructivo / `Dialog` para forms cortos, estados vacíos e iconografía.

**Semántica de badges:**

| Color | Significado |
| :---- | :---- |
| Naranja | Marca/primario, acción principal, clínica |
| Verde | Éxito, confirmado, activo, completado |
| Azul | Informativo, email |
| Rojo | Destructivo, cancelado, vencido, emergencia |
| Ámbar/Amarillo | Advertencia, pendiente, próximo a vencer |
| Gris | Neutral, inactivo, "Fallecida", deshabilitado |
| Púrpura | Categoría secundaria / eventos especiales |

### Cambios vs prototipo

- **Púrpura**: era "peluquería"; con el rol Peluquero eliminado del sistema, queda solo como "categoría secundaria / eventos especiales".  
- **Gris**: el ejemplo "Baja" se reemplaza por "Fallecida" (valor real del ENUM `estado_mascota`).

## 1\. Tokens del sistema visual (superficie de marca, acentos y elevación)

Estos tokens viven en `web/src/components/styles/theme.css` y son la **única**
fuente de los degradados, acentos, superficies suaves y sombras del sistema. La
regla operativa: si un valor de color, radio, sombra o espaciado aparece dos
veces, deja de estar en el componente y pasa a ser un token. Ningún componente
escribe un literal de color de marca.

En Tailwind v4 el valor crudo se declara en `:root` y se mapea en `@theme inline`
para que existan las utilidades. El degradado es la excepción deliberada: no se
mapea a una utilidad, se referencia como `bg-[image:var(--brand-gradient)]`, para
que el valor siga viviendo en un solo lugar.

### 1.1 Superficie de marca

| Token | Valor | Para qué |
| :---- | :---- | :---- |
| `--brand-gradient-from` | `#c2410c` (orange-700) | Parada clara del degradado |
| `--brand-gradient-to` | `#9a3412` (orange-800) | Parada oscura |
| `--brand-gradient` | `linear-gradient(105deg, …)` | Fondo de la tarjeta de bienvenida |
| `--brand-on-gradient` | `#ffffff` | Título sobre el degradado |
| `--brand-on-gradient-muted` | `#ffedd5` (orange-100) | Bajada sobre el degradado |
| `--brand-chip-surface` | `rgb(0 0 0 / 0.20)` | Superficie de los chips sobre el degradado |
| `--brand-chip-border` | `rgb(255 255 255 / 0.28)` | Borde de esos chips |

**Por qué el degradado NO arranca en `#f97316`.** El naranja de identidad sigue
siendo `#f97316` y no cambia: es el logo, la iconografía y los tints
(`orange-50/100` con texto oscuro). Pero **no puede ser fondo de texto blanco**.
Medido: blanco sobre `#f97316` da **2.80:1**, muy por debajo del 4.5:1 que pide
WCAG 2.1 SC 1.4.3. Es el mismo criterio que ya había fijado `--primary` en
`theme.css` para los controles sólidos.

**Por qué los chips van sobre velo NEGRO y no blanco.** Un velo blanco (el
`bg-white/20` del patrón anterior) *aclara* el fondo y hunde el contraste del
texto blanco. Medido sobre el degradado nuevo: `white/20` → 3.73:1 (falla),
`black/20` → 7.27:1 (pasa).

### 1.2 Mediciones de contraste

El contraste se **mide**, no se estima: para un degradado hay que muestrearlo
punto a punto (el peor punto no es necesariamente una parada declarada) y para un
chip translúcido hay que componer el alpha sobre el fondo real antes de medir.

| Combinación | Contraste | Umbral |
| :---- | :---- | :---- |
| Blanco sobre el degradado de marca (peor punto) | **5.18:1** | 4.5:1 texto |
| Bajada `#ffedd5` sobre el degradado (peor punto) | **4.52:1** | 4.5:1 texto |
| Blanco sobre chip `black/20` (peor punto) | **7.27:1** | 4.5:1 texto |
| Tinta de icono sobre su superficie suave (la peor de las 5) | **6.37:1** | 4.5:1 |
| Línea de acento sobre card blanca (la peor de las 5) | **5.02:1** | 3:1 no-texto (SC 1.4.11) |

Referencia de lo que se reemplazó, para que no vuelva: el header anterior
(`from-orange-500 to-orange-600`) daba 2.80:1 con el título blanco, 2.64:1 con la
bajada `text-orange-50` y 2.31:1 con el badge de rol sobre `bg-white/20`. Los tres
fallaban.

### 1.3 Acentos de métrica

Cinco acentos, uno por tarjeta. Cada uno tiene tres piezas: la línea del borde
izquierdo, la superficie del chip del icono y la tinta del icono. El reparto
respeta la semántica de badges de §0.

| Acento | Línea | Superficie | Tinta | Semántica (§0) |
| :---- | :---- | :---- | :---- | :---- |
| `marca` | `#c2410c` | `#ffedd5` | `#9a3412` | Marca / clínica |
| `ambar` | `#b45309` | `#fef3c7` | `#92400e` | Advertencia / seguimiento |
| `info` | `#1d4ed8` | `#dbeafe` | `#1e40af` | Informativo |
| `exito` | `#047857` | `#d1fae5` | `#065f46` | Confirmado / ocupado |
| `especial` | `#6d28d9` | `#ede9fe` | `#5b21b6` | Categoría secundaria |

Quien agrega una métrica elige una **clave** de esta lista (`MetricaAccent` en
`web/src/components/dashboard/MetricaCard.tsx`), no un color.

**El color no porta significado por sí solo.** La línea y el chip son decoración:
qué mide la tarjeta lo dicen la etiqueta, el número y el icono. Un usuario que no
distinga los tonos no pierde ninguna información.

### 1.4 Elevación y radio

| Token | Para qué |
| :---- | :---- |
| `--shadow-card` | Tarjeta en reposo |
| `--shadow-card-hover` | Tarjeta enlazada, en hover |
| `--shadow-brand` | Superficie de marca (flota sobre el panel) |
| `--radius-surface` | `--radius + 0.5rem`; un escalón sobre la card, para que la superficie de marca lea como panel y no como una tarjeta más |

### 1.5 Modo oscuro

Los tokens nuevos tienen contraparte en el bloque `.dark`, con el mismo criterio
del kit heredado (que ya trae variantes `dark:`). **Hoy es código inalcanzable**:
nada en la app agrega la clase `.dark` al `<html>` — no hay `ThemeProvider`
montado, ver `web/src/main.tsx`. Se definen para que el bloque de tokens no quede
a medias, pero **no están medidos**: si algún día se enciende el modo oscuro, hay
que volver a medir contraste antes de darlo por bueno.

## 2\. Iconografía: vectores, nunca emoji

Todo icono de la UI sale de `lucide-react`, que ya es dependencia del proyecto. No
se usan emoji como icono: se dibujan distinto en cada sistema operativo, no
heredan el color del tema y no escalan con el texto.

Esto ya se cumple en toda la app. Auditado sobre `web/src` (todos los `.tsx`,
`.ts`, `.css`, `.html`): **cero emoji**. Las columnas "Acciones" usan
`Button variant="ghost" size="icon"` con un icono lucide de `size-4`, `aria-label`
descriptivo y `Tooltip`; el de eliminar va en `text-destructive`, el resto en
neutro heredado del botón.

Los únicos pictogramas presentes en `web/src` son las flechas `→` y `↔`, y son
**texto**, no iconos: viven en comentarios, en nombres de test y en dos frases de
la UI que describen un flujo ("Programado → Confirmado → Completado" en
`FlujoEstadosHelp.tsx`, "Catálogos clínicos → Tipos de vacuna" en
`ProgramarDosisDialog.tsx`). Son copy y no se tocan.

**Ojo con el prototipo de referencia.** `docs/_ref-ui/veterinarialeo/` sí tiene
emoji (🐕 🐾 🐱 en `ParametrosModule`, `ReportsModule`, `resendService`). Ese árbol
es referencia histórica de solo lectura y **no** es la app: no se toma de ahí
ningún patrón de iconografía.

## 3\. Navegación

La navegación es un **sidebar vertical** (`<aside>` sticky de 240px en `md+`,
`web/src/App.tsx`), que en mobile colapsa a una barra superior con `Sheet`. No es
una barra horizontal.

El ítem activo es una píldora sólida: `bg-primary text-primary-foreground`, es
decir blanco sobre `#c2410c` = **5.18:1**. Se mantiene tal cual. Es el indicador
de "estás acá" más fuerte disponible, cumple contraste de texto y no depende solo
del color (también cambia el peso visual del bloque).

## Glosario de términos visibles

Estos términos aplican solo al copy visible en la UI (labels, columnas, placeholders, toasts). No renombran props, DTOs, columnas de base, enums, códigos de error ni rutas de API — esos siguen usando el término original.

| Término visible | Reemplaza a | Alcance |
| :---- | :---- | :---- |
| Pelaje | Color | Todo el sistema (campo `color` de Mascota) |
| Tutor | Dueño | Todo el sistema (relación cliente↔mascota) |
| Huésped | Mascota | Solo dentro de Guardería (OcupacionMes, OcupacionDia, RegistrarEstadiaPage). El resto del sistema —Mascotas, Historial Clínico, sidebar— sigue diciendo "mascota". |
