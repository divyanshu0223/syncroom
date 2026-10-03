import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../../src/db/prisma';
import { hashSessionToken } from '../db/dbRepository';
import { logger } from '../utils/logger';

export interface AuthenticatedUser {
  id: string;
  name: string;
  tokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Resolves or auto-provisions a persistent User account in PostgreSQL
 * based on a cryptographically hashed user token.
 */
export async function resolveUserFromRequest(req: Request): Promise<AuthenticatedUser | null> {
  // 1. Extract candidate token
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const customUserToken = (req.headers['x-user-token'] as string)?.trim() || (req.query.userToken as string)?.trim();
  const rawToken = customUserToken || (bearerToken?.startsWith('syncroom_usr_') ? bearerToken : null);

  if (rawToken && rawToken.length >= 16) {
    try {
      const tokenHash = hashSessionToken(rawToken);

      // Look up existing user by token hash
      let user = await prisma.user.findUnique({
        where: { tokenHash },
      });

      if (user) {
        return user;
      }

      // Auto-provision persistent user in PostgreSQL
      const clientName = (req.headers['x-user-name'] as string)?.trim() || 'SyncRoom User';
      const userId = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

      user = await prisma.user.create({
        data: {
          id: userId,
          name: clientName,
          tokenHash,
        },
      });

      logger.info('[SyncRoom Auth] Created new persistent user in PostgreSQL', { userId: user.id });
      return user;
    } catch (err) {
      logger.error('[SyncRoom Auth] Error resolving user by token hash', err);
    }
  }

  // 2. Fallback: check deviceSession token for backward compatibility
  const sessionToken = (req.headers['x-session-token'] as string)?.trim() || (bearerToken?.startsWith('syncroom_session_') ? bearerToken : null);
  if (sessionToken && sessionToken.startsWith('syncroom_session_')) {
    try {
      const sessionTokenHash = hashSessionToken(sessionToken);
      const session = await prisma.deviceSession.findUnique({
        where: { sessionTokenHash },
        include: { user: true },
      });

      if (session && session.user) {
        return session.user;
      }
    } catch (err) {
      logger.error('[SyncRoom Auth] Error resolving user via device session', err);
    }
  }

  return null;
}

/**
 * Middleware: Enforces that the request has an authenticated, persistent PostgreSQL user.
 * Sets req.user upon success; returns 401 Unauthorized on failure.
 */
export async function requirePersistentUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({
        error: 'Authentication required. Missing or invalid persistent user token.',
        status: 'UNAUTHORIZED',
      });
    }

    req.user = user;
    next();
  } catch (err: any) {
    logger.error('[SyncRoom Auth] Middleware error', err);
    return res.status(500).json({
      error: 'Authentication processing failure.',
      status: 'AUTH_ERROR',
    });
  }
}
