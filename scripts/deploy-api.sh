#!/usr/bin/env bash
#
# deploy-api.sh — despliega la Edge Function `api` desde un commit LIMPIO.
#
# Por qué existe: `supabase functions deploy api` empaqueta los archivos que hay
# EN DISCO, no los del commit en el que creés estar parado. Con un módulo en
# desarrollo en el working tree, un deploy corrido desde la raíz del repo lo
# sube a producción — junto con Services que consultan tablas y valores de ENUM
# que las migraciones pendientes todavía no crearon allá. Pasó: el deploy del
# 2026-09-04 subió `stock` y `ventas` sin querer.
#
# Este script nunca despliega el working tree. Materializa el commit pedido en
# un `git worktree` descartable, corre dos guardas sobre ÉL y recién entonces
# despliega. El working tree no se toca ni se lee.
#
#   scripts/deploy-api.sh                        # despliega origin/main
#   scripts/deploy-api.sh --ref <commit|rama>
#   scripts/deploy-api.sh --dry-run              # corre las guardas, no despliega
#
# El project-ref sale de --project-ref o de $SUPABASE_PROJECT_REF.

set -euo pipefail

REF="origin/main"
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
DRY_RUN=0
SKIP_SCHEMA=0
# Vacío = no hay módulos retenidos. `stock` y `ventas` estuvieron acá desde el
# deploy accidental del 2026-09-04 hasta que su esquema llegó a producción.
# Se agregan de nuevo con --block <modulo> si vuelve a hacer falta retener uno.
BLOQUEADOS=()

uso() {
  sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

morir() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)          REF="${2:?--ref necesita un valor}"; shift 2 ;;
    --project-ref)  PROJECT_REF="${2:?--project-ref necesita un valor}"; shift 2 ;;
    --block)        BLOQUEADOS+=("${2:?--block necesita un valor}"); shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --skip-schema-check) SKIP_SCHEMA=1; shift ;;
    -h|--help)      uso 0 ;;
    *)              morir "Opción desconocida: $1 (probá --help)" ;;
  esac
done

