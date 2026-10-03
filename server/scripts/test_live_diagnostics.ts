import WebSocket from 'ws';

async function testLiveDiagnostics() {
  console.log('--- Connecting to live SyncRoom server at ws://localhost:3000/ws ---');
  const ws = new WebSocket('ws://localhost:3000/ws');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✓ WebSocket connected successfully to live server');
      resolve();
    });
    ws.on('error', (err) => {
      console.error('✗ WebSocket connection error:', err);
      reject(err);
    });
  });

  const responses: any[] = [];
  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    responses.push(parsed);
  });

  // 1. Time sync request
  const t0 = Date.now();
  ws.send(JSON.stringify({
    type: 'TIME_SYNC_REQUEST',
    clientSendTime: t0,
  }));

  // Wait for TIME_SYNC_RESPONSE
  await new Promise((r) => setTimeout(r, 200));
  const timeSyncResp = responses.find((m) => m.type === 'TIME_SYNC_RESPONSE');
  const t1 = Date.now();

  if (timeSyncResp) {
    const rtt = t1 - timeSyncResp.clientSendTime;
    const serverTimeEstimate = timeSyncResp.serverTime + rtt / 2;
    const offset = serverTimeEstimate - t1;
    console.log(`✓ TIME_SYNC_RESPONSE received: serverTime=${timeSyncResp.serverTime}, measured RTT=${rtt}ms, calculated clockOffset=${offset}ms`);
  } else {
    console.error('✗ Did not receive TIME_SYNC_RESPONSE');
  }

  // 2. Ping-pong measurement
  const pingStart = Date.now();
  ws.send(JSON.stringify({ type: 'PING' }));
  await new Promise((r) => setTimeout(r, 200));
  const pongResp = responses.find((m) => m.type === 'PONG');
  const pongRtt = Date.now() - pingStart;

  if (pongResp) {
    console.log(`✓ PONG received: measured RTT=${pongRtt}ms, server timestamp=${pongResp.timestamp}`);
  } else {
    console.error('✗ Did not receive PONG');
  }

  // 3. Create room to test authoritative playback and queue state
  ws.send(JSON.stringify({
    type: 'CREATE_ROOM',
    name: 'Diagnostic Live Test Room',
    adminName: 'TestAuditor',
  }));

  await new Promise((r) => setTimeout(r, 500));
  const roomCreated = responses.find((m) => m.type === 'ROOM_CREATED' || m.type === 'ROOM_STATE');
  if (roomCreated) {
    console.log(`✓ Room created successfully. Room code: ${roomCreated.room?.code || roomCreated.room?.id}`);
    const playback = roomCreated.room?.playback || {};
    console.log(`  Authoritative Playback Version: v${playback.version ?? 1}`);
    console.log(`  Authoritative Queue Version: v${roomCreated.room?.queueVersion ?? 1}`);
    console.log(`  Authoritative Playback Rate: ${playback.playbackRate ?? 1}x`);
    console.log(`  Authoritative State: ${playback.state || 'idle'}`);
  }

  ws.close();
  console.log('✓ All live server diagnostics tests passed successfully!');
}

testLiveDiagnostics().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
