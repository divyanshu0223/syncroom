import { socketService } from './socket';
import { SYNC_CONFIG, SyncQuality } from '../config/sync';

export interface ClockSample {
  offset: number;
  rtt: number;
  timestamp: number;
}

export interface ClockSyncInfo {
  offset: number;
  rtt: number;
  localTime: number;
  serverTime: number;
  quality: SyncQuality;
  samplesCount: number;
}

export class ServerClockSync {
  private offset: number = 0; // serverTime - clientTime (ms)
  private samples: ClockSample[] = [];
  private maxSamples: number = SYNC_CONFIG.CLOCK_SYNC_SAMPLE_COUNT;
  private syncTimer: number | null = null;
  private burstTimer: number | null = null;
  private burstCount: number = 0;
  private pendingRequests: Map<number, number> = new Map(); // clientSendTime -> timestamp
  private listeners: Set<(info: ClockSyncInfo) => void> = new Set();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    socketService.onMessage((msg) => {
      if (msg.type === 'TIME_SYNC_RESPONSE') {
        this.handleTimeSyncResponse(msg.clientSendTime, msg.serverTime);
      }
    });

    socketService.onStatusChange((status) => {
      if (status === 'connected') {
        this.startSyncLoop();
      } else {
        this.stopSyncLoop();
      }
    });
  }

  public startSyncLoop() {
    this.stopSyncLoop();
    this.burstCount = 0;

    // 1. Immediate initial sync
    this.sync();

    // 2. Initial burst sync to quickly converge offset over low-jitter samples
    this.burstTimer = window.setInterval(() => {
      this.burstCount++;
      this.sync();
      if (this.burstCount >= SYNC_CONFIG.CLOCK_SYNC_BURST_COUNT) {
        if (this.burstTimer) {
          clearInterval(this.burstTimer);
          this.burstTimer = null;
        }
      }
    }, SYNC_CONFIG.CLOCK_SYNC_BURST_INTERVAL_MS);

    // 3. Steady-state background sync loop
    this.syncTimer = window.setInterval(() => {
      this.sync();
    }, SYNC_CONFIG.CLOCK_SYNC_INTERVAL_MS);
  }

  public stopSyncLoop() {
    if (this.burstTimer) {
      clearInterval(this.burstTimer);
      this.burstTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  public sync() {
    if (socketService.getStatus() !== 'connected') return;

    const clientSendTime = Date.now();
    this.pendingRequests.set(clientSendTime, clientSendTime);

    socketService.send({
      type: 'TIME_SYNC_REQUEST',
      clientSendTime,
    });
  }

  public handleTimeSyncResponse(clientSendTime: number, serverTime: number) {
    const clientReceiveTime = Date.now();
    this.pendingRequests.delete(clientSendTime);

    // Standard NTP / Cristian's Algorithm calculation:
    // Round-trip time (RTT)
    const rtt = Math.max(1, clientReceiveTime - clientSendTime);
    socketService.setMeasuredRtt(rtt);
    // Estimated server time at the instant of client packet receipt
    const estimatedServerTimeAtReceive = serverTime + rtt / 2;
    // Clock offset = estimatedServerTime - localClientTime
    const sampleOffset = estimatedServerTimeAtReceive - clientReceiveTime;

    this.samples.push({
      offset: sampleOffset,
      rtt,
      timestamp: clientReceiveTime,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Jitter & Outlier Rejection:
    // Sort samples by lowest RTT (samples with minimal queue delay / buffer bloat)
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    // Retain the best lowest-RTT samples (top 50%)
    const bestSamples = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    const avgOffset =
      bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length;

    this.offset = Math.round(avgOffset);

    console.log(
      `[SYNC] event=clock_sync_sample rttMs=${rtt} sampleOffsetMs=${sampleOffset} calculatedOffsetMs=${this.offset} samplesCount=${this.samples.length}`
    );

    // Notify listeners with authoritative measurement
    const info = this.getSyncInfo();
    this.listeners.forEach((listener) => {
      try {
        listener(info);
      } catch (err) {
        console.error('[SyncRoom Clock] Listener error:', err);
      }
    });
  }

  public hasMeasurements(): boolean {
    return this.samples.length > 0;
  }

  public getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Authoritative estimated server time in milliseconds.
   */
  public getEstimatedServerTime(): number {
    return Date.now() + this.offset;
  }

  public getServerTime(): number {
    return this.getEstimatedServerTime();
  }

  public getLocalTime(): number {
    return Date.now();
  }

  /**
   * Clock offset in milliseconds (serverTime - clientTime).
   * Positive means local clock is behind server.
   * Negative means local clock is ahead of server.
   */
  public getClockOffset(): number {
    return this.offset;
  }

  /**
   * Latest round-trip latency in milliseconds.
   */
  public getLatestRtt(): number {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].rtt;
  }

  /**
   * Average round-trip latency across the current sample window.
   */
  public getAverageRtt(): number {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((acc, s) => acc + s.rtt, 0);
    return Math.round(sum / this.samples.length);
  }

  /**
   * Categorizes synchronization quality based on actual measured RTT.
   */
  public getSyncQuality(): SyncQuality {
    if (this.samples.length < 2) return 'measuring';
    const rtt = this.getAverageRtt();
    if (rtt <= SYNC_CONFIG.RTT_EXCELLENT_THRESHOLD_MS) return 'excellent';
    if (rtt <= SYNC_CONFIG.RTT_GOOD_THRESHOLD_MS) return 'good';
    if (rtt <= SYNC_CONFIG.RTT_DEGRADED_THRESHOLD_MS) return 'degraded';
    return 'poor';
  }

  public getSyncInfo(): ClockSyncInfo {
    return {
      offset: this.offset,
      rtt: this.getLatestRtt(),
      localTime: this.getLocalTime(),
      serverTime: this.getEstimatedServerTime(),
      quality: this.getSyncQuality(),
      samplesCount: this.samples.length,
    };
  }

  public onClockUpdate(listener: (info: ClockSyncInfo) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSyncInfo());
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const serverClock = new ServerClockSync();
