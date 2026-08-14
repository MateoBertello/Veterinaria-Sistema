import { describe, it, expect } from "vitest";
import { ok, fail } from "../../supabase/functions/api/src/shared/envelope.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

describe("envelope — ok()", () => {
  it("devuelve success:true con data", () => {
    const res = ok({ id: "123", name: "Leo" });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ id: "123", name: "Leo" });
    expect(res.meta).toBeUndefined();
  });

  it("incluye meta cuando se pasa", () => {
    const res = ok([], { page: 1, limit: 20, total: 100 });
    expect(res.success).toBe(true);
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 100 });
  });

  it("acepta null como data", () => {
    const res = ok(null);
    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });
});

describe("envelope — fail()", () => {
  it("devuelve success:false con error estructurado", () => {
    const res = fail(ErrorCode.VALIDATION_ERROR, "Campo requerido", 400);
    expect(res.success).toBe(false);
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toBe("Campo requerido");
    expect(res.error.statusCode).toBe(400);
    expect(res.error.details).toEqual([]);
  });

  it("incluye details cuando se pasan", () => {
    const details = [{ field: "email", msg: "Formato inválido" }];
    const res = fail(ErrorCode.VALIDATION_ERROR, "Error de validación", 422, details);
    expect(res.error.details).toEqual(details);
  });

  it("acepta codes de string libre", () => {
    const res = fail("CUSTOM_CODE", "Error personalizado", 500);
    expect(res.error.code).toBe("CUSTOM_CODE");
  });

  it("MODULE_NOT_LICENSED produce 403", () => {
    const res = fail(ErrorCode.MODULE_NOT_LICENSED, "Módulo no habilitado", 403);
    expect(res.error.statusCode).toBe(403);
    expect(res.error.code).toBe("MODULE_NOT_LICENSED");
  });
});
