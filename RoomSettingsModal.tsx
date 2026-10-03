import React, { useState, useEffect } from 'react';
import { X, Settings, Edit3, Copy, Check, Power, AlertTriangle, Activity, Radio } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { ActivityItem } from '../types';
import { serverClock } from '../services/serverClock';
import { syncEngine } from '../audio/SyncEngine';
import { socketService } from '../services/socket';

interface RoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
  roomCode: string;
  queueVersion?: number;
  onRenameRoom: (newName: string) => void;
  onEndRoom: () => void;
  activities?: ActivityItem[];
  onLoadActivities?: () => void;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  onClose,
  roomName,
  roomCode,
  queueVersion = 1,
  onRenameRoom,
  onEndRoom,
  activities = [],
  onLoadActivities,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'general' | 'activity' | 'diagnostics'>('general');
  const [nameInput, setNameInput] = useState(roomName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [telemetryTick, setTelemetryTick] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setNameInput(roomName);
      setIsRenaming(false);
      setShowEndConfirm(false);
    }
  }, [isOpen, roomName]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'diagnostics') return;
    const interval = setInterval(() => {
      setTelemetryTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      showToast({ type: 'error', title: 'Invalid Name', description: 'Room name cannot be empty.' });
      return;
    }
    if (trimmed !== roomName) {
      onRenameRoom(trimmed);
      showToast({ type: 'success', title: 'Room Renamed', description: `Room is now "${trimmed}"` });
    }
    setIsRenaming(false);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      showToast({ type: 'success', title: 'Copied Code', description: `Room code: ${roomCode}` });
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Ignored
    }
  };

  const handleTabChange = (tab: 'general' | 'activity' | 'diagnostics') => {
    setActiveTab(tab);
    if (tab === 'activity' && onLoadActivities) {
      onLoadActivities();
    }
  };

  const syncStatus = syncEngine.getSyncStatus();
  const currentPlayback = syncEngine.getCurrentPlaybackState();

  const hasClockMeasurement = serverClock.hasMeasurements();
  const displayClockOffset = hasClockMeasurement
    ? `${serverClock.getClockOffset()}ms`
    : 'Measuring...';
  const displayRtt = hasClockMeasurement
    ? `${serverClock.getLatestRtt()}ms`
    : 'Measuring...';

  const formatDrift = () => {
    if (syncStatus.status === 'idle' || !currentPlayback?.isPlaying) {
      return 'Unavailable';
    }
    if (syncStatus.status === 'buffering' || (!syncStatus.driftMs && syncStatus.status !== 'synced')) {
      return 'Measuring...';
    }
    const ms = syncStatus.driftMs;
    const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
    return `${sign}${Math.abs(ms)}ms`;
  };

  const connectionQuality = socketService.getConnectionQuality();
  const connectionQualityLabel =
    connectionQuality === 'good'
      ? 'Good'
      : connectionQuality === 'connected'
        ? 'Connected'
        : connectionQuality === 'degraded'
          ? 'Degraded'
          : connectionQuality === 'reconnecting'
            ? 'Reconnecting'
            : 'Offline';

  const qualityBadgeClass =
    connectionQuality === 'good' || connectionQuality === 'connected'
      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
      : connectionQuality === 'degraded'
        ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
        : connectionQuality === 'reconnecting'
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
          : 'bg-rose-500/10 border-rose-500/20 text-rose-400';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-3xl bg-neutral-900 border border-neutral-800 p-6 shadow-2xl flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-base font-bold text-white">
                Room Settings
              </h2>
              <p className="text-xs text-neutral-400">Host administration controls</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-neutral-800 text-xs">
          <button
            type="button"
            onClick={() => handleTabChange('general')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${activeTab === 'general'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
          >
            General Settings
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('activity')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-colors ${activeTab === 'activity'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Activity Log</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('diagnostics')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-colors ${activeTab === 'diagnostics'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Sync Diagnostics</span>
          </button>
        </div>

        {activeTab === 'general' ? (
          <div className="flex flex-col gap-5">
            {/* Room Name */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-300">Room Name</label>
                {!isRenaming && (
                  <button
                    type="button"
                    onClick={() => setIsRenaming(true)}
                    className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Edit Name</span>
                  </button>
                )}
              </div>

              {isRenaming ? (
                <form onSubmit={handleSaveName} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={50}
                    autoFocus
                    className="flex-1 bg-neutral-950 border border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-xs transition-colors shrink-0"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(roomName);
                      setIsRenaming(false);
                    }}
                    className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors shrink-0"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-sm font-medium text-neutral-200">
                  {roomName}
                </div>
              )}
            </div>

            {/* Room Code & Status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-neutral-300">Room Code</label>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                  <span className="font-mono font-bold text-amber-400 text-sm">{roomCode}</span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-1 rounded-lg text-neutral-400 hover:text-white transition-colors"
                    title="Copy Code"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-neutral-300">Room Status</label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-semibold text-emerald-300">ACTIVE</span>
                </div>
              </div>
            </div>

            {/* Danger Zone: End Room */}
            <div className="pt-3 border-t border-neutral-800/80 flex flex-col gap-2">
              <span className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Danger Zone</span>
              </span>

              {showEndConfirm ? (
                <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/50 flex flex-col gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-rose-200">End this room?</h4>
                    <p className="text-[11px] text-neutral-400 mt-1">
                      All listeners will be immediately disconnected. The room and queue will be permanently closed.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setShowEndConfirm(false)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowEndConfirm(false);
                        onEndRoom();
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
                    >
                      End Room
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                  <div>
                    <p className="text-xs font-medium text-neutral-200">End Room Session</p>
                    <p className="text-[11px] text-neutral-400">Disconnects all participants and ends playback</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEndConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-colors"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>End Room</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'activity' ? (
          /* Activity Log Tab */
          <div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-1">
            {activities.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">
                No recent room activity recorded yet.
              </div>
            ) : (
              activities.map((act) => {
                const dateStr = new Date(act.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div
                    key={act.id}
                    className="flex items-start justify-between gap-3 p-2.5 rounded-xl bg-neutral-950/60 border border-neutral-800/60 text-xs"
                  >
                    <div>
                      <p className="font-medium text-neutral-200">
                        {act.action.replace(/_/g, ' ')}
                      </p>
                      {act.metadata && (
                        <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
                          {typeof act.metadata === 'object'
                            ? JSON.stringify(act.metadata).slice(0, 80)
                            : String(act.metadata)}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-neutral-500 shrink-0">
                      {dateStr}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* Diagnostics Tab */
          <div className="flex flex-col gap-4">
            <div className="p-3 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex flex-col gap-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Synchronization Telemetry
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Clock Offset</span>
                  <span className="text-amber-300 font-semibold">{displayClockOffset}</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Measured RTT</span>
                  <span className="text-emerald-400 font-semibold">{displayRtt}</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Current Drift</span>
                  <span className="text-cyan-300 font-semibold">{formatDrift()}</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Playback Rate</span>
                  <span className="text-neutral-200 font-semibold">{syncStatus.playbackRate}x</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Playback Version</span>
                  <span className="text-neutral-200 font-semibold">v{currentPlayback?.version ?? 1}</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-neutral-500 block text-[10px] uppercase">Queue Version</span>
                  <span className="text-neutral-200 font-semibold">v{queueVersion}</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between text-xs">
              <div>
                <p className="font-medium text-neutral-300">Connection Quality</p>
                <p className="text-[11px] text-neutral-500">Based on real network latency measurements</p>
              </div>
              <span className={`capitalize px-2.5 py-1 rounded-full border font-semibold text-xs ${qualityBadgeClass}`}>
                {connectionQualityLabel}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
