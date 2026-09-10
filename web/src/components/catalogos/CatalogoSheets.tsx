import { useEffect, useState } from "react";
import { Controller, useForm, type UseFormSetError, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { listarEspeciesCatalogo } from "../../api/catalogos.ts";
import {
  ApiError,
  ErrorCode,
  type EspecieCatalogo,
  type EspecieInput,
  type RazaCatalogo,
  type RazaInput,
  type TipoVacunaCatalogo,
  type TipoVacunaInput,
} from "../../types/index.ts";

/**
 * Formularios de alta/edición del catálogo. Los tres comparten forma —nombre,
 * descripción y poco más— así que comparten el manejo de errores, que es la
 * parte que de verdad importa: RN-CAT2 llega como 409 CATALOG_DUPLICATE y tiene
 * que aterrizar EN EL CAMPO nombre, no en un toast genérico. Un toast obliga al
 * usuario a adivinar cuál de los campos rechazó el servidor.
 */
function manejarError<T extends { name?: unknown; nombre?: unknown }>(
  err: unknown,
  setError: UseFormSetError<T>,
  campoNombre: Path<T>,
): void {
  if (err instanceof ApiError && err.code === ErrorCode.CATALOG_DUPLICATE) {
    setError(campoNombre, { type: "server", message: err.message });
    return;
  }
  toast.error(err instanceof ApiError ? err.message : "No se pudo guardar");
}

function ErrorDeCampo({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return <p role="alert" className="text-sm text-destructive">{mensaje}</p>;
}

// ─── Especies ─────────────────────────────────────────────────────────────────

const ESPECIE_VACIA: EspecieInput = { name: "", description: "" };

export function EspecieFormSheet({
  open, onOpenChange, especie, onSaved, crear, editar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  especie?: EspecieCatalogo | null;
  onSaved: () => void;
  crear:  (input: EspecieInput) => Promise<EspecieCatalogo>;
  editar: (id: string, input: EspecieInput) => Promise<EspecieCatalogo>;
}) {
  const esEdicion = Boolean(especie);
  const { control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<EspecieInput>({ defaultValues: ESPECIE_VACIA });

  useEffect(() => {
    if (!open) return;
    reset(especie ? { name: especie.name, description: especie.description ?? "" } : ESPECIE_VACIA);
  }, [open, especie, reset]);

  async function onSubmit(values: EspecieInput) {
    const input: EspecieInput = {
      name:        values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
    };
    try {
      if (especie) await editar(especie.id, input);
      else         await crear(input);
      toast.success(esEdicion ? "Especie actualizada" : "Especie creada");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      manejarError<EspecieInput>(err, setError, "name");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar especie" : "Nueva especie"}</SheetTitle>
          <SheetDescription>
            Las especies alimentan el alta de mascotas y agrupan a las razas.
          </SheetDescription>
        </SheetHeader>

        <form className="flex flex-1 flex-col gap-4 p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="especie-name">Nombre</Label>
            <Controller
              name="name"
              control={control}
              rules={{
                required: "El nombre es requerido",
                minLength: { value: 2, message: "El nombre requiere al menos 2 caracteres" },
                maxLength: { value: 60, message: "Máximo 60 caracteres" },
              }}
              render={({ field }) => (
                <Input
                  id="especie-name"
                  autoFocus
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "especie-name-error" : undefined}
                  {...field}
                  value={field.value ?? ""}
                />
              )}
            />
            <span id="especie-name-error"><ErrorDeCampo mensaje={errors.name?.message} /></span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="especie-desc">Descripción (opcional)</Label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Textarea id="especie-desc" rows={3} {...field} value={field.value ?? ""} />
              )}
            />
          </div>

          <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Razas ────────────────────────────────────────────────────────────────────

const RAZA_VACIA: RazaInput = { especieId: "", name: "", description: "" };

export function RazaFormSheet({
  open, onOpenChange, raza, especieIdSugerida, onSaved, crear, editar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raza?: RazaCatalogo | null;
  /** Especie preseleccionada cuando la pantalla ya está filtrada por una. */
  especieIdSugerida?: string;
  onSaved: () => void;
  crear:  (input: RazaInput) => Promise<RazaCatalogo>;
  editar: (id: string, input: RazaInput) => Promise<RazaCatalogo>;
}) {
  const esEdicion = Boolean(raza);
  const [especies, setEspecies] = useState<EspecieCatalogo[]>([]);
  const { control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<RazaInput>({ defaultValues: RAZA_VACIA });

  // Solo especies ACTIVAS: crear una raza bajo una especie dada de baja la
  // dejaría invisible desde el minuto cero (RN-CAT6/RN-CAT7).
  useEffect(() => {
    if (!open) return;
    listarEspeciesCatalogo({ active: true, limit: 100 })
      .then(({ items }) => setEspecies(items))
      .catch(() => toast.error("No se pudieron cargar las especies"));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    reset(
      raza
        ? { especieId: raza.especieId, name: raza.name, description: raza.description ?? "" }
        : { ...RAZA_VACIA, especieId: especieIdSugerida ?? "" },
    );
  }, [open, raza, especieIdSugerida, reset]);

  async function onSubmit(values: RazaInput) {
    const input: RazaInput = {
      especieId:   values.especieId,
      name:        values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
    };
    try {
      if (raza) await editar(raza.id, input);
      else      await crear(input);
      toast.success(esEdicion ? "Raza actualizada" : "Raza creada");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      manejarError<RazaInput>(err, setError, "name");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar raza" : "Nueva raza"}</SheetTitle>
          <SheetDescription>Cada raza pertenece a una especie de esta clínica.</SheetDescription>
        </SheetHeader>

        <form className="flex flex-1 flex-col gap-4 p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="raza-especie">Especie</Label>
            <Controller
              name="especieId"
              control={control}
              rules={{ required: "Elegí una especie" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="raza-especie" aria-invalid={Boolean(errors.especieId)}>
                    <SelectValue placeholder="Elegí una especie" />
                  </SelectTrigger>
                  <SelectContent>
                    {especies.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <ErrorDeCampo mensaje={errors.especieId?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="raza-name">Nombre</Label>
            <Controller
              name="name"
              control={control}
              rules={{
                required: "El nombre es requerido",
                minLength: { value: 2, message: "El nombre requiere al menos 2 caracteres" },
                maxLength: { value: 60, message: "Máximo 60 caracteres" },
              }}
              render={({ field }) => (
                <Input
                  id="raza-name"
                  aria-invalid={Boolean(errors.name)}
                  {...field}
                  value={field.value ?? ""}
                />
              )}
            />
            <ErrorDeCampo mensaje={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="raza-desc">Descripción (opcional)</Label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Textarea id="raza-desc" rows={3} {...field} value={field.value ?? ""} />
              )}
            />
          </div>

          <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Tipos de vacuna ──────────────────────────────────────────────────────────

/**
 * Especies ACTIVAS de la clínica, cargadas al abrirse el panel.
 *
 * Solo activas: asociar una vacuna a una especie dada de baja produciría una
 * relación que ninguna pantalla puede ejercitar (RN-CAT9 — una especie inactiva
 * no se ofrece en altas nuevas, así que no habría mascota nueva de esa especie).
 */
function useEspeciesActivas(open: boolean) {
  const [especies, setEspecies] = useState<EspecieCatalogo[]>([]);

  useEffect(() => {
    if (!open) return;
    listarEspeciesCatalogo({ active: true, limit: 100 })
      .then(({ items }) => setEspecies(items))
      .catch(() => toast.error("No se pudieron cargar las especies"));
  }, [open]);

  return especies;
}

/**
 * Selector de las especies a las que aplica una vacuna (RN-CAT10).
 *
 * Un `<fieldset>` con `<legend>` y no un combo múltiple: son pocas opciones, se
 * eligen varias, y el grupo nativo ya trae la semántica que un lector de
 * pantalla necesita para anunciar "3 de 7 seleccionadas" sin ARIA a mano.
 *
 * Lo comparten el formulario de alta/edición y el panel dedicado de asociación,
 * para que las dos pantallas no puedan divergir en qué se puede elegir.
 */
function EspeciesAplicablesPicker({
  especies, value, onChange, error, idPrefijo,
}: {
  especies:  EspecieCatalogo[];
  value:     string[];
  onChange:  (ids: string[]) => void;
  error?:    string;
  idPrefijo: string;
}) {
  function alternar(id: string, marcada: boolean) {
    onChange(marcada ? [...value, id] : value.filter((x) => x !== id));
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Especies a las que aplica *</legend>
      <p className="text-sm text-muted-foreground">
        Solo se va a poder programar esta vacuna a mascotas de las especies marcadas.
      </p>

      {especies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay especies activas en el catálogo.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {especies.map((e) => {
            const id = `${idPrefijo}-especie-${e.id}`;
            return (
              <div key={e.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={value.includes(e.id)}
                  onCheckedChange={(c) => alternar(e.id, c === true)}
                />
                <Label htmlFor={id} className="font-normal">{e.name}</Label>
              </div>
            );
          })}
        </div>
      )}

      <ErrorDeCampo mensaje={error} />
    </fieldset>
  );
}

/** Al menos una especie (RN-CAT10). Lo valida también el backend. */
const REGLA_ESPECIES = {
  validate: (ids: string[] | undefined) =>
    (ids?.length ?? 0) > 0 || "Elegí al menos una especie a la que aplique la vacuna",
};

const TIPO_VACIO: TipoVacunaInput = { nombre: "", especieIds: [], mesesRefuerzoSugerido: null };

export function TipoVacunaFormSheet({
  open, onOpenChange, tipo, onSaved, crear, editar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo?: TipoVacunaCatalogo | null;
  onSaved: () => void;
  crear:  (input: TipoVacunaInput) => Promise<TipoVacunaCatalogo>;
  editar: (id: string, input: TipoVacunaInput) => Promise<TipoVacunaCatalogo>;
}) {
  const esEdicion = Boolean(tipo);
  const { control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<TipoVacunaInput>({ defaultValues: TIPO_VACIO });

  const especies = useEspeciesActivas(open);

  useEffect(() => {
    if (!open) return;
    reset(
      tipo
        ? {
            nombre:                tipo.nombre,
            especieIds:            tipo.especies.map((e) => e.id),
            mesesRefuerzoSugerido: tipo.mesesRefuerzoSugerido,
          }
        : TIPO_VACIO,
    );
  }, [open, tipo, reset]);

  async function onSubmit(values: TipoVacunaInput) {
    const meses = values.mesesRefuerzoSugerido;
    const input: TipoVacunaInput = {
      nombre:                values.nombre.trim(),
      // Va SIEMPRE y COMPLETO: el backend reemplaza el conjunto (RN-CAT10).
      especieIds:            values.especieIds ?? [],
      mesesRefuerzoSugerido: meses === null || meses === undefined || Number.isNaN(Number(meses))
        ? null
        : Number(meses),
    };
    try {
      if (tipo) await editar(tipo.id, input);
      else      await crear(input);
      toast.success(esEdicion ? "Tipo de vacuna actualizado" : "Tipo de vacuna creado");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      manejarError<TipoVacunaInput>(err, setError, "nombre");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar tipo de vacuna" : "Nuevo tipo de vacuna"}</SheetTitle>
          <SheetDescription>
            Alimenta el plan de vacunación. Solo se ofrece en las mascotas de las
            especies marcadas; el refuerzo sugerido precarga la próxima dosis.
          </SheetDescription>
        </SheetHeader>

        <form className="flex flex-1 flex-col gap-4 p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="tipo-nombre">Nombre</Label>
            <Controller
              name="nombre"
              control={control}
              rules={{
                required: "El nombre es requerido",
                minLength: { value: 2, message: "El nombre requiere al menos 2 caracteres" },
                maxLength: { value: 80, message: "Máximo 80 caracteres" },
              }}
              render={({ field }) => (
                <Input
                  id="tipo-nombre"
                  autoFocus
                  aria-invalid={Boolean(errors.nombre)}
                  {...field}
                  value={field.value ?? ""}
                />
              )}
            />
            <ErrorDeCampo mensaje={errors.nombre?.message} />
          </div>

          <Controller
            name="especieIds"
            control={control}
            rules={REGLA_ESPECIES}
            render={({ field }) => (
              <EspeciesAplicablesPicker
                especies={especies}
                value={field.value ?? []}
                onChange={field.onChange}
                error={errors.especieIds?.message}
                idPrefijo="tipo"
              />
            )}
          />

          <div className="space-y-2">
            <Label htmlFor="tipo-meses">Refuerzo sugerido, en meses (opcional)</Label>
            <Controller
              name="mesesRefuerzoSugerido"
              control={control}
              rules={{
                min: { value: 1,   message: "Mínimo 1 mes" },
                max: { value: 120, message: "Máximo 120 meses" },
              }}
              render={({ field }) => (
                <Input
                  id="tipo-meses"
                  type="number"
                  min={1}
                  max={120}
                  aria-invalid={Boolean(errors.mesesRefuerzoSugerido)}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                />
              )}
            />
            <ErrorDeCampo mensaje={errors.mesesRefuerzoSugerido?.message} />
          </div>

          <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Especies aplicables (panel dedicado) ─────────────────────────────────────

/**
 * Pantalla de asociación vacuna → especies (RN-CAT10).
 *
 * Existe además del formulario de edición porque son dos tareas distintas: una
 * es corregir la ficha de la vacuna, la otra es armar el calendario sanitario de
 * la clínica, que se hace de corrido para varias vacunas. Comparten el mismo
 * `EspeciesAplicablesPicker`, así que no pueden ofrecer opciones distintas.
 *
 * Guarda contra el endpoint dedicado (`PUT /tipos-vacuna/:id/especies`), que
 * reemplaza el conjunto sin tocar el nombre ni el refuerzo.
 */
export function EspeciesAplicablesSheet({
  open, onOpenChange, tipo, onSaved, guardar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo?: TipoVacunaCatalogo | null;
  onSaved: () => void;
  guardar: (id: string, especieIds: string[]) => Promise<TipoVacunaCatalogo>;
}) {
  const especies = useEspeciesActivas(open);
  const { control, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<{ especieIds: string[] }>({ defaultValues: { especieIds: [] } });

  useEffect(() => {
    if (!open) return;
    reset({ especieIds: tipo?.especies.map((e) => e.id) ?? [] });
  }, [open, tipo, reset]);

  async function onSubmit(values: { especieIds: string[] }) {
    if (!tipo) return;
    try {
      await guardar(tipo.id, values.especieIds);
      toast.success("Especies aplicables actualizadas");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo guardar");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Especies aplicables</SheetTitle>
          <SheetDescription>
            A qué especies corresponde {tipo ? `“${tipo.nombre}”` : "esta vacuna"}.
            Lo que quede sin marcar deja de ofrecerse al programar una dosis.
          </SheetDescription>
        </SheetHeader>

        <form className="flex flex-1 flex-col gap-4 p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Controller
            name="especieIds"
            control={control}
            rules={REGLA_ESPECIES}
            render={({ field }) => (
              <EspeciesAplicablesPicker
                especies={especies}
                value={field.value ?? []}
                onChange={field.onChange}
                error={errors.especieIds?.message}
                idPrefijo="asociar"
              />
            )}
          />

          {/*
            RN-CAT11: cambiar las especies no toca las dosis ya registradas. Se
            dice acá porque es la duda inmediata de quien está por desmarcar una
            especie que ya tiene dosis puestas.
          */}
          <p className="text-sm text-muted-foreground">
            Las dosis ya programadas o aplicadas no se modifican: el cambio rige
            para las que se programen de acá en más.
          </p>

          <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
