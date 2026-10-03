import { env } from './env';

export class InsecureWebSocketError extends Error {
  public code = 'INSECURE_WEBSOCKET_IN_PRODUCTION';
  constructor(message: string) {
    super(message);
    this.name = 'InsecureWebSocketError';
  }
}

export interface RuntimeConfig {
  apiUrl: string;
  wsUrl: string;
  isProduction: boolean;
  isSecure: boolean;
  configurationError: string | null;
}

/**
 * Validates whether the configured WebSocket URL satisfies production security standards.
 * In production or HTTPS environments, all WebSocket traffic MUST use wss://.
 */
export function validateWebSocketUrl(url: string, isProduction: boolean, isHttps: boolean): {
  isValid: boolean;
  error: string | null;
} {
  if (!url) {
    return { isValid: false, error: 'WebSocket URL is undefined or empty.' };
  }

  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');

  // If in production or on an HTTPS page, insecure ws:// is strictly prohibited
  if ((isProduction || isHttps) && !isLocalhost && url.startsWith('ws://')) {
    return {
      isValid: false,
      error: `Security Violation: SyncRoom detected an insecure WebSocket connection (ws://) in a production environment. Secure WebSockets (wss://) are strictly required.`,
    };
  }

  // GitHub Pages domain check: GitHub Pages can NEVER host a WebSocket server
  if (url.includes('github.io')) {
    return {
      isValid: false,
      error: `Configuration Error: WebSocket URL cannot point to GitHub Pages (${url}) because GitHub Pages only hosts static files and does not run WebSocket servers. Please configure VITE_WS_URL to point to your real production backend (e.g. wss://backend.yourdomain.com/ws).`,
    };
  }

  return { isValid: true, error: null };
}

/**
 * Computes runtime WebSocket and API endpoints dynamically.
 */
export function getRuntimeConfig(): RuntimeConfig {
  const isBrowser = typeof window !== 'undefined';
  const isHttps = isBrowser ? window.location.protocol === 'https:' : false;
  const isLocalhost =
    isBrowser &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]');
  const isGitHubPages = isBrowser && window.location.hostname.includes('github.io');
  const isProduction =
    env.IS_PROD || (isBrowser && isHttps && !isLocalhost);

  // 1. Resolve API URL
  // Priority: env.API_URL -> localStorage override -> localhost fallback -> empty on GitHub Pages
  let resolvedApiUrl = env.API_URL?.trim();

  if (!resolvedApiUrl && isBrowser) {
    try {
      const storedApi =
        localStorage.getItem('VITE_API_URL') ||
        localStorage.getItem('SYNCROOM_API_URL');
      if (storedApi?.trim()) {
        resolvedApiUrl = storedApi.trim();
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  if (!resolvedApiUrl && isBrowser) {
    if (isLocalhost) {
      resolvedApiUrl = window.location.origin;
    } else if (isGitHubPages) {
      // Connect to the real production backend deployed on Render
      resolvedApiUrl = 'https://syncroom-gupn.onrender.com';
    } else {
      // Co-located production deployments (e.g. Docker container, VPS, full-stack host)
      resolvedApiUrl = window.location.origin;
    }
  }

  // 2. Resolve WebSocket URL
  // Priority: env.WS_URL -> localStorage override -> derived from resolvedApiUrl -> localhost fallback -> empty on GitHub Pages
  let resolvedWsUrl = env.WS_URL?.trim();

  if (!resolvedWsUrl && isBrowser) {
    try {
      const storedWs =
        localStorage.getItem('VITE_WS_URL') ||
        localStorage.getItem('SYNCROOM_WS_URL');
      if (storedWs?.trim()) {
        resolvedWsUrl = storedWs.trim();
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  if (!resolvedWsUrl) {
    if (resolvedApiUrl) {
      // Automatically derive wss:// endpoint from configured backend API URL in production/HTTPS
      const wsProtocol = (!isLocalhost && (isProduction || isHttps)) || resolvedApiUrl.startsWith('https:') ? 'wss:' : 'ws:';
      const cleanHost = resolvedApiUrl
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
      resolvedWsUrl = `${wsProtocol}//${cleanHost}/ws`;
    } else if (isBrowser) {
      if (isLocalhost) {
        const protocol = isHttps ? 'wss:' : 'ws:';
        resolvedWsUrl = `${protocol}//${window.location.host}/ws`;
      } else if (isGitHubPages) {
        resolvedWsUrl = 'wss://syncroom-gupn.onrender.com/ws';
      } else {
        const protocol = isHttps ? 'wss:' : 'ws:';
        resolvedWsUrl = `${protocol}//${window.location.host}/ws`;
      }
    }
  }

  // 3. Security & Validation
  let configError: string | null = null;
  if (!resolvedWsUrl) {
    if (isGitHubPages) {
      configError =
        'Backend connection not configured. Please configure VITE_API_URL and VITE_WS_URL with your deployed SyncRoom server.';
    } else {
      configError = 'WebSocket URL is undefined or empty.';
    }
  } else {
    const validation = validateWebSocketUrl(resolvedWsUrl, isProduction, isHttps);
    if (!validation.isValid) {
      configError = validation.error;
    }
  }

  return {
    apiUrl: resolvedApiUrl || '',
    wsUrl: resolvedWsUrl || '',
    isProduction,
    isSecure: isHttps || (resolvedWsUrl ? resolvedWsUrl.startsWith('wss:') : false),
    configurationError: configError,
  };
}

export function getWebSocketUrl(): string {
  const config = getRuntimeConfig();
  if (config.configurationError) {
    throw new InsecureWebSocketError(config.configurationError);
  }
  return config.wsUrl;
}

export function getApiBaseUrl(): string {
  const config = getRuntimeConfig();
  return config.apiUrl;
}
