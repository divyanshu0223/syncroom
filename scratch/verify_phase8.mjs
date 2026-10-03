import { WebSocket } from 'ws';

const BASE_URL = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3000/ws';

async function runVerification() {
  console.log('=== STARTING PHASE 8 PRODUCTION INFRASTRUCTURE VERIFICATION ===\n');
  let failures = 0;

  // 1. Health Probe
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    if (res.status === 200 && data.status === 'ok' && typeof data.uptimeSeconds === 'number') {
      console.log('✔ [1/9] Health Check (/health): PASSED', data);
    } else {
      console.error('✖ [1/9] Health Check (/health): FAILED', res.status, data);
      failures++;
    }
  } catch (err) {
    console.error('✖ [1/9] Health Check (/health): ERROR', err.message);
    failures++;
  }

  // 2. Readiness Probe
  try {
    const res = await fetch(`${BASE_URL}/ready`);
    const data = await res.json();
    if (
      res.status === 200 &&
      data.status === 'ready' &&
      data.application === 'healthy' &&
      data.dependencies.database.status === 'pending_configuration'
    ) {
      console.log('✔ [2/9] Readiness Check (/ready): PASSED (Accurate Phase 8 in-memory state)', data);
    } else {
      console.error('✖ [2/9] Readiness Check (/ready): FAILED', res.status, data);
      failures++;
    }
  } catch (err) {
    console.error('✖ [2/9] Readiness Check (/ready): ERROR', err.message);
    failures++;
  }

  // 3. Security Headers
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const nosniff = res.headers.get('x-content-type-options');
    const xframe = res.headers.get('x-frame-options');
    const referrer = res.headers.get('referrer-policy');
    const csp = res.headers.get('content-security-policy');
    const correlationId = res.headers.get('x-correlation-id');

    if (nosniff === 'nosniff' && xframe === 'SAMEORIGIN' && referrer && csp && correlationId) {
      console.log('✔ [3/9] Security Headers: PASSED (nosniff, SAMEORIGIN, CSP, correlationId verified)');
    } else {
      console.error('✖ [3/9] Security Headers: FAILED', { nosniff, xframe, referrer, csp, correlationId });
      failures++;
    }
  } catch (err) {
    console.error('✖ [3/9] Security Headers: ERROR', err.message);
    failures++;
  }

  // 4. Rate Limiting Headers
  try {
    const res = await fetch(`${BASE_URL}/api/spotify/search?q=test`);
    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');
    const reset = res.headers.get('ratelimit-reset');

    if (limit && remaining !== null && reset) {
      console.log(`✔ [4/9] Rate Limiting: PASSED (Limit: ${limit}, Remaining: ${remaining}, Reset: ${reset})`);
    } else {
      console.error('✖ [4/9] Rate Limiting: FAILED', { limit, remaining, reset });
      failures++;
    }
  } catch (err) {
    console.error('✖ [4/9] Rate Limiting: ERROR', err.message);
    failures++;
  }

  // 5. Centralized Error Handling & Non-Leakage
  try {
    const res = await fetch(`${BASE_URL}/api/spotify/playlist/non-existent-invalid-id-xyz`);
    const data = await res.json();
    if (res.status === 400 && data.error && !data.stack) {
      console.log('✔ [5/9] Error Handling: PASSED (Safe 400 response without stack trace leakage)', data);
    } else {
      console.error('✖ [5/9] Error Handling: FAILED', res.status, data);
      failures++;
    }
  } catch (err) {
    console.error('✖ [5/9] Error Handling: ERROR', err.message);
    failures++;
  }

  // 6. Spotify Unconfigured Authenticity Check
  try {
    const res = await fetch(`${BASE_URL}/api/spotify/status`);
    const data = await res.json();
    if (data.configured === false && data.connected === false) {
      console.log('✔ [6/9] Spotify Configuration State: PASSED (Authentic unconfigured response, no dummy keys)');
    } else {
      console.error('✖ [6/9] Spotify Configuration State: FAILED', data);
      failures++;
    }
  } catch (err) {
    console.error('✖ [6/9] Spotify Configuration State: ERROR', err.message);
    failures++;
  }

  // 7. WebSocket Room Creation (Admin Session)
  let adminSessionToken = '';
  let roomCode = '';
  let roomId = '';

  await new Promise((resolve) => {
    const adminWs = new WebSocket(WS_URL, {
      headers: { Origin: 'http://localhost:3000' },
    });

    adminWs.on('open', () => {
      adminWs.send(
        JSON.stringify({
          type: 'CREATE_ROOM',
          name: 'Phase 8 Production Room',
          adminName: 'Lead Dev',
          device: 'desktop',
        }),
      );
    });

    adminWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ROOM_CREATED') {
        adminSessionToken = msg.sessionToken;
        roomCode = msg.room.code;
        roomId = msg.room.id;
        console.log(`✔ [7/9] WS Room Creation: PASSED (Code: ${roomCode}, Admin Role: ${msg.user.role})`);
        adminWs.close();
        resolve();
      } else if (msg.type === 'ERROR') {
        console.error('✖ [7/9] WS Room Creation: FAILED', msg);
        failures++;
        adminWs.close();
        resolve();
      }
    });

    adminWs.on('error', (err) => {
      console.error('✖ [7/9] WS Room Creation Socket: ERROR', err.message);
      failures++;
      resolve();
    });
  });

  if (!roomCode) {
    console.error('Cannot proceed with WS listener checks because room was not created.');
    process.exit(1);
  }

  // 8. WebSocket Listener Restrictions (Authorization Enforcement)
  let listenerSessionToken = '';
  await new Promise((resolve) => {
    const listenerWs = new WebSocket(WS_URL, {
      headers: { Origin: 'http://localhost:3000' },
    });

    listenerWs.on('open', () => {
      listenerWs.send(
        JSON.stringify({
          type: 'JOIN_ROOM',
          code: roomCode,
          displayName: 'Guest Listener',
          device: 'mobile',
        }),
      );
    });

    listenerWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ROOM_JOINED') {
        listenerSessionToken = msg.sessionToken;
        // Listener attempts unauthorized playback control
        listenerWs.send(JSON.stringify({ type: 'ADMIN_PLAY' }));
      } else if (msg.type === 'ERROR') {
        if (msg.code === 'FORBIDDEN') {
          console.log('✔ [8/9] Listener Authorization Enforcement: PASSED (Forbidden: Listener blocked from admin commands)');
        } else {
          console.error('✖ [8/9] Listener Authorization Enforcement: UNEXPECTED ERROR', msg);
          failures++;
        }
        listenerWs.close();
        resolve();
      }
    });

    listenerWs.on('error', (err) => {
      console.error('✖ [8/9] WS Listener Socket: ERROR', err.message);
      failures++;
      resolve();
    });
  });

  // 9. WebSocket Session Reconnection
  await new Promise((resolve) => {
    const reconWs = new WebSocket(WS_URL, {
      headers: { Origin: 'http://localhost:3000' },
    });

    reconWs.on('open', () => {
      reconWs.send(
        JSON.stringify({
          type: 'RECONNECT_SESSION',
          sessionToken: adminSessionToken,
        }),
      );
    });

    reconWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ROOM_STATE') {
        if (msg.user.role === 'admin' && msg.room.code === roomCode) {
          console.log('✔ [9/9] WebSocket Session Reconnection: PASSED (Admin session successfully rehydrated)');
        } else {
          console.error('✖ [9/9] WebSocket Session Reconnection: MISMATCH', msg);
          failures++;
        }
        reconWs.close();
        resolve();
      } else if (msg.type === 'ERROR') {
        console.error('✖ [9/9] WebSocket Session Reconnection: FAILED', msg);
        failures++;
        reconWs.close();
        resolve();
      }
    });

    reconWs.on('error', (err) => {
      console.error('✖ [9/9] WS Reconnection Socket: ERROR', err.message);
      failures++;
      resolve();
    });
  });

  console.log('\n=== VERIFICATION SUMMARY ===');
  if (failures === 0) {
    console.log('ALL 9 VERIFICATION PHASES PASSED WITH ZERO FAILURES!\n');
    process.exit(0);
  } else {
    console.error(`VERIFICATION COMPLETED WITH ${failures} FAILURE(S).\n`);
    process.exit(1);
  }
}

runVerification();
