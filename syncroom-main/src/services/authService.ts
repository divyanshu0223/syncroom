import { User } from '../types';

/**
 * Authorization Service
 *
 * Provides authorization guards for user actions.
 * In Phase 2, this is client-side policy evaluation based on the User model.
 * In later phases, these guards will mirror and validate with server-authoritative tokens/sessions.
 */

export function canControlPlayback(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' && user.isOnline;
}

export function canModifyQueue(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' && user.isOnline;
}

export function canManageRoom(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin';
}

export function canInviteListeners(user: User | null | undefined): boolean {
  // Both admin and listeners can share/invite to room
  return !!user && user.isOnline;
}
