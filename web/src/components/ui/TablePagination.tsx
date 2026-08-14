import { useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "./pagination";

export interface PaginationProps {
  /** Página actual (1-based) */
  page: number;
  /** Cantidad total de registros */
  total: number;
  /** Registros por página */
  pageSize: number;
  /** Callback cuando cambia la página */
  onPageChange: (page: number) => void;
  /** Máximo de botones de página a mostrar (excluyendo prev/next) */
  maxVisible?: number;
  /** Texto para screen readers */
  ariaLabel?: string;
}

/**
 * Componente de paginación completo con:
 * - Botones Anterior/Siguiente
 * - Números de página con ellipsis para rangos grandes
 * - Indicador de página activa
 * - Total de registros y rango visible
 */
export function TablePagination({
  page,
  total,
  pageSize,
  onPageChange,
  maxVisible = 5,
  ariaLabel = "paginación",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Calcular qué números de página mostrar
  const pageNumbers = useMemo(() => {
    const result: (number | "ellipsis")[] = [];
    
    if (totalPages <= maxVisible) {
      // Si hay pocas páginas, mostrar todas
      for (let i = 1; i <= totalPages; i++) {
        result.push(i);
      }
    } else {
      // Siempre mostrar primera página
      result.push(1);
      
      const halfVisible = Math.floor(maxVisible / 2);
      let start = Math.max(2, page - halfVisible);
      let end = Math.min(totalPages - 1, page + halfVisible);
      
      // Ajustar para mantener cantidad consistente de botones
      if (start === 2) {
        end = Math.min(totalPages - 1, 1 + maxVisible - 1);
      } else if (end === totalPages - 1) {
        start = Math.max(2, totalPages - maxVisible);
      }
      
      // Ellipsis después de la primera página si es necesario
      if (start > 2) {
        result.push("ellipsis");
      }
      
      // Páginas del medio
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
      
      // Ellipsis antes de la última página si es necesario
      if (end < totalPages - 1) {
        result.push("ellipsis");
      }
      
      // Siempre mostrar última página
      result.push(totalPages);
    }
    
    return result;
  }, [page, totalPages, maxVisible]);

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Información de registros */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total} registro{total === 1 ? "" : "s"} · 
        Mostrando {startRecord}-{endRecord} · 
        Página {page} de {totalPages}
      </p>

      {/* Controles de paginación */}
      <Pagination aria-label={ariaLabel}>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (page > 1) onPageChange(page - 1);
              }}
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            />
          </PaginationItem>

          {pageNumbers.map((num, idx) =>
            num === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${idx}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={num}>
                <PaginationLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onPageChange(num);
                  }}
                  isActive={num === page}
                  aria-current={num === page ? "page" : undefined}
                >
                  {num}
                </PaginationLink>
              </PaginationItem>
            )
          )}

          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (page < totalPages) onPageChange(page + 1);
              }}
              className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
