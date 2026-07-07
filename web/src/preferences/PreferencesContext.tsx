import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthContext.tsx";

/**
 * Preferencias de accesibilidad por usuario (RN-UX3). Se persisten en localStorage
 * (keyeadas por id de usuario, "persistido por usuario") y se aplican globalmente
 * como CSS var (--font-size) y clases en el <html> raíz, sin tocar el kit heredado.
 */
export type FontSize = "sm" | "md" | "lg" | "xl";
export type Density  = "comfortable" | "compact";

export interface Preferences {
  fontSize:       FontSize;
  density:        Density;
  highContrast:   boolean;
  reducedMotion:  boolean;
}

// px por escalón de tamaño de fuente; consumido por `html { font-size: var(--font-size) }`.
export const FONT_SIZE_PX: Record<FontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
  xl: "20px",
};

const STORAGE_PREFIX = "leo:prefs:";
const storageKey = (userId: string | null) => `${STORAGE_PREFIX}${userId ?? "anon"}`;

/** Default de "reducción de movimiento": respeta la preferencia del SO si existe. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function defaultPreferences(): Preferences {
  return { fontSize: "md", density: "comfortable", highContrast: false, reducedMotion: prefersReducedMotion() };
}

function isFontSize(v: unknown): v is FontSize {
  return v === "sm" || v === "md" || v === "lg" || v === "xl";
}
function isDensity(v: unknown): v is Density {
  return v === "comfortable" || v === "compact";
}

/** Lee y sanea las preferencias del usuario desde localStorage; nunca lanza. */
function loadPreferences(userId: string | null): Preferences {
  const base = defaultPreferences();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      fontSize:      isFontSize(parsed.fontSize) ? parsed.fontSize : base.fontSize,
      density:       isDensity(parsed.density) ? parsed.density : base.density,
      highContrast:  typeof parsed.highContrast === "boolean" ? parsed.highContrast : base.highContrast,
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : base.reducedMotion,
    };
  } catch {
    return base;
  }
}

/** Aplica las preferencias al <html> raíz: var de tamaño y clases de estado. */
export function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.style.setProperty("--font-size", FONT_SIZE_PX[prefs.fontSize]);
  root.classList.toggle("density-compact", prefs.density === "compact");
  root.classList.toggle("high-contrast", prefs.highContrast);
  root.classList.toggle("reduce-motion", prefs.reducedMotion);
}

interface PreferencesContextValue {
  prefs:    Preferences;
  /** Actualiza una preferencia, la aplica al root y la persiste. */
  setPref:  <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  /** Restablece a los valores por defecto (respetando el SO para movimiento). */
  reset:    () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences(null));

  // Recarga (y reaplica) al cambiar de usuario: cada usuario tiene su propio set.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    const cargadas = loadPreferences(userId);
    setPrefs(cargadas);
    applyPreferences(cargadas);
    lastUserId.current = userId;
  }, [userId]);

  const persist = useCallback((next: Preferences) => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
      // Sin acceso a localStorage (modo privado / cuota): las prefs siguen
      // aplicadas en memoria, sólo no persisten entre sesiones.
    }
  }, [userId]);

  const setPref = useCallback<PreferencesContextValue["setPref"]>((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      applyPreferences(next);
      persist(next);
      return next;
    });
  }, [persist]);

  const reset = useCallback(() => {
    const base = defaultPreferences();
    setPrefs(base);
    applyPreferences(base);
    persist(base);
  }, [persist]);

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, setPref, reset }),
    [prefs, setPref, reset],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences debe usarse dentro de <PreferencesProvider>");
  return ctx;
}
