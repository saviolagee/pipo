/// <reference types="vite/client" />

// Credenciais OAuth opcionais embutidas no build (.env: MAIN_VITE_GOOGLE_CLIENT_ID etc.).
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
  readonly MAIN_VITE_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
