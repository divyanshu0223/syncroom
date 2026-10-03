import { ServerUser } from '../types';

/**
 * Centralized Server Authorization Module (Phase 7)
 * Strictly derives all user permissions from validated server sessions.
 * Never trusts role, userId, or permissions submitted by client payloads.
 */

export function isAdmin(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin';
}

export function canControlPlayback(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin' && user.connected;
}

export function canModifyQueue(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin' && user.connected;
}

export function canImportPlaylist(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin' && user.connected;
}

export function canRemoveMember(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin';
}

export function canManageRoom(user: ServerUser | null | undefined): boolean {
  return !!user && user.role === 'admin';
}
