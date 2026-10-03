import { Room, User, StoredSession, Track, QueueItem, PlayerState } from '../types';
import { generateRoomCode, normalizeRoomCode, validateRoomCode } from '../utils/roomCode';

const SESSION_STORAGE_KEY = 'syncroom_active_session';
const ROOMS_STORAGE_KEY = 'syncroom_persisted_rooms';

/**
 * Default seeded initial rooms for testing and instant exploration.
 */
function createDefaultRooms(): Map<string, Room> {
  return new Map<string, Room>();
}

class RoomStore {
  private rooms: Map<string, Room>;

  constructor() {
    this.rooms = new Map();
    this.loadPersistedRooms();
  }

  private loadPersistedRooms() {
    try {
      const stored = localStorage.getItem(ROOMS_STORAGE_KEY);
      if (stored) {
        const parsed: Room[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((room) => this.rooms.set(room.code, room));
          return;
        }
      }
    } catch {
      // Fallback to defaults
    }

    // Default seed
    this.rooms = createDefaultRooms();
    this.persistRooms();
  }

  private persistRooms() {
    try {
      const list = Array.from(this.rooms.values());
      localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage unavailable or full
    }
  }

  /**
   * Generates a unique 6-character room code not already taken.
   */
  private generateUniqueCode(): string {
    let attempts = 0;
    while (attempts < 20) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) {
        return code;
      }
      attempts++;
    }
    // Fallback timestamp-based code
    return 'SR' + Math.floor(1000 + Math.random() * 9000);
  }

  /**
   * Creates a new Room with the creator as Admin.
   */
  public createRoom(name: string, adminName: string): { room: Room; adminUser: User } {
    const trimmedName = name.trim();
    const trimmedAdmin = adminName.trim();

    if (!trimmedName) {
      throw new Error('Please enter a room name');
    }
    if (!trimmedAdmin) {
      throw new Error('Please enter your name');
    }

    const code = this.generateUniqueCode();
    const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const adminId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const adminUser: User = {
      id: adminId,
      name: trimmedAdmin,
      role: 'admin',
      joinedAt: Date.now(),
      isOnline: true,
      isSelf: true,
      avatarColor: 'from-amber-500 to-amber-700',
      device: 'desktop',
      driftMs: 0,
      isSynced: true,
    };

    const initialTrack: Track | null = null;
    const initialQueue: QueueItem[] = [];

    const room: Room = {
      id: roomId,
      code,
      name: trimmedName,
      adminId,
      createdAt: Date.now(),
      users: [adminUser],
      currentTrack: initialTrack,
      queue: initialQueue,
      playerState: {
        trackId: null,
        isPlaying: false,
        position: 0,
        duration: 0,
        startedAt: null,
      },
    };

    this.rooms.set(code, room);
    this.persistRooms();
    this.saveSession({
      roomCode: code,
      roomId: room.id,
      userId: adminId,
      role: 'admin',
      displayName: trimmedAdmin,
      savedAt: Date.now(),
    });

    return { room, adminUser };
  }

  /**
   * Joins an existing Room as Listener.
   */
  public joinRoom(code: string, displayName: string): { room: Room; listenerUser: User } {
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      throw new Error('Please enter your name');
    }

    const validation = validateRoomCode(code);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Enter a valid 6-character room code');
    }

    const normalizedCode = normalizeRoomCode(code);
    const room = this.rooms.get(normalizedCode);

    if (!room) {
      throw new Error('Room not found');
    }

    const listenerId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const listenerUser: User = {
      id: listenerId,
      name: trimmedDisplayName,
      role: 'listener', // Enforce listener role
      joinedAt: Date.now(),
      isOnline: true,
      isSelf: true,
      avatarColor: 'from-sky-500 to-indigo-600',
      device: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
      driftMs: 0,
      isSynced: true,
    };

    // Add user to room
    const updatedUsers = [
      ...room.users.filter((u) => u.id !== listenerId).map((u) => ({ ...u, isSelf: false })),
      listenerUser,
    ];

    const updatedRoom: Room = {
      ...room,
      users: updatedUsers,
    };

    this.rooms.set(normalizedCode, updatedRoom);
    this.persistRooms();

    this.saveSession({
      roomCode: normalizedCode,
      roomId: room.id,
      userId: listenerId,
      role: 'listener',
      displayName: trimmedDisplayName,
      savedAt: Date.now(),
    });

    return { room: updatedRoom, listenerUser };
  }

  /**
   * Retrieves a room by its 6-character code or ID.
   */
  public getRoom(codeOrId: string): Room | null {
    const normalized = normalizeRoomCode(codeOrId);
    if (this.rooms.has(normalized)) {
      return this.rooms.get(normalized)!;
    }

    for (const room of this.rooms.values()) {
      if (room.id === codeOrId || room.code === normalized) {
        return room;
      }
    }
    return null;
  }

  /**
   * Retrieves all available rooms.
   */
  public getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Marks a user as disconnected / leaves the room.
   * Does NOT delete the room.
   */
  public leaveRoom(roomId: string, userId: string): void {
    for (const [code, room] of this.rooms.entries()) {
      if (room.id === roomId || room.users.some((u) => u.id === userId)) {
        const updatedUsers = room.users.map((u) =>
          u.id === userId ? { ...u, isOnline: false } : u,
        );
        this.rooms.set(code, {
          ...room,
          users: updatedUsers,
        });
        this.persistRooms();
        break;
      }
    }
    this.clearSession();
  }

  /**
   * Updates room state (playback, queue, etc.).
   */
  public updateRoom(room: Room): void {
    this.rooms.set(room.code, room);
    this.persistRooms();
  }

  /**
   * Session persistence methods.
   */
  public saveSession(session: StoredSession): void {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignored
    }
  }

  public getStoredSession(): StoredSession | null {
    try {
      const stored =
        sessionStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as StoredSession;
      }
    } catch {
      // Fallback
    }
    return null;
  }

  public clearSession(): void {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignored
    }
  }

  /**
   * Attempts to restore an active room session on page refresh.
   */
  public restoreSession(): { room: Room; user: User } | null {
    const session = this.getStoredSession();
    if (!session) return null;

    const room = this.getRoom(session.roomCode);
    if (!room) {
      this.clearSession();
      return null;
    }

    // Find the user or reconstitute if session exists
    let user = room.users.find((u) => u.id === session.userId);
    if (!user) {
      // Re-add user as online
      user = {
        id: session.userId,
        name: session.displayName,
        role: session.role,
        joinedAt: session.savedAt,
        isOnline: true,
        isSelf: true,
        avatarColor:
          session.role === 'admin'
            ? 'from-amber-500 to-amber-700'
            : 'from-sky-500 to-indigo-600',
        device: 'desktop',
        driftMs: 0,
        isSynced: true,
      };
      room.users.push(user);
      this.updateRoom(room);
    } else {
      user.isOnline = true;
      user.isSelf = true;
      this.updateRoom(room);
    }

    return { room, user };
  }
}

export const roomStore = new RoomStore();
