/// <reference types="vite/client" />

import type { LatexDoApi } from "../electron/preload.cjs";

declare global {
  const __LATEXDO_VERSION__: string;

  interface Window {
    latexdo: LatexDoApi;
  }
}

export {};
