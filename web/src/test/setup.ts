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

// jsdom tampoco implementa hasPointerCapture/scrollIntoView, usados por
// @radix-ui/react-select al abrir el listbox con click (necesario para testear
// filtros por Select, no solo por defaultValue).
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
