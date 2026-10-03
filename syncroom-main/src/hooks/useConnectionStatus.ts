import { useRoom } from '../context/RoomContext';

export function useConnectionStatus() {
  const { connectionStatus, socketStatus } = useRoom();

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'good':
        return 'Good';
      case 'degraded':
        return 'Degraded';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting';
      case 'syncing':
        return 'Connecting';
      case 'offline':
      default:
        return 'Disconnected';
    }
  };

  const getStatusDot = () => {
    switch (connectionStatus) {
      case 'good':
      case 'connected':
        return '🟢';
      case 'degraded':
      case 'reconnecting':
      case 'syncing':
        return '🟡';
      case 'offline':
      default:
        return '🔴';
    }
  };

  return {
    connectionStatus,
    socketStatus,
    isConnected:
      connectionStatus === 'connected' ||
      connectionStatus === 'good' ||
      connectionStatus === 'degraded',
    statusText: getStatusText(),
    statusDot: getStatusDot(),
  };
}
