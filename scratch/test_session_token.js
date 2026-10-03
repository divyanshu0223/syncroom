import 'dotenv/config';
import { getValidAccessToken, getStoredTokens } from '../server/spotify/spotifyAuth.ts';

async function test() {
  const token = await getValidAccessToken('syncroom_session_5b734058e413230a103cc69fda5f3c3a2a5510efe71c67708d12f5776c1cacfb');
  console.log('Token for session:', Boolean(token), token ? token.substring(0, 15) : null);
}

test().catch(console.error);
