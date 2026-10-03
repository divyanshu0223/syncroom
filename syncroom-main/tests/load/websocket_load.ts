process.env.WS_MAX_CONNECTIONS_PER_IP = '5000';

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../../server/websocket/connection';
import { roomManager } from '../../server/rooms/RoomManager';
import { Room } from '../../server/rooms/Room';
import { ServerUser } from '../../server/types';
import { Track } from '../../src/types';

interface TierResult {
  targetClients: number;
  connectedClients: number;
  failedConnections: number;
  connectionSuccessRate: string;
  connectDurationMs: number;
  broadcastEventsReceived: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  reconnectAttempts: number;
  reconnectSuccesses: number;
  reconnectSuccessRate: string;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  errorsObserved: string[];
}

function createTrack(id: string, duration = 240): Track {
  return {
    id,
    provider: 'local',
    providerTrackId: id,
    title: `Load Track ${id}`,
    artist: 'SyncRoom Load Tester',
    artists: ['SyncRoom Load Tester'],
    album: 'Load Testing Album',
    albumArtUrl: null,
    durationMs: duration * 1000,
    duration,
    externalUrl: null,
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    audioSource: 'local',
  };
}

async function runTier(targetClients: number, serverPort: number): Promise<TierResult> {
  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  const errorsObserved: string[] = [];

  const roomId = `room_load_${targetClients}_${Date.now()}`;
  const roomCode = `LD${String(targetClients).padStart(4, '0')}`;
  const initialTrack = createTrack(`init_${targetClients}`);
  const room = new Room(roomId, roomCode, `Load Room ${targetClients}`, 'admin_load', initialTrack);

  (roomManager as any).roomsById.set(roomId, room);
  (roomManager as any).roomsByCode.set(roomCode, room);

  const adminSession = `session_admin_${targetClients}`;
  const adminUser: ServerUser = {
    id: 'admin_load',
    name: 'Admin Load',
    role: 'admin',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: adminSession,
  };
  room.addUser(adminUser);

  const startCpu = process.cpuUsage();
  const connectStart = Date.now();

  // 1. Establish Admin Connection
  const adminWs = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    adminWs.on('open', () => resolve());
    adminWs.on('error', (err) => reject(err));
  });

  // Capture server admin socket
  const serverAdminWs = Array.from((roomManager as any).userConnections.values()).find((s: any) => s !== adminWs);
  (roomManager as any).registerConnection(adminWs, adminUser.id, adminSession, roomId);

  // 2. Concurrently Connect N Listeners
  const clientSockets: WebSocket[] = [];
  const latencies: number[] = [];
  let broadcastCount = 0;
  let connectionFailures = 0;

  const connectPromises: Promise<void>[] = [];

  for (let i = 0; i < targetClients; i++) {
    const listenerId = `listener_${targetClients}_${i}`;
    const sessionToken = `session_token_${targetClients}_${i}`;
    const listenerUser: ServerUser = {
      id: listenerId,
      name: `Listener ${i + 1}`,
      role: 'listener',
      roomId,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionToken,
    };
    room.addUser(listenerUser);

    const promise = new Promise<void>((resolve) => {
      try {
        const ws = new WebSocket(wsUrl);
        ws.on('open', () => {
          clientSockets.push(ws);
          (roomManager as any).registerConnection(ws, listenerId, sessionToken, roomId);

          ws.on('message', (data: any) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'PLAYBACK_STATE' && msg.state?.serverTimestamp) {
                const latency = Math.max(0, Date.now() - msg.state.serverTimestamp);
                latencies.push(latency);
                broadcastCount++;
              }
            } catch {}
          });
          resolve();
        });

        ws.on('error', (err) => {
          connectionFailures++;
          errorsObserved.push(`Client ${i} error: ${err.message}`);
          resolve();
        });
      } catch (err: any) {
        connectionFailures++;
        errorsObserved.push(`Client ${i} init error: ${err.message}`);
        resolve();
      }
    });

    connectPromises.push(promise);
    // Realistic client network arrival distribution (2ms between connections)
    await new Promise((r) => setTimeout(r, 2));
  }

  await Promise.all(connectPromises);
  const connectDurationMs = Date.now() - connectStart;

  // 3. Execute Server-Authoritative Playback Actions (Play, Seek, Pause, Next)
  await new Promise((r) => setTimeout(r, 50));

  // Action A: Play
  await (roomManager as any).runRoomCommand(room.id, () => {
    room.play();
    (roomManager as any).broadcastPlaybackState(room);
  });

  await new Promise((r) => setTimeout(r, 60));

  // Action B: Seek
  await (roomManager as any).runRoomCommand(room.id, () => {
    room.seek(45);
    (roomManager as any).broadcastPlaybackState(room);
  });

  await new Promise((r) => setTimeout(r, 60));

  // Action C: Next Track
  const nextTrack = createTrack(`next_${targetClients}`);
  room.addToQueue(nextTrack, adminUser);
  await (roomManager as any).runRoomCommand(room.id, () => {
    room.nextTrack();
    (roomManager as any).broadcastPlaybackState(room);
  });

  await new Promise((r) => setTimeout(r, 80));

  // 4. Test Reconnection under Load (disconnect 10% of clients and reconnect them)
  const reconnectBatchCount = Math.max(1, Math.floor(clientSockets.length * 0.1));
  let reconnectSuccesses = 0;
  const reconnectPromises: Promise<void>[] = [];

  for (let i = 0; i < reconnectBatchCount; i++) {
    const wsToClose = clientSockets[i];
    const listenerId = `listener_${targetClients}_${i}`;
    const sessionToken = `session_token_${targetClients}_${i}`;

    const recPromise = new Promise<void>((resolve) => {
      wsToClose.close();
      const newWs = new WebSocket(wsUrl);
      newWs.on('open', () => {
        (roomManager as any).registerConnection(newWs, listenerId, sessionToken, roomId);
        reconnectSuccesses++;
        newWs.close();
        resolve();
      });
      newWs.on('error', () => {
        resolve();
      });
    });
    reconnectPromises.push(recPromise);
  }

  await Promise.all(reconnectPromises);

  // 5. Gather Metrics
  const cpuDiff = process.cpuUsage(startCpu);
  const mem = process.memoryUsage();

  latencies.sort((a, b) => a - b);
  const minLatency = latencies.length > 0 ? latencies[0] : 0;
  const maxLatency = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
  const sumLatency = latencies.reduce((a, b) => a + b, 0);
  const avgLatency = latencies.length > 0 ? Math.round((sumLatency / latencies.length) * 10) / 10 : 0;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies.length > 0 ? latencies[p95Index] : 0;

  // Clean up tier
  for (const s of clientSockets) {
    try { s.close(); } catch {}
  }
  try { adminWs.close(); } catch {}
  room.destroy();
  (roomManager as any).roomsById.delete(roomId);
  (roomManager as any).roomsByCode.delete(roomCode);

  return {
    targetClients,
    connectedClients: clientSockets.length,
    failedConnections: connectionFailures,
    connectionSuccessRate: `${Math.round((clientSockets.length / targetClients) * 100)}%`,
    connectDurationMs,
    broadcastEventsReceived: broadcastCount,
    minLatencyMs: minLatency,
    maxLatencyMs: maxLatency,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    reconnectAttempts: reconnectBatchCount,
    reconnectSuccesses,
    reconnectSuccessRate: `${Math.round((reconnectSuccesses / reconnectBatchCount) * 100)}%`,
    memoryRssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    memoryHeapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    cpuUserMs: Math.round(cpuDiff.user / 1000),
    cpuSystemMs: Math.round(cpuDiff.system / 1000),
    errorsObserved: errorsObserved.slice(0, 5),
  };
}

