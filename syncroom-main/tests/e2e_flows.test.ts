import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/websocket/connection';
import { roomManager } from '../server/rooms/RoomManager';
import { Room } from '../server/rooms/Room';
import { ServerUser } from '../server/types';
import { Track } from '../src/types';

function createTrack(id: string, duration = 180): Track {
  return {
    id,
    provider: 'local',
    providerTrackId: id,
    title: `Flow Song ${id}`,
    artist: 'Flow Artist',
    artists: ['Flow Artist'],
    album: 'Flow Album',
    albumArtUrl: null,
    durationMs: duration * 1000,
    duration,
    externalUrl: null,
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    audioSource: 'local',
  };
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for WebSocket message`));
    }, timeoutMs);

    function onMsg(data: any) {
      const text = data.toString();
      try {
        const parsed = JSON.parse(text);
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(parsed);
        }
      } catch {}
    }

    ws.on('message', onMsg);
  });
}

test('E2E FLOWS: Complete Multi-Device Synchronization & Security Lifecycle', async () => {
  // 1. Spin up real HTTP + WebSocket server on ephemeral port (port: 0)
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const serverSockets: WebSocket[] = [];
  wss.on('connection', (socket) => {
    serverSockets.push(socket);
  });

  setupWebSocketServer(wss);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as any).port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  // 2. Set up Room & Sessions on server
  const roomId = 'room_e2e_real_flow';
  const roomCode = 'E2EFLW';
  const initialTrack = createTrack('e2e_t1', 210);
  const room = new Room(roomId, roomCode, 'E2E Real Flow Room', 'admin_e2e', initialTrack);

  (roomManager as any).roomsById.set(roomId, room);
  (roomManager as any).roomsByCode.set(roomCode, room);

  const adminSessionToken = 'st_admin_e2e_secret_token_123456';
  const listenerSessionToken = 'st_listener_e2e_secret_token_789012';

  const adminUser: ServerUser = {
    id: 'admin_e2e',
    name: 'Admin Alice',
    role: 'admin',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: adminSessionToken,
  };

  const listenerUser: ServerUser = {
    id: 'listener_bob',
    name: 'Listener Bob',
    role: 'listener',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: listenerSessionToken,
  };

  room.addUser(adminUser);
  room.addUser(listenerUser);

  // Connect real WebSocket for Admin
  const adminWs = new WebSocket(wsUrl);
  await new Promise((resolve) => adminWs.on('open', resolve));

  // Connect real WebSocket for Listener
  const listenerWs = new WebSocket(wsUrl);
  await new Promise((resolve) => listenerWs.on('open', resolve));

  // Wait brief tick for server connection callbacks to process
  await new Promise((resolve) => setTimeout(resolve, 50));

  const serverAdminWs = serverSockets[0];
  const serverListenerWs = serverSockets[1];

  // Register real connections in RoomManager
  (roomManager as any).registerConnection(serverAdminWs, adminUser.id, adminSessionToken, roomId);
  (roomManager as any).registerConnection(serverListenerWs, listenerUser.id, listenerSessionToken, roomId);

  try {
    // ----------------------------------------------------
    // FLOW A: Handshake & Ping / Time Sync Verification
    // ----------------------------------------------------
    const timeSyncPromise = waitForMessage(adminWs, (m) => m.type === 'TIME_SYNC_RESPONSE');
    adminWs.send(JSON.stringify({ type: 'TIME_SYNC_REQUEST', clientSendTime: Date.now() }));
    const timeSyncRes = await timeSyncPromise;

    assert.equal(timeSyncRes.type, 'TIME_SYNC_RESPONSE');
    assert.ok(typeof timeSyncRes.serverTime === 'number');

    // ----------------------------------------------------
    // FLOW B: Admin starts playback -> Listener receives synchronized state
    // ----------------------------------------------------
    const playbackPromise = waitForMessage(listenerWs, (m) => m.type === 'PLAYBACK_STATE');
    adminWs.send(JSON.stringify({ type: 'ADMIN_PLAY' }));
    const pbRes = await playbackPromise;

    assert.equal(pbRes.type, 'PLAYBACK_STATE');
    assert.equal(pbRes.isPlaying, true);
    assert.equal(pbRes.currentTrackId, 'e2e_t1');
    assert.ok(room.isPlaying, 'Server Room must be playing');

    // ----------------------------------------------------
    // FLOW C: Listener attempts admin command -> Server strictly rejects with FORBIDDEN
    // ----------------------------------------------------
    const forbiddenPromise = waitForMessage(listenerWs, (m) => m.type === 'ERROR' && m.code === 'FORBIDDEN');
    listenerWs.send(JSON.stringify({ type: 'ADMIN_PAUSE' }));
    const forbiddenRes = await forbiddenPromise;

    assert.equal(forbiddenRes.type, 'ERROR');
    assert.equal(forbiddenRes.code, 'FORBIDDEN');
    assert.equal(forbiddenRes.message, 'Only the room admin can control playback.');
    assert.equal(room.isPlaying, true, 'Server playback state must remain unchanged');

    // Listener also rejected on seek, next, and queue add
    const seekForbidden = waitForMessage(listenerWs, (m) => m.type === 'ERROR' && m.code === 'FORBIDDEN');
    listenerWs.send(JSON.stringify({ type: 'ADMIN_SEEK', position: 50 }));
    const seekRes = await seekForbidden;
    assert.equal(seekRes.code, 'FORBIDDEN');

    // ----------------------------------------------------
    // FLOW D: Admin seeks -> Listener receives synchronized seek position
    // ----------------------------------------------------
    const seekUpdatePromise = waitForMessage(listenerWs, (m) => m.type === 'PLAYBACK_STATE' && m.position === 75);
    adminWs.send(JSON.stringify({ type: 'ADMIN_SEEK', position: 75 }));
    const seekUpdateRes = await seekUpdatePromise;

    assert.equal(seekUpdateRes.position, 75);
    assert.equal(room.position, 75);

    // ----------------------------------------------------
    // FLOW E: Admin ends room -> Listeners receive ROOM_ENDED
    // ----------------------------------------------------
    const endedPromise = waitForMessage(listenerWs, (m) => m.type === 'ROOM_ENDED');
    adminWs.send(JSON.stringify({ type: 'ADMIN_END_ROOM' }));
    const endedRes = await endedPromise;

    assert.equal(endedRes.type, 'ROOM_ENDED');
    assert.equal(endedRes.message, 'Room ended by the admin.');
  } finally {
    // Teardown connections & servers
    try { adminWs.close(); } catch {}
    try { listenerWs.close(); } catch {}
    room.destroy();
    (roomManager as any).roomsById.delete(roomId);
    (roomManager as any).roomsByCode.delete(roomCode);

    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
