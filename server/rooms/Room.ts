import { Track, QueueItem } from '../../src/types';
import { ServerUser, ClientRoomState, ClientUser, PlaybackState } from '../types';

export class Room {
  public id: string;
  public code: string;
  public name: string;
  public adminId: string;
  public createdAt: number;
  public users: Map<string, ServerUser>;
  public queue: QueueItem[];
  public currentTrack: Track | null;
  public isPlaying: boolean;
  public position: number; // in seconds
  public startedAt: number | null; // ms
  public startAt: number | null; // ms
  public serverTimestamp: number; // ms
  public version: number; // monotonic version
  public queueVersion: number; // monotonic queue revision
  private isAdvancingTrack: boolean = false; // transition lock to prevent race conditions
  private timer: NodeJS.Timeout | null = null;
  private onStateChange?: () => void;

  constructor(
    id: string,
    code: string,
    name: string,
    adminId: string,
    initialTrack?: Track | null,
    onStateChange?: () => void,
  ) {
    this.id = id;
    this.code = code;
    this.name = name;
    this.adminId = adminId;
    this.createdAt = Date.now();
    this.users = new Map();
    this.currentTrack = initialTrack !== undefined ? initialTrack : null;
    this.isPlaying = false;
    this.position = 0;
    this.startedAt = null;
    this.startAt = null;
    this.serverTimestamp = Date.now();
    this.version = 1;
    this.queueVersion = 1;
    this.onStateChange = onStateChange;
    this.queue = [];

    this.startPlaybackTicker();
  }

  public setOnStateChange(cb: () => void) {
    this.onStateChange = cb;
  }

  /**
   * Calculates the exact authoritative playback position at this millisecond.
   */
  public getCurrentCalculatedPosition(): number {
    if (!this.isPlaying || !this.currentTrack) {
      return this.position;
    }

    const now = Date.now();
    // If scheduled future start has not arrived yet, we remain at base position
    if (this.startAt && now < this.startAt) {
      return this.position;
    }

    const origin = this.startedAt || this.startAt || now;
    const elapsed = Math.max(0, (now - origin) / 1000);
    return Math.min(this.position + elapsed, this.currentTrack.duration);
  }

  private startPlaybackTicker() {
    this.timer = setInterval(() => {
      if (!this.isPlaying || !this.currentTrack) return;

      const currentPos = this.getCurrentCalculatedPosition();

      // Check if song reached end
      if (currentPos >= this.currentTrack.duration) {
        this.nextTrack(800); // 800ms future scheduled start for next track
      }
    }, 1000);
    this.timer.unref();
  }

