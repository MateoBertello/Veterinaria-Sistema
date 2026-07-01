import "@testing-library/jest-dom/vitest";

// jsdom no implementa ResizeObserver; lo necesita @radix-ui/react-select para
// medir el trigger cuando hay un valor preseleccionado al montar (Select con
// defaultValue no vacío, a diferencia de los selects con placeholder inicial).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
