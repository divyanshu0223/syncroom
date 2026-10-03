import { useState, useEffect, useCallback } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { syncEngine } from '../audio/SyncEngine';
import { SyncStatus } from '../audio/types';
import { playbackManager, SpotifyPlayerStatus } from '../audio/PlaybackProvider';

export function useSynchronizedPlayback() {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(audioEngine.isUnlocked());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getSyncStatus());
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [volume, setLocalVolume] = useState<number>(Math.round(playbackManager.getProvider().getVolume()));
  const [providerStatus, setProviderStatus] = useState<SpotifyPlayerStatus | string>(
    playbackManager.getStatus()
  );
  const [providerError, setProviderError] = useState<string | null>(
    playbackManager.getProvider().getErrorMessage?.() || null
  );

  useEffect(() => {
    const unsubUnlock = audioEngine.onUnlockChange((unlocked) => {
      setIsUnlocked(unlocked);
    });

    const unsubSync = syncEngine.onSyncStatusChange((status) => {
      setSyncStatus(status);
    });

    const unsubProvider = playbackManager.onProviderChange((provider, status) => {
      setProviderStatus(status);
      setProviderError(provider.getErrorMessage?.() || null);
    });

    const timer = setInterval(() => {
      const provider = playbackManager.getProvider();
      if ((provider.id === 'spotify' || provider.id === 'youtube') && provider.isConfigured) {
        setCurrentTime(provider.getPosition());
      } else {
        setCurrentTime(audioEngine.getCurrentTime());
      }
    }, 250);

    return () => {
      unsubUnlock();
      unsubSync();
      unsubProvider();
      clearInterval(timer);
    };
  }, []);

  const enableAudio = useCallback(async () => {
    await syncEngine.unlockAutoplay();
    setIsUnlocked(true);
    return true;
  }, []);

  const setVolume = useCallback((vol: number) => {
    playbackManager.getProvider().setVolume(vol);
    audioEngine.setVolume(vol);
    setLocalVolume(vol);
  }, []);

  const currentProvider = playbackManager.getProvider();
  const currentDuration =
    (currentProvider.id === 'spotify' || currentProvider.id === 'youtube') && currentProvider.isConfigured
      ? currentProvider.getDuration() || audioEngine.getDuration()
      : audioEngine.getDuration();

  return {
    isUnlocked,
    enableAudio,
    syncStatus,
    currentTime,
    duration: currentDuration,
    volume,
    setVolume,
    providerStatus,
    providerError,
    providerId: currentProvider.id,
  };
}