export async function runFullWebSocketLoadTest() {
  console.log('================================================================');
  console.log('SYNCROOM PRODUCTION WEBSOCKET LOAD & SYNCHRONIZATION STRESS TEST');
  console.log('================================================================\n');

  // Spawn dedicated HTTP + WS server on ephemeral port
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWebSocketServer(wss);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as any).port;
  console.log(`[LoadTest Server] Running on 127.0.0.1:${port}/ws\n`);

  const tiers = [10, 25, 50, 100, 250];
  const results: TierResult[] = [];

  for (const tierClients of tiers) {
    console.log(`--> Testing Tier: ${tierClients} Concurrent Listeners...`);
    const result = await runTier(tierClients, port);
    results.push(result);
    console.log(`    Connected: ${result.connectedClients}/${result.targetClients} (${result.connectionSuccessRate}) in ${result.connectDurationMs}ms`);
    console.log(`    Broadcast Events Received: ${result.broadcastEventsReceived}`);
    console.log(`    Latency: min=${result.minLatencyMs}ms, avg=${result.avgLatencyMs}ms, p95=${result.p95LatencyMs}ms, max=${result.maxLatencyMs}ms`);
    console.log(`    Reconnect: ${result.reconnectSuccesses}/${result.reconnectAttempts} (${result.reconnectSuccessRate})`);
    console.log(`    Memory (Heap Used): ${result.memoryHeapUsedMb} MB | RSS: ${result.memoryRssMb} MB\n`);
    // Brief cool-down between tiers
    await new Promise((r) => setTimeout(r, 200));
  }

  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  console.log('================================================================');
  console.log('LOAD TEST SUMMARY REPORT');
  console.log('================================================================');
  console.table(
    results.map((r) => ({
      'Target Clients': r.targetClients,
      'Connected': r.connectedClients,
      'Success %': r.connectionSuccessRate,
      'Connect Time (ms)': r.connectDurationMs,
      'Avg Latency (ms)': r.avgLatencyMs,
      'p95 Latency (ms)': r.p95LatencyMs,
      'Max Latency (ms)': r.maxLatencyMs,
      'Reconnect Success': r.reconnectSuccessRate,
      'Heap Used (MB)': r.memoryHeapUsedMb,
    })),
  );

  return results;
}

if (process.argv[1]?.endsWith('websocket_load.ts')) {
  runFullWebSocketLoadTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Load test fatal error:', err);
      process.exit(1);
    });
}