command -v git      >/dev/null || morir "git no está en el PATH."
command -v supabase >/dev/null || morir "El CLI de Supabase no está en el PATH (ver scripts/README.md)."
[[ -n "$PROJECT_REF" ]] || morir "Falta el project-ref. Usá --project-ref <id> o exportá SUPABASE_PROJECT_REF."

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ─── 1. Resolver el commit ──────────────────────────────────────────────────
# Se resuelve a SHA antes de nada: así lo que se despliega queda escrito en el
# log, y una rama que se mueva a mitad del script no cambia lo que sube.
if [[ "$REF" == origin/* ]]; then
  echo "→ git fetch origin ${REF#origin/}"
  git fetch --quiet origin "${REF#origin/}" || morir "No se pudo traer ${REF#origin/} de origin."
fi

SHA="$(git rev-parse --verify --quiet "${REF}^{commit}")" \
  || morir "El ref '$REF' no existe. ¿Lo pusheaste? Probá 'git fetch origin' primero."

echo "→ Commit a desplegar: $SHA"
git --no-pager log -1 --format='  %s%n  %an, %ar' "$SHA"

# ─── 2. Worktree descartable ────────────────────────────────────────────────
TMPDIR_BASE="$(mktemp -d "${TMPDIR:-/tmp}/deploy-api.XXXXXX")"
WORKTREE="$TMPDIR_BASE/repo"

limpiar() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_BASE"
}
trap limpiar EXIT

git worktree add --detach --quiet "$WORKTREE" "$SHA" \
  || morir "No se pudo crear el worktree en $WORKTREE."

API_SRC="$WORKTREE/supabase/functions/api/src"
[[ -d "$API_SRC" ]] || morir "El commit $SHA no tiene $API_SRC. ¿Es un commit de este repo?"

# ─── 3. Guarda: módulos sin lanzar ──────────────────────────────────────────
# Busca los identificadores de módulo bloqueados en TODO el código de la API.
# Alcanza con que aparezcan: si `main.ts` los monta, si `requireModule` los
# acepta o si el enum de Zod los valida, el commit no está listo para prod.
# Con la lista vacía la guarda se omite. No se deja correr con un patrón vacío:
# `grep -E "\b()\b"` casa con CUALQUIER línea, así que un array vacío haría
# abortar todo deploy con un listado sin sentido.
if [[ ${#BLOQUEADOS[@]} -eq 0 ]]; then
  echo "→ Guarda 1: sin módulos bloqueados (omitida)"
else
PATRON="$(IFS='|'; echo "${BLOQUEADOS[*]}")"
echo "→ Guarda 1: módulos bloqueados (${BLOQUEADOS[*]})"

if COINCIDENCIAS="$(grep -rniE "\\b(${PATRON})\\b" "$API_SRC" 2>/dev/null)"; then
  echo "$COINCIDENCIAS" | sed "s|^$WORKTREE/|  |" | head -20 >&2
  TOTAL="$(printf '%s\n' "$COINCIDENCIAS" | wc -l | tr -d ' ')"
  morir "El commit $SHA contiene módulos sin lanzar ($TOTAL coincidencias). No se desplegó nada.
  Desplegá un commit anterior con --ref, o sacá --block <modulo> si ya está liberado."
fi
echo "  ✓ sin rastros de: ${BLOQUEADOS[*]}"
fi

# ─── 4. Guarda: el código no puede ir adelante del esquema ──────────────────
# La causa raíz del incidente no fueron los módulos en sí, sino desplegar código
# que esperaba migraciones que prod no tenía. Esto lo generaliza: se compara la
# migración más nueva DEL COMMIT contra la más nueva APLICADA en el remoto.
# `migration list` corre en la raíz del repo, que es la que está linkeada.
if [[ "$SKIP_SCHEMA" -eq 1 ]]; then
  echo "→ Guarda 2: omitida (--skip-schema-check)"
else
  echo "→ Guarda 2: esquema remoto vs. migraciones del commit"

  LOCAL_ULTIMA="$(ls "$WORKTREE/supabase/migrations" 2>/dev/null \
    | sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' | sort | tail -1)"
  [[ -n "$LOCAL_ULTIMA" ]] || morir "No encontré migraciones en el commit $SHA."

  # De qué versión aplicada en el remoto se queda: la mayor.
  #
  # `migration list` cambió de formato. Las versiones viejas del CLI imprimían
  # una tabla con pipes y la 2ª columna era la versión remota; las nuevas (≥2.x)
  # emiten JSON {"migrations":[{"local":..,"remote":..}]}. Se aceptan las dos:
  # con el parser viejo solo, contra un CLI nuevo la lista sale vacía y la guarda
  # aborta TODO deploy con "no pude leer el estado del remoto" — falla cerrada,
  # que es la dirección correcta, pero por la razón equivocada.
  SALIDA_LIST="$(supabase migration list --linked 2>/dev/null)" || true

  REMOTA_ULTIMA="$(printf '%s' "$SALIDA_LIST" | python3 -c '
import json, re, sys
raw = sys.stdin.read()
vers = []
linea = next((l for l in raw.splitlines() if l.strip().startswith("{\"migrations\"")), None)
if linea:
    vers = [m["remote"] for m in json.loads(linea)["migrations"] if m.get("remote")]
else:
    # Formato tabla legado: "| local | remote | time |". El pipe inicial mete
    # una celda vacía al frente, así que se descartan los extremos vacíos y la
    # versión remota queda SIEMPRE en la posición 1.
    for l in raw.splitlines():
        col = [c for c in l.split("|")]
        if col and not col[0].strip():
            col = col[1:]
        if col and not col[-1].strip():
            col = col[:-1]
        if len(col) >= 2:
            v = re.sub(r"[`\s]", "", col[1])
            if re.fullmatch(r"[0-9]{14}", v):
                vers.append(v)
print(max(vers) if vers else "")
' 2>/dev/null)" || true

  if [[ -z "$REMOTA_ULTIMA" ]]; then
    morir "No pude leer el estado del remoto ('supabase migration list --linked').
  Corré 'supabase link --project-ref $PROJECT_REF', o pasá --skip-schema-check si sabés lo que hacés."
  fi

  if [[ "$LOCAL_ULTIMA" > "$REMOTA_ULTIMA" ]]; then
    morir "El commit espera migraciones que prod no tiene: commit=$LOCAL_ULTIMA, remoto=$REMOTA_ULTIMA.
  Desplegar esto rompe en runtime. Aplicá las migraciones primero, o desplegá un commit más viejo."
  fi
  echo "  ✓ commit=$LOCAL_ULTIMA ≤ remoto=$REMOTA_ULTIMA"
fi

# ─── 5. Deploy ──────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "→ --dry-run: guardas OK, no se desplegó nada."
  exit 0
fi

echo "→ supabase functions deploy api --project-ref $PROJECT_REF"
( cd "$WORKTREE" && supabase functions deploy api --project-ref "$PROJECT_REF" )

# ─── 6. Smoke test ──────────────────────────────────────────────────────────
# 401 y no 404 es la prueba de que la ruta EXISTE en lo que quedó desplegado:
# `especies` está detrás de `tenantContext`, así que un anónimo tiene que
# rebotar con 401. Un 404 significa que el deploy no tomó.
BASE="https://${PROJECT_REF}.supabase.co/functions/v1/api/v1"
echo "→ Smoke test contra $BASE"

codigo() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" || echo "000"; }

HEALTH="$(codigo "$BASE/health")"
ESPECIES="$(codigo "$BASE/especies")"

printf '  health   %s (esperado 200)\n' "$HEALTH"
printf '  especies %s (esperado 401)\n' "$ESPECIES"

if [[ "$HEALTH" != "200" || "$ESPECIES" != "401" ]]; then
  morir "El smoke test no dio lo esperado. Revisá los logs de la función antes de dar por bueno el deploy."
fi

echo
echo "✓ Desplegado $SHA en $PROJECT_REF."
