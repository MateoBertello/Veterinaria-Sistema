import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar los módulos bajo prueba ─────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));
vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import * as XLSX from "xlsx";
import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { TenantService } from "../../supabase/functions/api/src/modules/admin/tenants.service.ts";
import { buildCsv } from "../../supabase/functions/api/src/modules/auditoria/auditoria.service.ts";
import {
  buildXlsx,
  type HistorialRow,
} from "../../supabase/functions/api/src/modules/historial/historial.service.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);

/** Builder encadenable que captura el argumento pasado a .or(). */
function buildMockDb() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "or", "ilike", "order"]) {
    builder[m] = vi.fn(chain);
  }
  builder["range"] = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
  const db = { from: vi.fn(() => builder), builder };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Inyección de filtro PostgREST — .or() de tenants (RN-SEC)", () => {
  it("RN-SEC: sanitiza la coma de `q` para que no inyecte condiciones en .or()", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    // Payload malicioso: intenta añadir la condición activo.eq.true.
    await TenantService.buscarPaginado({
      q: "x,activo.eq.true",
      page: 1,
      limit: 20,
    } as never);

    const orArg = (db.builder["or"] as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    // El único uso legítimo de coma es el separador entre nombre.ilike y cuit_rut.ilike.
    // La coma inyectada debió reemplazarse por espacio → sólo queda la coma estructural.
    expect(orArg).toBe("nombre.ilike.%x activo.eq.true%,cuit_rut.ilike.%x activo.eq.true%");
    expect(orArg).not.toContain("x,activo");
  });
});

describe("Formula/CSV injection — export de auditoría (RN-SEC)", () => {
  it("RN-SEC: neutraliza un user_name que empieza con = en el CSV", () => {
    const csv = buildCsv([
      {
        id: "1",
        timestamp: "2026-07-06",
        module: "clientes",
        action: "create",
        user_id: "u1",
        user_name: "=cmd()",
        user_role: "admin",
        entity_id: "e1",
        details: "@SUM(A1)",
        ip_address: "1.2.3.4",
      },
    ]);
    const line = csv.split("\n")[1];
    // Los campos peligrosos quedan prefijados con comilla simple (y quoted por el ' + payload
    // que no lleva coma, o quoted si la lleva). Verificamos que NO empiezan crudos con =/@.
    expect(line).toContain("'=cmd()");
    expect(line).toContain("'@SUM(A1)");
    expect(line).not.toMatch(/(^|,)=cmd/);
    expect(line).not.toMatch(/(^|,)@SUM/);
  });
});

describe("Formula injection — export XLSX de historial (RN-SEC)", () => {
  it("RN-SEC: neutraliza celdas de texto que empiezan con carácter peligroso", () => {
    const rows: HistorialRow[] = [
      {
        id: "1",
        date: "2026-07-06",
        event_type: "Consulta",
        weight_kg: 10,
        temperature_c: 38,
        description: "=SUM(A1)",
        diagnosis: "+HYPERLINK(\"http://x\")",
        profesional: { full_name: "@evil" },
      },
    ];
    const buf = buildXlsx(rows);
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    // Fila 0 = headers; fila 1 = datos.
    const dataRow = aoa[1];
    // profesional (idx 2), description (idx 5), diagnosis (idx 6)
    expect(dataRow[2]).toBe("'@evil");
    expect(dataRow[5]).toBe("'=SUM(A1)");
    expect(dataRow[6]).toBe("'+HYPERLINK(\"http://x\")");
    // Los numéricos se preservan como número.
    expect(dataRow[3]).toBe(10);
    expect(dataRow[4]).toBe(38);
  });
});
