/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Only for a test harness pointing at a different origin. In the app the API
   * is same-origin by construction - Express serves both the bundle and /api
   * from 4444 - so this is normally unset.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
