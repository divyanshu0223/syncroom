
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Room, User, Track, QueueItem, AppView, ConnectionStatusType, ActivityItem } from '../types';
import { socketService, SocketStatus } from '../services/socket';
import { ServerMessage, PlaybackState } from '../../server/types';
import { useToast } from './ToastContext';
import { syncEngine } from '../audio/SyncEngine';
import { audioEngine } from '../audio/AudioEngine';
import { playbackManager } from '../audio/PlaybackProvider';
import { spotifyPlaybackProvider } from '../audio/SpotifyPlaybackProvider';
import { youtubePlaybackProvider } from '../audio/YouTubePlaybackProvider';
import { youtubeMusicProvider } from '../services/music/YouTubeMusicProvider';
import { spotifyMusicProvider } from '../services/music/SpotifyMusicProvider';
import { serverClock } from '../services/serverClock';
import { saveSession, getSession, clearSession } from '../services/session';
import { getApiBaseUrl, getRuntimeConfig } from '../config/runtime';

interface RoomContextType {
  currentRoom: Room | null;
  currentUser: User | null;
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  connectionStatus: ConnectionStatusType;
  socketStatus: SocketStatus;
  isLoading: boolean;
  error: string | null;
  createdRoomNotice: { room: Room; adminUser: User } | null;
  clearCreatedRoomNotice: () => void;
  createRoom: (name: string, adminName: string) => Promise<Room>;
  joinRoom: (code: string, displayName: string) => Promise<Room>;
  leaveRoom: () => void;
  // Guarded server commands
  playPause: () => void;
  seek: (position: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  selectTrack: (trackId: string) => void;
  addToQueue: (track: Track) => void;
  importQueue: (tracks: Track[], replace?: boolean) => void;
  removeFromQueue: (id: string) => void;
  reorderQueue: (orderedIds: string[]) => void;
  clearQueue: () => void;
  playNow: (item: QueueItem) => void;
  playTrackWithProvider: (track: Track, provider: 'spotify' | 'youtube') => Promise<void>;
  switchCurrentTrackProvider: (targetProvider: 'spotify' | 'youtube') => Promise<void>;
  moveQueueUp: (index: number) => void;
  moveQueueDown: (index: number) => void;
  removeUser: (userId: string) => void;
  renameRoom: (newName: string) => void;
  endRoom: () => void;
  activities: ActivityItem[];
  loadActivities: () => void;
  clearError: () => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<AppView>('landing');
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('disconnected');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [createdRoomNotice, setCreatedRoomNotice] = useState<{ room: Room; adminUser: User } | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Pending room join / create promise resolvers
  const pendingActionRef = useRef<{
    resolve: (room: Room) => void;
    reject: (err: Error) => void;
  } | null>(null);

  // Refs to track latest state values so useEffect handlers avoid stale closures
  const currentRoomRef = useRef(currentRoom);
  currentRoomRef.current = currentRoom;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const lastQueueVersionRef = useRef<number>(0);
  const isCreatingRef = useRef<boolean>(false);

  // Real measured Connection Quality:
  const [connectionQuality, setConnectionQuality] = useState<ConnectionStatusType>('connected');

  useEffect(() => {
    const updateQuality = () => {
      const q = socketService.getConnectionQuality();
      setConnectionQuality(q);
    };

    updateQuality();
    const unsub = socketService.onStatusChange(updateQuality);
    return () => {
      unsub();
    };
  }, []);

  // Initialize Spotify Playback Provider on mount
  useEffect(() => {
    spotifyPlaybackProvider.initialize().catch((err) => {
      console.warn('[RoomContext] Spotify player init notice:', err);
    });
  }, []);

  // Convert SocketStatus to UI ConnectionStatusType
  const connectionStatus: ConnectionStatusType =
    socketStatus === 'config_error'
      ? 'config_error'
      : socketStatus === 'disconnected'
        ? 'offline'
        : socketStatus === 'reconnecting'
          ? 'reconnecting'
          : connectionQuality;

  // Real-time client tick interpolation when playing (paused when tab hidden for performance)
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setCurrentRoom((prev) => {
        if (!prev || !prev.playerState.isPlaying || !prev.currentTrack) return prev;
        const nextPos = prev.playerState.position + 1;
        if (nextPos >= prev.currentTrack.duration) {
          return prev; // Server authority handles track skip broadcast
        }
        return {
          ...prev,
          playerState: {
            ...prev.playerState,
            position: nextPos,
          },
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Network and Background/Foreground lifecycle handling (Item 7 & 8)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      // Network returned: reconnect socket and restore room state
      if (socketService.getStatus() !== 'connected') {
        socketService.connect();
      } else {
        const stored = getSession();
        if (stored && stored.sessionToken) {
          socketService.send({
            type: 'RECONNECT_SESSION',
            sessionToken: stored.sessionToken,
            sessionId: stored.sessionToken,
          });
        }
      }
    };

    const handleOffline = () => {
      // Device lost internet connection: socketService handles this authoritatively
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // App returned to foreground / screen unlocked / PWA reopened
        if (socketService.getStatus() !== 'connected') {
          socketService.connect();
        } else {
          const stored = getSession();
          if (stored && stored.sessionToken && currentRoomRef.current) {
            socketService.send({
              type: 'RECONNECT_SESSION',
              sessionToken: stored.sessionToken,
              sessionId: stored.sessionToken,
            });
          }
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Initialize socket and listen to messages
  useEffect(() => {
    socketService.connect();

    const unsubStatus = socketService.onStatusChange((status) => {
      setSocketStatus(status);

      // Attempt reconnection whenever socket becomes connected (Item 7)
      if (status === 'connected') {
        const stored = getSession();
        if (stored && stored.sessionToken) {
          socketService.send({
            type: 'RECONNECT_SESSION',
            sessionToken: stored.sessionToken,
            sessionId: stored.sessionToken,
          });
        }
      }
    });

    const unsubMessages = socketService.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'ROOM_CREATED': {
          const token = msg.sessionToken || msg.sessionId;
          saveSession({
            sessionToken: token,
            userId: msg.user.id,
            roomId: msg.room.id,
            roomCode: msg.room.code,
            role: msg.user.role,
            userName: msg.user.name,
          });
          lastQueueVersionRef.current = msg.room.queueVersion || 1;
          setCurrentRoom(msg.room);
          setCurrentUser(msg.user);
          setCreatedRoomNotice({ room: msg.room, adminUser: msg.user });
          setActiveView('room');

          if (msg.room.playerState) {
            syncEngine.handlePlaybackState(msg.room.playerState);
          }

          if (pendingActionRef.current) {
            pendingActionRef.current.resolve(msg.room);
            pendingActionRef.current = null;
          }

          showToastRef.current({
            type: 'success',
            title: 'Room Created!',
            description: `Room code: ${msg.room.code}. You are the session Host.`,
          });
          break;
        }

        case 'ROOM_JOINED': {
          const token = msg.sessionToken || msg.sessionId;
          saveSession({
            sessionToken: token,
            userId: msg.user.id,
            roomId: msg.room.id,
            roomCode: msg.room.code,
            role: msg.user.role,
            userName: msg.user.name,
          });
          lastQueueVersionRef.current = msg.room.queueVersion || 1;
          setCurrentRoom(msg.room);
          setCurrentUser(msg.user);
          setActiveView('room');

          // Log exact room state received through WebSocket
          const joinedTrackId = msg.room.currentTrack?.id || msg.room.playerState?.trackId || 'none';
          const joinedTrackUri = joinedTrackId !== 'none' ? `spotify:track:${joinedTrackId.replace(/^spotify-/, '')}` : 'none';
          const joinedPaused = !(msg.room.playerState?.isPlaying);
          const joinedPosMs = Math.round((msg.room.playerState?.position || 0) * 1000);
          const joinedTs = msg.room.playerState?.serverTimestamp || Date.now();
          const joinedQueueVer = msg.room.queueVersion || 1;
          console.log(
            `[ROOM_STATE_RECEIVED] trackId=${joinedTrackId} trackUri=${joinedTrackUri} paused=${joinedPaused} positionMs=${joinedPosMs} timestamp=${joinedTs} queueVersion=${joinedQueueVer}`
          );

          // Trace member playback lifecycle and verify Spotify session
          spotifyPlaybackProvider.logMemberPlaybackLifecycle('ROOM_JOINED');
          spotifyPlaybackProvider.initialize().catch((err) => {
            console.warn('[RoomContext] Member Spotify init notice:', err);
          });

          if (msg.room.playerState) {
            syncEngine.handlePlaybackState(msg.room.playerState);
          }

          if (pendingActionRef.current) {
            pendingActionRef.current.resolve(msg.room);
            pendingActionRef.current = null;
          }

          showToastRef.current({
            type: 'success',
            title: `Joined ${msg.room.name}`,
            description: `Connected as listener (${msg.room.code})`,
          });
          break;
        }

        case 'ROOM_STATE': {
          const token = msg.sessionToken || msg.sessionId;
          saveSession({
            sessionToken: token,
            userId: msg.user.id,
            roomId: msg.room.id,
            roomCode: msg.room.code,
            role: msg.user.role,
            userName: msg.user.name,
          });
          lastQueueVersionRef.current = msg.room.queueVersion || 1;
          setCurrentRoom(msg.room);
          setCurrentUser(msg.user);
          setActiveView('room');
          setIsLoading(false);

          // Log exact room state received through WebSocket
          const stateTrackId = msg.room.currentTrack?.id || msg.room.playerState?.trackId || 'none';
          const stateTrackUri = stateTrackId !== 'none' ? `spotify:track:${stateTrackId.replace(/^spotify-/, '')}` : 'none';
          const statePaused = !(msg.room.playerState?.isPlaying);
          const statePosMs = Math.round((msg.room.playerState?.position || 0) * 1000);
          const stateTs = msg.room.playerState?.serverTimestamp || Date.now();
          const stateQueueVer = msg.room.queueVersion || 1;
          console.log(
            `[ROOM_STATE_RECEIVED] trackId=${stateTrackId} trackUri=${stateTrackUri} paused=${statePaused} positionMs=${statePosMs} timestamp=${stateTs} queueVersion=${stateQueueVer}`
          );

          // Trace member playback lifecycle and verify Spotify session
          spotifyPlaybackProvider.logMemberPlaybackLifecycle('ROOM_STATE');
          spotifyPlaybackProvider.initialize().catch((err) => {
            console.warn('[RoomContext] Member Spotify init notice:', err);
          });

          if (msg.room.currentTrack?.provider === 'youtube') {
            playbackManager.setProvider(youtubePlaybackProvider);
            youtubePlaybackProvider.initialize().catch(() => {});
          } else if (msg.room.currentTrack?.provider === 'spotify') {
            playbackManager.setProvider(spotifyPlaybackProvider);
          }

          if (msg.room.playerState) {
            syncEngine.handlePlaybackState(msg.room.playerState);
          }

          showToastRef.current({
            type: 'info',
            title: `Reconnected to ${msg.room.name}`,
            description: `Session restored (${msg.user.role === 'admin' ? 'Host' : 'Listener'})`,
          });
          break;
        }

        case 'USER_JOINED': {
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            const existing = prev.users.some((u) => u.id === msg.user.id);
            const nextUsers = existing
              ? prev.users.map((u) => (u.id === msg.user.id ? msg.user : u))
              : [...prev.users, msg.user];
            return { ...prev, users: nextUsers };
          });

          showToastRef.current({
            type: 'info',
            title: 'Participant Joined',
            description: `${msg.user.name} joined the room`,
          });
          break;
        }

        case 'USER_LEFT': {
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              users: prev.users.filter((u) => u.id !== msg.userId),
            };
          });
          break;
        }

        case 'USER_UPDATED': {
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              users: prev.users.map((u) => (u.id === msg.user.id ? msg.user : u)),
            };
          });
          break;
        }

        case 'PLAYBACK_CHANGED':
        case 'PLAYBACK_STATE': {
          let state: PlaybackState;
          if ('state' in msg && msg.state) {
            state = msg.state;
          } else if (msg.type === 'PLAYBACK_STATE') {
            const trackDur =
              currentRoom?.queue.find((q) => q.track.id === msg.currentTrackId)?.track.duration ||
              currentRoom?.currentTrack?.duration ||
              0;
            state = {
              trackId: msg.currentTrackId !== undefined ? msg.currentTrackId : null,
              isPlaying: !!msg.isPlaying,
              position: msg.position ?? 0,
              serverTimestamp: Date.now(),
              startedAt: msg.startedAt ?? null,
              startAt: null,
              duration: trackDur,
              version: 1,
            };
          } else {
            break;
          }

          // Log playback state received through WebSocket
          const pbTrackId = state.trackId || currentRoomRef.current?.currentTrack?.id || 'none';
          const pbTrackUri = pbTrackId !== 'none' ? `spotify:track:${pbTrackId.replace(/^spotify-/, '')}` : 'none';
          const pbPaused = !state.isPlaying;
          const pbPosMs = Math.round((state.position || 0) * 1000);
          const pbTs = state.serverTimestamp || Date.now();
          const pbQueueVer = currentRoomRef.current?.queueVersion || lastQueueVersionRef.current || state.version || 1;
          console.log(
            `[ROOM_STATE_RECEIVED] trackId=${pbTrackId} trackUri=${pbTrackUri} paused=${pbPaused} positionMs=${pbPosMs} timestamp=${pbTs} queueVersion=${pbQueueVer}`
          );

          syncEngine.handlePlaybackState(state);

          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              playerState: {
                ...prev.playerState,
                ...state,
              },
            };
          });
          break;
        }

        case 'QUEUE_CHANGED':
        case 'QUEUE_UPDATED': {
          if (msg.queueVersion !== undefined) {
            if (msg.queueVersion < lastQueueVersionRef.current) {
              // Stale out-of-order queue update - reject!
              break;
            }
            lastQueueVersionRef.current = msg.queueVersion;
          }

          const nextTrack = msg.currentTrack !== undefined ? msg.currentTrack : currentRoomRef.current?.currentTrack;
          if (nextTrack) {
            if (nextTrack.provider === 'youtube' && playbackManager.getProvider().id !== 'youtube') {
              playbackManager.setProvider(youtubePlaybackProvider);
              youtubePlaybackProvider.initialize().catch(() => {});
            } else if (nextTrack.provider === 'spotify' && playbackManager.getProvider().id !== 'spotify') {
              playbackManager.setProvider(spotifyPlaybackProvider);
            }
          }

          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              queue: msg.queue,
              queueVersion: msg.queueVersion ?? prev.queueVersion,
              currentTrack: msg.currentTrack !== undefined ? msg.currentTrack : prev.currentTrack,
            };
          });
          break;
        }

        case 'ROOM_UPDATED': {
          setCurrentRoom(msg.room);
          showToastRef.current({
            type: 'info',
            title: 'Room Updated',
            description: `Room updated to "${msg.room.name}"`,
          });
          break;
        }

        case 'ROOM_ENDED': {
          syncEngine.stop();
          clearSession();
          setCurrentRoom(null);
          setCurrentUser(null);
          setActiveView('landing');
          showToastRef.current({
            type: 'info',
            title: 'Room Ended',
            description: msg.message || 'Room ended by the admin.',
          });
          break;
        }

        case 'USER_REMOVED': {
          const latestUser = currentUserRef.current;
          if (latestUser && msg.userId === latestUser.id) {
            syncEngine.stop();
            clearSession();
            setCurrentRoom(null);
            setCurrentUser(null);
            setActiveView('landing');
            showToastRef.current({
              type: 'error',
              title: 'Removed From Room',
              description: msg.message || 'You were removed from this room by the admin.',
            });
          } else {
            setCurrentRoom((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                users: prev.users.filter((u) => u.id !== msg.userId),
              };
            });
          }
          break;
        }

        case 'ACTIVITIES_LOADED': {
          setActivities(msg.activities || []);
          break;
        }

        case 'ERROR': {
          setIsLoading(false);
          setError(msg.message);

          if (pendingActionRef.current) {
            pendingActionRef.current.reject(new Error(msg.message));
            pendingActionRef.current = null;
          }

          if (msg.code === 'SESSION_NOT_FOUND' || msg.code === 'INVALID_SESSION' || msg.code === 'USER_REMOVED' || msg.code === 'ROOM_NOT_FOUND') {
            clearSession();
            setCurrentRoom(null);
            setCurrentUser(null);
            setActiveView('landing');
          }

          showToastRef.current({
            type: 'error',
            title:
              msg.code === 'FORBIDDEN'
                ? 'Access Denied'
                : msg.code === 'RATE_LIMITED'
                ? 'Slow Down'
                : msg.code === 'DATABASE_NOT_CONFIGURED'
                ? 'Database Not Configured'
                : msg.code === 'DATABASE_ERROR'
                ? 'Database Error'
                : 'Error',
            description: msg.message,
          });
          break;
        }
      }
    });

    const unsubError = socketService.onError((err) => {
      setError(err.message);
      showToastRef.current({
        type: 'error',
        title: err.code === 'INSECURE_WEBSOCKET_IN_PRODUCTION' ? 'Security Configuration Error' : 'Connection Error',
        description: err.message,
      });
    });

    setIsLoading(false);

    return () => {
      unsubStatus();
      unsubMessages();
      unsubError();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const createRoom = async (name: string, adminName: string): Promise<Room> => {
    if (isCreatingRef.current) {
      console.warn('[ROOM_CREATE] Ignored duplicate createRoom invocation while previous request is pending.');
      throw new Error('Room creation already in progress.');
    }
    isCreatingRef.current = true;

    const tClick = performance.now();
    console.log('[ROOM_CREATE] frontend_click');
    setError(null);

    const device = typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop';
    const apiBaseUrl = getApiBaseUrl();
    const runtimeConfig = getRuntimeConfig();

    try {
      // 0. Pre-flight check: If no backend is configured at all (e.g. static GitHub Pages without VITE_API_URL)
      if (!apiBaseUrl && (!runtimeConfig.wsUrl || runtimeConfig.configurationError)) {
        const msg =
          runtimeConfig.configurationError ||
          'Unable to reach the SyncRoom server. No backend server configured (VITE_API_URL is missing).';
        setError(msg);
        throw new Error(msg);
      }

      // 1. Fast-Path: REST API Creation (decoupled from WebSocket connection state)
      if (apiBaseUrl) {
        console.log('[ROOM_CREATE] api_request_start');
        const tApiStart = performance.now();

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const res = await fetch(`${apiBaseUrl}/api/rooms`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ name, adminName, device }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            const apiDurationMs = Math.round(performance.now() - tApiStart);
            console.log(`[ROOM_CREATE] api_response_received durationMs=${apiDurationMs} status=${res.status}`);

            const room: Room = data.room;
            const user: User = data.user;
            const sessionToken = data.sessionToken || data.sessionId;

            // Save persistent session immediately
            saveSession({
              sessionToken,
              userId: user.id,
              roomId: room.id,
              roomCode: room.code,
              role: user.role,
              userName: user.name,
            });

            lastQueueVersionRef.current = room.queueVersion || 1;
            setCurrentRoom(room);
            setCurrentUser(user);
            setCreatedRoomNotice({ room, adminUser: user });
            setActiveView('room');

            if (room.playerState) {
              syncEngine.handlePlaybackState(room.playerState as any);
            }

            showToastRef.current({
              type: 'success',
              title: 'Room Created!',
              description: `Room code: ${room.code}. You are the session Host.`,
            });

            // Decoupled Background WebSocket connection & sync (never blocks room view)
            (async () => {
              console.log('[ROOM_CREATE] websocket_init_start');
              const tWsStart = performance.now();
              try {
                if (socketService.getStatus() !== 'connected') {
                  await socketService.connect();
                }
                socketService.send({
                  type: 'RECONNECT_SESSION',
                  sessionToken,
                  sessionId: sessionToken,
                });
                const wsDurationMs = Math.round(performance.now() - tWsStart);
                console.log(`[ROOM_CREATE] websocket_init_end durationMs=${wsDurationMs}`);
              } catch (wsErr) {
                console.warn('[ROOM_CREATE] Background WebSocket attach failed (will reconnect automatically):', wsErr);
              }
            })();

            return room;
          } else {
            const errData = await res.json().catch(() => null);
            const errMsg = errData?.error || `HTTP ${res.status}: Failed to create room`;
            console.warn('[ROOM_CREATE] REST endpoint returned non-200, attempting WebSocket fallback:', errMsg);
            if (res.status === 400 || res.status === 429) {
              setError(errMsg);
              throw new Error(errMsg);
            }
          }
        } catch (fetchErr: any) {
          if (fetchErr?.name === 'AbortError') {
            console.warn('[ROOM_CREATE] REST request timed out, falling back to WebSocket path');
          } else if (
            fetchErr?.message &&
            (fetchErr.message.includes('already in progress') || fetchErr.message.includes('required'))
          ) {
            throw fetchErr;
          } else {
            console.warn('[ROOM_CREATE] REST request failed, falling back to WebSocket:', fetchErr?.message);
          }
        }
      }

      // 2. Fallback: WebSocket CREATE_ROOM path
      if (!runtimeConfig.wsUrl || runtimeConfig.configurationError) {
        const msg =
          runtimeConfig.configurationError ||
          'Unable to reach the SyncRoom server. Please check your backend connection.';
        setError(msg);
        throw new Error(msg);
      }

      console.log('[ROOM_CREATE] falling back to WebSocket CREATE_ROOM');
      if (socketService.getStatus() !== 'connected') {
        try {
          await socketService.connect();
        } catch (connErr) {
          const errMsg = 'Unable to reach the SyncRoom server. Please verify your backend server is online and try again.';
          setError(errMsg);
          throw new Error(errMsg);
        }
      }

      return await new Promise<Room>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (pendingActionRef.current) {
            pendingActionRef.current = null;
            const timeoutErr = new Error('Unable to reach the SyncRoom server. Room creation timed out.');
            setError(timeoutErr.message);
            reject(timeoutErr);
          }
        }, 10000);

        pendingActionRef.current = {
          resolve: (room) => {
            clearTimeout(timeoutId);
            resolve(room);
          },
          reject: (err) => {
            clearTimeout(timeoutId);
            reject(err);
          },
        };

        const sent = socketService.send({
          type: 'CREATE_ROOM',
          name,
          adminName,
          device,
        });

        if (!sent) {
          clearTimeout(timeoutId);
          pendingActionRef.current = null;
          const err = new Error('WebSocket connection unavailable. Unable to send create room request.');
          setError(err.message);
          reject(err);
        }
      });
    } finally {
      isCreatingRef.current = false;
    }
  };

  const joinRoom = async (code: string, displayName: string): Promise<Room> => {
    setError(null);

    const runtimeConfig = getRuntimeConfig();
    if (!runtimeConfig.wsUrl || runtimeConfig.configurationError) {
      const msg =
        runtimeConfig.configurationError ||
        'Unable to join room: No backend server configured.';
      setError(msg);
      throw new Error(msg);
    }

    if (socketService.getStatus() !== 'connected') {
      try {
        await socketService.connect();
      } catch (connErr) {
        const errMsg = 'Unable to connect to the SyncRoom server. Please verify your backend server is online.';
        setError(errMsg);
        throw new Error(errMsg);
      }
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pendingActionRef.current) {
          pendingActionRef.current = null;
          const timeoutErr = new Error('Unable to reach the SyncRoom server. Join request timed out.');
          setError(timeoutErr.message);
          reject(timeoutErr);
        }
      }, 10000);

      pendingActionRef.current = {
        resolve: (room) => {
          clearTimeout(timeoutId);
          resolve(room);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      };

      const sent = socketService.send({
        type: 'JOIN_ROOM',
        code,
        displayName,
        device: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
      });

      if (!sent) {
        clearTimeout(timeoutId);
        pendingActionRef.current = null;
        const err = new Error('WebSocket connection unavailable');
        setError(err.message);
        reject(err);
      }
    });
  };

  const leaveRoom = () => {
    syncEngine.stop();
    socketService.send({ type: 'LEAVE_ROOM' });
    clearSession();

    if (currentRoom) {
      showToast({
        type: 'info',
        title: 'Left Room',
        description: `Disconnected from ${currentRoom.name}`,
      });
    }

    setCurrentRoom(null);
    setCurrentUser(null);
    setActiveView('landing');
  };

  // Authoritative Playback commands to server
  const playPause = async () => {
    if (!currentRoom) return;
    const provider = playbackManager.getProvider();

    // 0. Only ADMIN can control room playback
    if (currentUser?.role !== 'admin') {
      showToast({
        type: 'error',
        title: 'Admin Only',
        description: 'Only the room host can control playback.',
      });
      return;
    }

    if (currentRoom.playerState.isPlaying) {
      if (provider.id === 'spotify' || provider.id === 'youtube') {
        provider.pause();
      }
      socketService.send({ type: 'ADMIN_PAUSE' });
      return;
    }

    // 1. Track exists
    const track = currentRoom.currentTrack;
    if (!track) {
      showToast({
        type: 'error',
        title: 'Cannot Play',
        description: 'No track selected or queue is empty.',
      });
      return;
    }

    // If track is YouTube, handle independently without requiring Spotify connection
    if (track.provider === 'youtube') {
      if (playbackManager.getProvider().id !== 'youtube') {
        playbackManager.setProvider(youtubePlaybackProvider);
      }
      try {
        await youtubePlaybackProvider.initialize();
        await youtubePlaybackProvider.loadTrack(track, currentRoom.playerState.position);
        youtubePlaybackProvider.unMute();
        await youtubePlaybackProvider.setVolume(100);
        await youtubePlaybackProvider.play();
      } catch (err: unknown) {
        console.warn('[playPause] YouTube playback error (proceeding with room sync):', err);
      }
      socketService.send({ type: 'ADMIN_PLAY' });
      return;
    }

    // 2. Track is supported by configured PlaybackProvider
    const trackCheck = playbackManager.canPlayTrack(track);
    if (!trackCheck.canPlay) {
      showToast({
        type: 'error',
        title: 'Playback Unavailable',
        description: trackCheck.reason,
      });
      return;
    }

    // 3. Playback provider is initialized & configured
    if (!provider.isConfigured) {
      if (
        provider.id === 'spotify' &&
        'waitForDevice' in provider &&
        typeof (provider as any).waitForDevice === 'function' &&
        (provider.getStatus() === 'CONNECTING_PLAYER' || provider.getStatus() === 'INITIALIZING')
      ) {
        await (provider as any).waitForDevice(3000);
      }
    }

    if (!provider.isConfigured) {
      const status = provider.getStatus();
      let title = 'Playback Not Ready';
      let description = provider.getErrorMessage?.() || 'Audio playback provider is not ready.';

      if (status === 'CONNECT_SPOTIFY' || status === 'AUTH_REQUIRED') {
        title = 'Spotify Connect Required';
        description = 'Please connect your Spotify account to enable audio playback.';
      } else if (status === 'PREMIUM_REQUIRED') {
        title = 'Spotify Premium Required';
        description = 'Spotify Web Playback SDK requires a Spotify Premium subscription to stream audio.';
      } else if (status === 'CONNECTING_PLAYER' || status === 'INITIALIZING') {
        title = 'Player Connecting';
        description = 'Spotify web player is connecting. Please wait a moment.';
      } else if (status === 'DEVICE_NOT_READY') {
        title = 'Device Not Ready';
        description = 'Spotify player device is still connecting. Please wait a moment.';
      } else if (status === 'AUTOPLAY_BLOCKED') {
        title = 'Autoplay Blocked';
        description = 'Click Play to start Spotify audio.';
      } else if (status === 'PROVIDER_UNAVAILABLE') {
        title = 'Provider Unavailable';
        description = 'Audio playback provider is not configured.';
      }

      showToast({
        type: 'error',
        title,
        description,
      });
      return;
    }

    // 4. Audio resource is available
    if (track.playbackStatus !== 'AVAILABLE') {
      showToast({
        type: 'error',
        title: 'Audio Resource Unavailable',
        description: track.restrictionReason
          ? `Track restricted by Spotify (${track.restrictionReason}).`
          : 'Audio resource is not available for this track.',
      });
      return;
    }

    // 5. If provider is Spotify, load track into Spotify player
    if (provider.id === 'spotify') {
      try {
        if ('activateElement' in provider && typeof (provider as any).activateElement === 'function') {
          await (provider as any).activateElement();
        }
        await provider.loadTrack(track, currentRoom.playerState.position);
      } catch (err: unknown) {
        const msg = (err as Error)?.message || 'Failed to start Spotify playback';
        showToast({
          type: 'error',
          title: 'Playback Error',
          description: msg,
        });
        return;
      }
    } else {
      // Browser allows playback for HTML audio
      try {
        await audioEngine.unlock();
      } catch {
        showToast({
          type: 'error',
          title: 'Browser Playback Restricted',
          description: 'Click anywhere on the page to allow browser audio playback.',
        });
        return;
      }
    }

    socketService.send({ type: 'ADMIN_PLAY' });
  };

  const seek = (position: number) => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', title: 'Admin Only', description: 'Only the room host can seek playback.' });
      return;
    }
    const provider = playbackManager.getProvider();
    if ((provider.id === 'spotify' || provider.id === 'youtube') && provider.isConfigured) {
      provider.seek(position);
    }
    audioEngine.unlock().catch(() => {});
    socketService.send({ type: 'ADMIN_SEEK', position });
  };

  const nextTrack = () => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', title: 'Admin Only', description: 'Only the room host can skip tracks.' });
      return;
    }
    audioEngine.unlock().catch(() => {});
    socketService.send({ type: 'ADMIN_NEXT' });
  };

  const previousTrack = () => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', title: 'Admin Only', description: 'Only the room host can restart tracks.' });
      return;
    }
    audioEngine.unlock().catch(() => {});
    socketService.send({ type: 'ADMIN_PREVIOUS' });
  };

  const selectTrack = (trackId: string) => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', title: 'Admin Only', description: 'Only the room host can select tracks.' });
      return;
    }
    audioEngine.unlock().catch(() => {});
    socketService.send({ type: 'ADMIN_SELECT_TRACK', trackId });
  };

  const addToQueue = (track: Track) => {
    socketService.send({ type: 'ADMIN_ADD_QUEUE', track });
  };

  const importQueue = (tracks: Track[], replace = false) => {
    socketService.send({ type: 'ADMIN_IMPORT_QUEUE', tracks, replace });
  };

  const removeFromQueue = (queueItemId: string) => {
    socketService.send({ type: 'ADMIN_REMOVE_QUEUE', queueItemId });
  };

  const reorderQueue = (orderedIds: string[]) => {
    socketService.send({ type: 'ADMIN_REORDER_QUEUE', queueItemIds: orderedIds });
  };

  const clearQueue = () => {
    socketService.send({ type: 'ADMIN_CLEAR_QUEUE' });
  };

  const playNow = (item: QueueItem) => {
    if (item.track.provider === 'youtube' && playbackManager.getProvider().id !== 'youtube') {
      playbackManager.setProvider(youtubePlaybackProvider);
      youtubePlaybackProvider.initialize().catch(() => {});
    } else if (item.track.provider === 'spotify' && playbackManager.getProvider().id !== 'spotify') {
      playbackManager.setProvider(spotifyPlaybackProvider);
    }
    const playCheck = playbackManager.canPlayTrack(item.track);
    if (!playCheck.canPlay) {
      showToast({
        type: 'info',
        title: 'Metadata Selected',
        description: playCheck.reason,
      });
    }
    selectTrack(item.track.id);
  };

  const switchCurrentTrackProvider = async (targetProvider: 'spotify' | 'youtube') => {
    if (!currentRoom || !currentRoom.currentTrack) return;
    if (currentUser?.role !== 'admin') {
      showToast({
        type: 'error',
        title: 'Admin Only',
        description: 'Only the room host can switch playback providers.',
      });
      return;
    }

    const currentTrack = currentRoom.currentTrack;
    if (currentTrack.provider === targetProvider) {
      return;
    }

    if (targetProvider === 'youtube') {
      spotifyPlaybackProvider.pause();

      let ytVideoId = currentTrack.youtubeVideoId;
      let matchedTrack: Track | null = null;

      if (!ytVideoId) {
        try {
          matchedTrack = await youtubeMusicProvider.findMatch(currentTrack.title, currentTrack.artist);
          ytVideoId = matchedTrack?.youtubeVideoId || matchedTrack?.providerTrackId;
        } catch (err) {
          console.warn('[switchCurrentTrackProvider] YouTube match failed:', err);
        }
      }

      if (!ytVideoId) {
        showToast({
          type: 'error',
          title: 'YouTube Unavailable',
          description: `No corresponding YouTube video found for "${currentTrack.title}".`,
        });
        return;
      }

      const updatedTrack: Track = {
        ...currentTrack,
        id: `youtube-${ytVideoId}`,
        provider: 'youtube',
        providerTrackId: ytVideoId,
        audioSource: 'youtube',
        youtubeVideoId: ytVideoId,
        duration: matchedTrack?.duration || currentTrack.duration,
        durationMs: matchedTrack?.durationMs || currentTrack.durationMs,
        externalUrl: `https://www.youtube.com/watch?v=${ytVideoId}`,
        playbackStatus: 'AVAILABLE',
      };

      playbackManager.setProvider(youtubePlaybackProvider);
      await youtubePlaybackProvider.initialize();
      await youtubePlaybackProvider.loadTrack(updatedTrack, currentRoom.playerState.position);

      socketService.send({
        type: 'ADMIN_SET_CURRENT_TRACK',
        track: updatedTrack,
        autoplay: currentRoom.playerState.isPlaying,
      });

      showToast({
        type: 'success',
        title: 'Playing via YouTube',
        description: `Now playing "${currentTrack.title}" via YouTube Player.`,
      });
    } else if (targetProvider === 'spotify') {
      youtubePlaybackProvider.pause();
      playbackManager.setProvider(spotifyPlaybackProvider);

      let spotifyTrackId = currentTrack.provider === 'spotify' ? currentTrack.providerTrackId : null;
      let updatedTrack: Track = currentTrack;

      if (spotifyTrackId) {
        updatedTrack = {
          ...currentTrack,
          id: `spotify-${spotifyTrackId}`,
          provider: 'spotify',
          providerTrackId: spotifyTrackId,
          audioSource: 'spotify',
        };
      } else {
        try {
          const spotifyResults = await spotifyMusicProvider.searchTracks(`${currentTrack.title} ${currentTrack.artist}`);
          if (spotifyResults.length > 0) {
            updatedTrack = spotifyResults[0];
          }
        } catch {}
      }

      socketService.send({
        type: 'ADMIN_SET_CURRENT_TRACK',
        track: updatedTrack,
        autoplay: currentRoom.playerState.isPlaying,
      });

      showToast({
        type: 'success',
        title: 'Playing via Spotify',
        description: `Now playing "${currentTrack.title}" via Spotify Web Player.`,
      });
    }
  };

  const playTrackWithProvider = async (track: Track, targetProvider: 'spotify' | 'youtube') => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', title: 'Admin Only', description: 'Only the room host can start playback.' });
      return;
    }

    if (targetProvider === 'youtube') {
      spotifyPlaybackProvider.pause();
      let ytTrack = track;
      if (track.provider !== 'youtube') {
        const match = await youtubeMusicProvider.findMatch(track.title, track.artist);
        if (!match) {
          showToast({
            type: 'error',
            title: 'YouTube Video Unavailable',
            description: `No corresponding YouTube video found for "${track.title}".`,
          });
          return;
        }
        ytTrack = match;
      }

      playbackManager.setProvider(youtubePlaybackProvider);
      await youtubePlaybackProvider.initialize();
      await youtubePlaybackProvider.loadTrack(ytTrack, 0);

      socketService.send({
        type: 'ADMIN_SET_CURRENT_TRACK',
        track: ytTrack,
        autoplay: true,
      });
    } else {
      youtubePlaybackProvider.pause();
      playbackManager.setProvider(spotifyPlaybackProvider);

      let spTrack = track;
      if (track.provider !== 'spotify') {
        try {
          const results = await spotifyMusicProvider.searchTracks(`${track.title} ${track.artist}`);
          if (results.length > 0) {
            spTrack = results[0];
          }
        } catch {}
      }

      socketService.send({
        type: 'ADMIN_SET_CURRENT_TRACK',
        track: spTrack,
        autoplay: true,
      });
    }
  };

  const moveQueueUp = (index: number) => {
    if (!currentRoom || index <= 0 || index >= currentRoom.queue.length) return;
    const ids = currentRoom.queue.map((q) => q.id);
    const temp = ids[index];
    ids[index] = ids[index - 1];
    ids[index - 1] = temp;
    reorderQueue(ids);
  };

  const moveQueueDown = (index: number) => {
    if (!currentRoom || index < 0 || index >= currentRoom.queue.length - 1) return;
    const ids = currentRoom.queue.map((q) => q.id);
    const temp = ids[index];
    ids[index] = ids[index + 1];
    ids[index + 1] = temp;
    reorderQueue(ids);
  };

  const removeUser = (userId: string) => {
    socketService.send({ type: 'ADMIN_REMOVE_USER', userId });
  };

  const renameRoom = (newName: string) => {
    socketService.send({ type: 'ADMIN_RENAME_ROOM', newName });
  };

  const endRoom = () => {
    socketService.send({ type: 'ADMIN_END_ROOM' });
  };

  const loadActivities = () => {
    socketService.send({ type: 'GET_ACTIVITIES' });
  };

  const clearCreatedRoomNotice = useCallback(() => {
    setCreatedRoomNotice(null);
  }, []);

  return (
    <RoomContext.Provider
      value={{
        currentRoom,
        currentUser,
        activeView,
        setActiveView,
        connectionStatus,
        socketStatus,
        isLoading,
        error,
        createdRoomNotice,
        clearCreatedRoomNotice,
        createRoom,
        joinRoom,
        leaveRoom,
        playPause,
        seek,
        nextTrack,
        previousTrack,
        selectTrack,
        addToQueue,
        importQueue,
        removeFromQueue,
        reorderQueue,
        clearQueue,
        playNow,
        playTrackWithProvider,
        switchCurrentTrackProvider,
        moveQueueUp,
        moveQueueDown,
        removeUser,
        renameRoom,
        endRoom,
        activities,
        loadActivities,
        clearError,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
};

export function useRoom() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
}
