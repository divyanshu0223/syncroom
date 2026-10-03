import 'dotenv/config';
import { startServer } from './server/index';

process.on('unhandledRejection', (reason) => {
  console.warn('[SyncRoom Server] Unhandled Rejection (handled safely):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SyncRoom Server] Uncaught Exception (handled safely):', err);
});

startServer().catch((err) => {
  console.error('[SyncRoom Server] Failed to start server:', err);
  process.exit(1);
});

