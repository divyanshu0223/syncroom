import { useState, useEffect } from 'react';
import { socketService, SocketStatus } from '../services/socket';

export function useSocket() {
  const [status, setStatus] = useState<SocketStatus>(socketService.getStatus());

  useEffect(() => {
    return socketService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    isReconnecting: status === 'reconnecting',
    isConnecting: status === 'connecting',
    isDisconnected: status === 'disconnected',
    send: socketService.send.bind(socketService),
    connect: socketService.connect.bind(socketService),
    disconnect: socketService.disconnect.bind(socketService),
  };
}
