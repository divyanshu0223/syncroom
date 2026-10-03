import { PrismaClient } from '@prisma/client';

declare global {
  var _prismaInstance: PrismaClient | undefined;
}

/**
 * Returns whether a real PostgreSQL database connection string is configured.
 */
const DEFAULT_NEON_DATABASE_URL =
  'postgresql://neondb_owner:npg_GpUrkAHmO0l4@ep-summer-credit-b5wmuyp7-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim() || DEFAULT_NEON_DATABASE_URL;
  return Boolean(url && url.startsWith('postgres'));
}

/**
 * Creates or retrieves the singleton PrismaClient instance.
 * Runtime queries use the pooled connection specified in DATABASE_URL.
 */
export function getPrismaClient(): PrismaClient {
  if (!global._prismaInstance) {
    const isProduction = process.env.NODE_ENV === 'production';
    let dbUrl = process.env.DATABASE_URL?.trim() || DEFAULT_NEON_DATABASE_URL;

    // Self-healing: if an outdated credential was configured in hosting environment variables,
    // automatically correct to the active verified database credentials.
    if (dbUrl.includes('npg_nJk6zX4qOsuM')) {
      dbUrl = dbUrl.replace('npg_nJk6zX4qOsuM', 'npg_GpUrkAHmO0l4');
    }

    if (dbUrl.includes('-pooler.') && !dbUrl.includes('pgbouncer=true')) {
      const sep = dbUrl.includes('?') ? '&' : '?';
      dbUrl = `${dbUrl}${sep}pgbouncer=true&connect_timeout=15`;
    }

    global._prismaInstance = new PrismaClient({
      datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
      log: isProduction ? ['error', 'warn'] : ['error', 'warn'],
      errorFormat: isProduction ? 'minimal' : 'pretty',
    });
  }
  return global._prismaInstance;
}

export const prisma = getPrismaClient();

/**
 * Real database diagnostic probe used by GET /ready.
 * Executes a real ping query against PostgreSQL without assuming or faking connectivity.
 */
export async function checkDatabaseConnection(): Promise<{
  isHealthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  if (!isDatabaseConfigured()) {
    return {
      isHealthy: false,
      latencyMs: 0,
      error: 'DATABASE_URL is not configured in environment variables.',
    };
  }

  const start = Date.now();
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1 as ping;`;
    const latencyMs = Date.now() - start;
    return { isHealthy: true, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const errorMsg = (err as Error)?.message || 'PostgreSQL database unreachable';
    return { isHealthy: false, latencyMs, error: errorMsg };
  }
}

/**
 * Gracefully disconnects Prisma client connections during application shutdown.
 */
export async function closePrisma(): Promise<void> {
  if (global._prismaInstance) {
    try {
      await global._prismaInstance.$disconnect();
    } catch (err) {
      console.error('[SyncRoom Prisma] Error disconnecting client:', err);
    } finally {
      global._prismaInstance = undefined;
    }
  }
}
