/**
 * Client Environment Configuration (Phase 8)
 * Exposes ONLY safe public variables to the Vite frontend.
 *
 * CRITICAL SECURITY RULE:
 * Never import or expose server secrets, database credentials,
 * or private API keys here.
 */

// Forbidden key substrings that must NEVER be exposed on the frontend
const FORBIDDEN_SECRET_PATTERNS = [
  'SECRET',
  'PRIVATE',
  'DATABASE',
  'PASSWORD',
  'CREDENTIAL',
  'TOKEN_SECRET',
  'POSTGRES',
];

const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};

// Sanity check in development to catch accidental secret leakage
if (metaEnv.DEV) {
  const envKeys = Object.keys(metaEnv);
  for (const key of envKeys) {
    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
      if (key.toUpperCase().includes(pattern) && !key.startsWith('VITE_PUBLIC_')) {
        console.error(
          `[SyncRoom Security Alert] Potential secret leaked into frontend environment: ${key}`,
        );
      }
    }
  }
}

export interface ClientEnv {
  NODE_ENV: 'development' | 'staging' | 'production';
  IS_PROD: boolean;
  IS_DEV: boolean;
  API_URL: string;
  WS_URL: string;
}

const isProd = Boolean(metaEnv.PROD || metaEnv.MODE === 'production');
const isDev = Boolean(metaEnv.DEV || metaEnv.MODE === 'development');

export const env: ClientEnv = {
  NODE_ENV: isProd ? 'production' : (metaEnv.MODE as 'development' | 'staging' | 'production') || 'development',
  IS_PROD: isProd,
  IS_DEV: isDev,
  // Public-only API and WS URL overrides
  API_URL: (metaEnv.VITE_API_URL as string) || '',
  WS_URL: (metaEnv.VITE_WS_URL as string) || '',
};
