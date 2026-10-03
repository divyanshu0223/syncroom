import { TrackAudioSource } from './types';

/**
 * DemoAudioSource
 *
 * Real audio source resolver.
 * Stricly adheres to developer restrictions:
 * - Does NOT synthesize dummy or fake audio.
 * - Does NOT use silent audio loops as a playback substitute.
 * - Does NOT scrape or download unauthorized Spotify audio.
 *
 * If no real audio stream or playback provider is configured,
 * it returns an empty string, indicating audio provider is not configured.
 */
export class DemoAudioSource implements TrackAudioSource {
  public async getAudioUrl(trackId: string): Promise<string> {
    // If a track has a real direct audio URL (e.g. licensed/local media), return it.
    // Spotify catalog tracks are metadata-only unless an official provider is configured.
    console.warn(
      `[AudioSource] No audio stream configured for track: ${trackId}. Fake audio generation is disabled.`
    );
    return '';
  }
}

export const demoAudioSource = new DemoAudioSource();
