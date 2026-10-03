/**
 * SyncRoom Authoritative Synchronization & Network Optimization Configuration
 *
 * Centralized, configurable parameters for clock synchronization,
 * drift thresholds, latency compensation, and connection health monitoring.
 */

export const SYNC_CONFIG = {
  // Drift thresholds (milliseconds)
  DRIFT_SOFT_THRESHOLD_MS: 60, // <= 60ms is considered acceptable in-sync
  DRIFT_HARD_THRESHOLD_MS: 250, // > 250ms triggers authoritative hard seek
  
  // Rate adjustment for moderate drift (between soft and hard thresholds)
  // Adjusts audio playbackRate by ±2.5% to smoothly converge without audible clicks
  MAX_PLAYBACK_RATE_ADJUSTMENT: 0.025, // 1.025x or 0.975x
  
  // Drift check frequency (milliseconds)
  SYNC_CHECK_INTERVAL_MS: 1200,
  
  // Server Clock Synchronization (NTP / Cristian's Algorithm)
  CLOCK_SYNC_SAMPLE_COUNT: 8, // Number of samples kept in rolling window
  CLOCK_SYNC_INTERVAL_MS: 10000, // Periodic background sync interval
  CLOCK_SYNC_BURST_COUNT: 4, // Number of initial fast pings upon connecting
  CLOCK_SYNC_BURST_INTERVAL_MS: 750, // Delay between initial burst samples
  
  // Latency-aware future scheduled playback start (lead time in milliseconds)
  // Gives all clients time to buffer and simultaneously schedule playback at the exact server millisecond
  SCHEDULED_START_LEAD_MS: 400,
  
  // Heartbeat & Connection Health
  HEARTBEAT_INTERVAL_MS: 15000, // Ping server every 15 seconds
  HEARTBEAT_TIMEOUT_MS: 35000, // Disconnect if no response after 35 seconds
  
  // Real Connection Quality Thresholds (based on measured RTT in ms)
  RTT_EXCELLENT_THRESHOLD_MS: 80,
  RTT_GOOD_THRESHOLD_MS: 180,
  RTT_DEGRADED_THRESHOLD_MS: 350,
} as const;

export type SyncQuality = 'excellent' | 'good' | 'degraded' | 'poor' | 'measuring';
