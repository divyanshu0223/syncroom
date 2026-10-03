/**
 * Room Code Utilities
 * Generates and validates readable 6-character room codes.
 * Excludes easily confusable characters (O, 0, I, 1).
 */

const SAFE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates an uppercase 6-character room code.
 * Example: A7K9P2
 */
export function generateRoomCode(): string {
  let result = '';
  const length = 6;
  const charactersLength = SAFE_CHARACTERS.length;

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charactersLength);
    result += SAFE_CHARACTERS.charAt(randomIndex);
  }

  return result;
}

/**
 * Normalizes input code by trimming and converting to uppercase.
 */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Validates whether a room code is formatted properly:
 * Must be exactly 6 characters long and only alphanumeric.
 */
export function validateRoomCode(code: string): { isValid: boolean; error?: string } {
  const normalized = normalizeRoomCode(code);

  if (!normalized) {
    return { isValid: false, error: 'Enter a valid 6-character room code' };
  }

  if (normalized.length !== 6) {
    return { isValid: false, error: 'Enter a valid 6-character room code' };
  }

  const validRegex = /^[A-Z0-9]{6}$/;
  if (!validRegex.test(normalized)) {
    return { isValid: false, error: 'Room code must contain only letters and numbers' };
  }

  return { isValid: true };
}
