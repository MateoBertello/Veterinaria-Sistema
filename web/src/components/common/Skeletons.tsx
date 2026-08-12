import { Skeleton } from "../ui/skeleton.tsx";
import { Table, TableBody, TableCell, TableRow } from "../ui/table.tsx";
import { Card, CardContent, CardHeader } from "../ui/card.tsx";

/**
 * Skeletons específicos por tipo de contenido para mejorar la percepción de carga.
 * Cada skeleton refleja la estructura real del contenido que reemplaza.
 */

/** Skeleton para tabla de datos (usada en listados como ClientesPage, UsuariosPage, etc.) */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columns }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

/** Skeleton para tarjetas de métricas (DashboardPage) */
export function MetricCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" aria-busy="true" aria-label="Cargando métrica" />
      ))}
    </>
  );
}

/** Skeleton para formulario con campos de texto */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
}

/** Skeleton para lista vertical de items */
export function ListSkeleton({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton para tarjeta de contenido con header */
export function CardSkeleton({ hasHeader = true }: { hasHeader?: boolean }) {
  return (
    <Card>
      {hasHeader && (
        <CardHeader>
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
      )}
      <CardContent className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}
