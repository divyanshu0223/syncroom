import { ClientMessage, ServerMessage } from '../../server/types';
import { getRuntimeConfig, getWebSocketUrl, InsecureWebSocketError } from '../config/runtime';
import { SYNC_CONFIG } from '../config/sync';

export type SocketStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'config_error';

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: SocketStatus) => void;
type ErrorHandler = (error: { code: string; message: string }) => void;

class SocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private status: SocketStatus = 'disconnected';
  private pingInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  private explicitDisconnect = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 15;
  private lastPongTime = Date.now();
  private lastPingSendTime = 0;
  private lastRtt: number | null = null;
  private configError: string | null = null;
  private networkListenersAttached = false;

  constructor() {
    this.setupNetworkListeners();
  }

  public getStatus(): SocketStatus {
    return this.status;
  }

  public getConfigurationError(): string | null {
    return this.configError;
  }

  private setStatus(status: SocketStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach((handler) => {
        try {
          handler(status);
        } catch (e) {
          console.error('[SyncRoom Socket] Status handler error:', e);
        }
      });
    }
  }

  private emitError(code: string, message: string) {
    this.errorHandlers.forEach((handler) => {
      try {
        handler({ code, message });
      } catch (e) {
        console.error('[SyncRoom Socket] Error handler callback failed:', e);
      }
    });
  }

  private cleanupSocket(ws: WebSocket) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // Ignore
    }
  }

  /**
   * Sets up mobile & network listeners for connection resilience.
   * Handles device sleep/wake, tab visibility changes, and network switching (Wi-Fi <-> Cellular).
   */
  private setupNetworkListeners() {
    if (typeof window === 'undefined' || this.networkListenersAttached) return;

    window.addEventListener('online', () => {
      console.log('[SyncRoom Socket] Network back online, checking connection...');
      if (this.status === 'disconnected' || this.status === 'reconnecting') {
        this.reconnectAttempts = 0;
        this.connect();
      }
    });

    window.addEventListener('offline', () => {
      console.warn('[SyncRoom Socket] Network connectivity lost');
      this.setStatus('disconnected');
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.explicitDisconnect) {
          // If page became visible after being frozen or locked
          const isDead = !this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING;
          const pongStale = Date.now() - this.lastPongTime > 35000;
          if (isDead || pongStale) {
            console.log('[SyncRoom Socket] Tab restored, re-establishing WebSocket sync...');
            if (this.ws) {
              this.cleanupSocket(this.ws);
              this.ws = null;
            }
            this.reconnectAttempts = 0;
            this.connect();
          }
        }
      });
    }

    this.networkListenersAttached = true;
  }

  public connect(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();

    // Check runtime configuration safety
    const runtimeConfig = getRuntimeConfig();
    if (runtimeConfig.configurationError) {
      this.configError = runtimeConfig.configurationError;
      this.setStatus('config_error');
      this.emitError('INSECURE_WEBSOCKET_IN_PRODUCTION', runtimeConfig.configurationError);
      return Promise.reject(new InsecureWebSocketError(runtimeConfig.configurationError));
    }
    this.configError = null;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.setStatus('connected');
        return Promise.resolve();
      }
      if (this.ws.readyState === WebSocket.CONNECTING) {
        this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
        return Promise.resolve();
      }
      this.cleanupSocket(this.ws);
      this.ws = null;
    }

    this.explicitDisconnect = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    let socketUrl: string;
    try {
      socketUrl = getWebSocketUrl();
    } catch (err: unknown) {
      const message = (err as Error)?.message || 'Invalid WebSocket URL configuration';
      this.configError = message;
      this.setStatus('config_error');
      this.emitError('CONFIG_ERROR', message);
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.setStatus('disconnected');
          reject(new Error('WebSocket connection timed out'));
        }
      }, 7000);

      try {
        this.ws = new WebSocket(socketUrl);

        this.ws.onopen = () => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeoutTimer);
            this.setStatus('connected');
            this.reconnectAttempts = 0;
            this.lastPongTime = Date.now();
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
              this.reconnectTimeout = null;
            }
            this.startHeartbeat();
            console.log(`[SYNC] event=connection_open status=connected`);
            resolve();
          }
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const data: ServerMessage = JSON.parse(event.data);
            if (data.type === 'PONG') {
              this.lastPongTime = Date.now();
              if (this.lastPingSendTime > 0) {
                this.lastRtt = Date.now() - this.lastPingSendTime;
                console.log(`[SYNC] event=heartbeat_rtt rttMs=${this.lastRtt}`);
              }
              return;
            }
            this.messageHandlers.forEach((handler) => handler(data));
          } catch (err) {
            console.error('[SyncRoom Socket] Error parsing message payload:', err);
          }
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          console.log(`[SYNC] event=connection_close code=${event.code} reason=${event.reason || 'none'}`);

          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeoutTimer);
            reject(new Error(`WebSocket connection failed with code ${event.code}`));
          }

          if (this.explicitDisconnect) {
            this.setStatus('disconnected');
            return;
          }

          // If closed with policy violation or security error
          if (event.code === 1008) {
            console.error('[SyncRoom Socket] Server rejected connection (1008 Policy Violation)');
          }

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else {
            this.setStatus('disconnected');
          }
        };

        this.ws.onerror = (err) => {
          console.warn('[SyncRoom Socket] Socket connection error event:', err);
          // Handled by close event
        };
      } catch (err) {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutTimer);
          console.error('[SyncRoom Socket] Connection initialization failed:', err);
          this.setStatus('disconnected');
          this.scheduleReconnect();
          reject(err);
        }
      }
    });
  }

  private scheduleReconnect() {
    if (this.explicitDisconnect || this.status === 'config_error') {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[SyncRoom Socket] Max reconnect attempts reached. Waiting for user interaction.');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    // Exponential backoff with jitter for network resilience:
    // Base 1.5 multiplier, capped at 10 seconds, with +/- 20% jitter to prevent thundering herd
    const baseDelay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    const jitter = baseDelay * (0.8 + Math.random() * 0.4);
    const delay = Math.round(jitter);

    console.log(`[SYNC] event=reconnect_start attempt=${this.reconnectAttempts} delayMs=${delay}`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  public disconnect() {
    this.explicitDisconnect = true;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.cleanupSocket(this.ws);
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  public send(message: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('[SyncRoom Socket] Send failed:', err);
        return false;
      }
    }
    return false;
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  public onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  public onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  /**
   * Real connection quality indicator based on actual RTT measurements.
   * Possible states: good, degraded, reconnecting, offline, connected.
   */
  public getConnectionQuality(): 'good' | 'degraded' | 'reconnecting' | 'offline' | 'connected' {
    if (this.status === 'disconnected' || this.status === 'config_error') {
      return 'offline';
    }
    if (this.status === 'reconnecting' || this.status === 'connecting') {
      return 'reconnecting';
    }

    const rtt = this.lastRtt;
    if (rtt === null || rtt === 0) {
      return 'connected';
    }
    if (rtt <= SYNC_CONFIG.RTT_GOOD_THRESHOLD_MS) {
      return 'good';
    }
    return 'degraded';
  }

  public setMeasuredRtt(rtt: number) {
    this.lastRtt = rtt;
  }

  public getMeasuredRtt(): number | null {
    return this.lastRtt;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check for missed pong timeout (stale connection)
        if (Date.now() - this.lastPongTime > SYNC_CONFIG.HEARTBEAT_TIMEOUT_MS) {
          console.warn('[SyncRoom Socket] Heartbeat timeout: No PONG received in time. Reconnecting...');
          try {
            this.ws.close();
          } catch {
            // Ignore
          }
          return;
        }
        this.lastPingSendTime = Date.now();
        this.send({ type: 'PING' });
      }
    }, SYNC_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export const socketService = new SocketService();