  public destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPlaying = false;
    this.startAt = null;
    this.startedAt = null;
    this.onStateChange = undefined;
  }

  public addUser(user: ServerUser) {
    this.users.set(user.id, user);
  }

  public getUser(userId: string): ServerUser | undefined {
    return this.users.get(userId);
  }

  public removeUser(userId: string) {
    this.users.delete(userId);
  }

  public updateUserStatus(userId: string, connected: boolean) {
    const user = this.users.get(userId);
    if (user) {
      user.connected = connected;
      user.lastSeen = Date.now();
    }
  }

  /**
   * ADMIN PLAY: Schedules future start time so all network clients synchronize cleanly.
   * Returns false if no track or if playback is not available / provider not configured.
   */
  public play(futureBufferMs = 600): boolean {
    if (!this.currentTrack) return false;
    if (this.currentTrack.playbackStatus && this.currentTrack.playbackStatus !== 'AVAILABLE') {
      return false;
    }
    const now = Date.now();
    this.position = this.getCurrentCalculatedPosition();
    this.startAt = now + futureBufferMs;
    this.startedAt = this.startAt;
    this.isPlaying = true;
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
    return true;
  }

  /**
   * ADMIN PAUSE: Freezes playback at authoritative current position.
   */
  public pause() {
    const now = Date.now();
    this.position = this.getCurrentCalculatedPosition();
    this.isPlaying = false;
    this.startAt = null;
    this.startedAt = null;
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  /**
   * ADMIN SEEK: Calculates new position and schedules future restart if playing.
   */
  public seek(targetPosition: number, futureBufferMs = 500) {
    if (typeof targetPosition !== 'number' || !Number.isFinite(targetPosition) || targetPosition < 0) {
      return;
    }
    const maxDur = this.currentTrack?.duration || 0;
    const clamped = Math.max(0, Math.min(targetPosition, maxDur));
    const now = Date.now();
    this.position = clamped;

    if (this.isPlaying) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
    } else {
      this.startAt = null;
      this.startedAt = null;
    }

    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  /**
   * ADMIN NEXT: Switches track and schedules synchronized start for all clients.
   * Uses server-side transition lock to prevent race conditions when multiple triggers occur.
   */
  public nextTrack(futureBufferMs = 700): boolean {
    if (this.isAdvancingTrack) return false;
    this.isAdvancingTrack = true;

    try {
      const now = Date.now();

      if (this.queue.length > 0) {
        const nextItem = this.queue.shift()!;
        this.currentTrack = nextItem.track;
        this.queueVersion++;
      } else {
        // No more tracks in queue — stop playback
        this.currentTrack = null;
        this.isPlaying = false;
        this.startAt = null;
        this.startedAt = null;
      }

      this.position = 0;

      const canPlay = this.currentTrack?.playbackStatus === 'AVAILABLE';
      if (this.isPlaying && canPlay) {
        this.startAt = now + futureBufferMs;
        this.startedAt = this.startAt;
      } else {
        this.isPlaying = false;
        this.startAt = null;
        this.startedAt = null;
      }

      this.serverTimestamp = now;
      this.version++;
      this.onStateChange?.();
      return true;
    } finally {
      this.isAdvancingTrack = false;
    }
  }

  /**
   * ADMIN PREVIOUS: Restarts track or steps backward in catalog.
   */
  public previousTrack(futureBufferMs = 700) {
    const now = Date.now();
    const currentPos = this.getCurrentCalculatedPosition();

    if (currentPos > 3) {
      // Restart current track from beginning
      this.position = 0;
    } else {
      // Already at start — no previous track history to go back to, just restart
      this.position = 0;
    }

    if (this.isPlaying) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
    } else {
      this.startAt = null;
      this.startedAt = null;
    }

    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  public addToQueue(track: Track, user: ServerUser) {
    const item: QueueItem = {
      id: `q-srv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      track,
      addedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
      addedAt: Date.now(),
    };

    if (this.queue.length >= 500) {
      return null;
    }

    if (!this.currentTrack) {
      this.currentTrack = track;
      this.position = 0;
      this.isPlaying = false;
      this.version++;
    } else {
      this.queue.push(item);
      this.queueVersion++;
    }

    this.onStateChange?.();
    return item;
  }

  public importQueue(tracks: Track[], user: ServerUser, replace = false) {
    const now = Date.now();
    const items: QueueItem[] = tracks.map((track, i) => ({
      id: `q-srv-${now}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      track,
      addedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
      addedAt: now + i,
    }));

    if (replace) {
      this.queue = items.slice(0, 500);
      this.queueVersion++;
      if (!this.currentTrack && this.queue.length > 0) {
        const first = this.queue.shift()!;
        this.currentTrack = first.track;
        this.position = 0;
        const canPlay = first.track.playbackStatus === 'AVAILABLE';
        this.startAt = canPlay ? now + 600 : null;
        this.startedAt = canPlay ? this.startAt : null;
        this.isPlaying = canPlay;
      }
    } else {
      const remainingSlots = Math.max(0, 500 - this.queue.length);
      this.queue.push(...items.slice(0, remainingSlots));
      this.queueVersion++;
      if (!this.currentTrack && this.queue.length > 0) {
        const first = this.queue.shift()!;
        this.currentTrack = first.track;
        this.position = 0;
        const canPlay = first.track.playbackStatus === 'AVAILABLE';
        this.startAt = canPlay ? now + 600 : null;
        this.startedAt = canPlay ? this.startAt : null;
        this.isPlaying = canPlay;
      }
    }

    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  public removeFromQueue(queueItemId: string): boolean {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter((q) => q.id !== queueItemId);
    const changed = this.queue.length !== initialLen;
    if (changed) {
      this.queueVersion++;
      this.onStateChange?.();
    }
    return changed;
  }

  public reorderQueue(orderedIds: string[]): boolean {
    const map = new Map(this.queue.map((q) => [q.id, q]));
    const nextQueue: QueueItem[] = [];
    for (const id of orderedIds) {
      const item = map.get(id);
      if (item) {
        nextQueue.push(item);
        map.delete(id);
      }
    }
    // Append any items that weren't in orderedIds
    for (const item of map.values()) {
      nextQueue.push(item);
    }
    this.queue = nextQueue;
    this.queueVersion++;
    this.onStateChange?.();
    return true;
  }

  public clearQueue(): void {
    this.queue = [];
    this.queueVersion++;
    this.onStateChange?.();
  }

  public selectTrack(trackId: string, futureBufferMs = 600) {
    const now = Date.now();
    // Check if in queue
    const queueIndex = this.queue.findIndex((q) => q.track.id === trackId || q.id === trackId);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      this.currentTrack = item.track;
      this.queueVersion++;
    } else {
      // Track not found in queue — do not fall back to mock data
      return;
    }

    this.position = 0;
    const canPlay = this.currentTrack?.playbackStatus === 'AVAILABLE';
    if (canPlay) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
      this.isPlaying = true;
    } else {
      this.isPlaying = false;
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  public setCurrentTrack(track: Track, autoplay = true, futureBufferMs = 600) {
    const now = Date.now();
    this.currentTrack = track;
    this.position = 0;
    const canPlay = track.playbackStatus === 'AVAILABLE';
    if (autoplay && canPlay) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
      this.isPlaying = true;
    } else {
      this.isPlaying = false;
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }

  public rename(newName: string) {
    this.name = newName.trim();
  }

  public toPlaybackState(): PlaybackState {
    return {
      trackId: this.currentTrack ? this.currentTrack.id : null,
      isPlaying: this.isPlaying,
      position: this.getCurrentCalculatedPosition(),
      serverTimestamp: Date.now(),
      startedAt: this.startedAt,
      startAt: this.startAt,
      duration: this.currentTrack ? this.currentTrack.duration : 0,
      version: this.version,
    };
  }

  public toClientState(selfUserId?: string): ClientRoomState {
    const clientUsers: ClientUser[] = Array.from(this.users.values()).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      joinedAt: u.lastSeen,
      isOnline: u.connected,
      isSelf: selfUserId ? u.id === selfUserId : false,
      device: u.device || 'desktop',
      driftMs: u.driftMs || 0,
    }));

    return {
      id: this.id,
      code: this.code,
      name: this.name,
      adminId: this.adminId,
      createdAt: this.createdAt,
      users: clientUsers,
      currentTrack: this.currentTrack,
      queue: [...this.queue],
      queueVersion: this.queueVersion,
      playerState: this.toPlaybackState(),
    };
  }
}
