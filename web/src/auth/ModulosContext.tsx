import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchModulosHabilitados } from "../api/modulos.ts";
import { useAuth } from "./AuthContext.tsx";
import type { ModuloContratado, ModuloVendible } from "../types/index.ts";

export interface ModulosContextValue {
  modulos:        ModuloContratado[];
  cargando:       boolean;
  estaHabilitado: (modulo: ModuloVendible) => boolean;
  recargar:       () => Promise<void>;
}

const ModulosContext = createContext<ModulosContextValue | null>(null);

export function ModulosProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [modulos, setModulos] = useState<ModuloContratado[]>([]);
  const [cargando, setCargando] = useState<boolean>(status === "authenticated");

  const cargar = useCallback(async () => {
    if (status !== "authenticated") {
      setModulos([]);
      setCargando(false);
      return;
    }
    try {
      setCargando(true);
      const lista = await fetchModulosHabilitados();
      setModulos(lista);
    } catch {
      // En error o sin conexión, se asume lista vacía (RN-G2).
      setModulos([]);
    } finally {
      setCargando(false);
    }
  }, [status]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const estaHabilitado = useCallback(
    (modulo: ModuloVendible) => {
      return modulos.some((m) => m.modulo === modulo && m.habilitado);
    },
    [modulos],
  );

  const value = useMemo<ModulosContextValue>(
    () => ({
      modulos,
      cargando,
      estaHabilitado,
      recargar: cargar,
    }),
    [modulos, cargando, estaHabilitado, cargar],
  );

  return <ModulosContext.Provider value={value}>{children}</ModulosContext.Provider>;
}

export function useModulos(): ModulosContextValue {
  const ctx = useContext(ModulosContext);
  if (!ctx) {
    // Fallback defensivo para tests unitarios o componentes montados fuera de Shell
    return {
      modulos:        [],
      cargando:       false,
      estaHabilitado: () => false,
      recargar:       async () => {},
    };
  }
  return ctx;
}
