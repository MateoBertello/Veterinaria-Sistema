import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Badge } from "../ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.tsx";
import {
  auditActionBadgeVariant,
  auditActionLabel,
  auditModuleLabel,
  diffValues,
  formatDiffValue,
} from "../../lib/auditoria.ts";
import type { RegistroAuditoria } from "../../types/index.ts";

interface Props {
  registro:     RegistroAuditoria | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detalle de un asiento de auditoría: metadata + diff legible de oldValues/
 * newValues (RN-AUD: nunca volcar el JSON crudo). Se abre desde una fila de la
 * tabla de AuditoriaPage; `registro` en null mantiene el Dialog cerrado.
 */
export function AuditoriaDetalleDialog({ registro, onOpenChange }: Props) {
  const cambios = registro ? diffValues(registro.oldValues, registro.newValues) : [];

  return (
    <Dialog open={Boolean(registro)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalle del asiento</DialogTitle>
          <DialogDescription>
            {registro ? new Date(registro.timestamp).toLocaleString("es-AR") : ""}
          </DialogDescription>
        </DialogHeader>

        {registro ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="text-xs text-muted-foreground">Usuario</dt>
                <dd>
                  {registro.userName ?? "—"}
                  {registro.userRole ? ` (${registro.userRole})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Módulo</dt>
                <dd>{auditModuleLabel(registro.module)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Acción</dt>
                <dd>
                  <Badge variant={auditActionBadgeVariant(registro.action)}>
                    {auditActionLabel(registro.action)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Dirección IP</dt>
                <dd>{registro.ipAddress ?? "—"}</dd>
              </div>
            </dl>

            {registro.details ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Detalles</p>
                <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2">
                  {registro.details}
                </p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Cambios</p>
              {cambios.length === 0 ? (
                <p className="text-muted-foreground">
                  Sin valores previos/nuevos registrados para este asiento.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campo</TableHead>
                        <TableHead>Antes</TableHead>
                        <TableHead>Después</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cambios.map((c) => (
                        <TableRow key={c.field}>
                          <TableCell className="font-medium">{c.field}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDiffValue(c.before)}
                          </TableCell>
                          <TableCell>{formatDiffValue(c.after)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
