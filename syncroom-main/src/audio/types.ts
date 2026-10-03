export interface TrackAudioSource {
  getAudioUrl(trackId: string): Promise<string>;
}

export type AudioEngineState =
  | 'uninitialized'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error';

export interface SyncStatus {
  driftSeconds: number;
  driftMs: number;
  status: 'synced' | 'adjusting' | 'seeking' | 'buffering' | 'idle' | 'autoplay_blocked';
  playbackRate: number;
  rttMs: number;
  clockOffsetMs: number;
}

export interface SyncEngineConfig {
  driftSoftThreshold: number; // in seconds (e.g. 0.08 = 80ms)
  driftHardThreshold: number; // in seconds (e.g. 0.30 = 300ms)
  driftCheckIntervalMs: number;
  softRateCorrection: number; // e.g. 0.025 (1.025 or 0.975)
}
