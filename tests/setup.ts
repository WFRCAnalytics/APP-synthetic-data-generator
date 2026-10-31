// Vitest + React Testing Library global setup.
import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver; the virtualized column list needs it to exist. This
// satisfies the constructor only and makes no claim about real sizing.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver ??= ResizeObserverMock;

// jsdom has no window.matchMedia. Report "no match" for every query, the right default for a
// test environment with no real display.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Minimal in-memory Storage when jsdom does not provide one. Only the theme preference ever uses
// browser storage (research.md R16); tests that need isolation call localStorage.clear().
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  const localStoragePolyfill: Storage = {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: localStoragePolyfill, configurable: true });
}
