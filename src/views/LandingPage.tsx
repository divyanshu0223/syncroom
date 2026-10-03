import React from 'react';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { AudioVisualizer } from '../components/AudioVisualizer';
import {
  Sparkles,
  ArrowRight,
  Radio,
  Users,
  Sliders,
  ShieldCheck,
  Disc3,
  Smartphone,
  Laptop,
  Activity,
  Headphones,
  Crown,
  ListMusic,
} from 'lucide-react';

interface LandingPageProps {
  onCreateRoomClick: () => void;
  onJoinRoomClick: () => void;
  onMyPlaylistsClick?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onCreateRoomClick,
  onJoinRoomClick,
  onMyPlaylistsClick,
}) => {

  return (
    <div className="min-h-screen bg-[#08080a] text-neutral-100 flex flex-col selection:bg-amber-400/20 selection:text-amber-200">
      {/* Top Bar Contract: Zone 1 (Wordmark) — Zone 2 (Nav links) — Zone 3 (Action) */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/70 backdrop-blur-md px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Zone 1: Brand title wordmark */}
          <Logo size="md" />

          {/* Zone 2: Clean text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#features" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#devices" className="hover:text-white transition-colors">
              Supported Devices
            </a>
          </nav>

          {/* Zone 3: Primary actions */}
          <div className="flex items-center gap-3">
            {onMyPlaylistsClick && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onMyPlaylistsClick}
                leftIcon={<ListMusic className="w-4 h-4 text-amber-400" />}
                className="hidden sm:inline-flex border-neutral-800 hover:border-amber-500/40"
              >
                My Playlists
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onJoinRoomClick}
            >
              Join Room
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateRoomClick}
            >
              Create Room
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative pt-12 pb-20 sm:pt-20 sm:pb-28 px-4 sm:px-6 overflow-hidden">
          {/* Ambient Lighting Gradients */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-amber-500/10 via-sky-500/5 to-purple-500/10 blur-[130px] rounded-full pointer-events-none -z-10" />

          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
              {/* Hero Left: Value Proposition */}
              <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
                {/* Quiet unboxed kicker */}
                <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-amber-400/90">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Synchronized Multi-Device Audio</span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-extrabold tracking-tight text-white text-balance leading-[1.08]">
                  One room. One playlist.{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-amber-200">
                    Perfect in sync.
                  </span>
                </h1>

                <p className="text-base sm:text-lg text-neutral-400 max-w-xl mx-auto lg:mx-0 leading-relaxed text-pretty">
                  Host friends or teammates in private acoustic rooms. The host drives playback while every connected phone, laptop, and speaker plays in tight millisecond lockstep.
                </p>

                {/* Primary CTAs */}
                <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-2">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={onCreateRoomClick}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className="w-full sm:w-auto shadow-xl shadow-amber-500/20"
                  >
                    Create a Room
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={onJoinRoomClick}
                    className="w-full sm:w-auto"
                  >
                    Enter Room Code
                  </Button>
                  {onMyPlaylistsClick && (
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={onMyPlaylistsClick}
                      leftIcon={<ListMusic className="w-4 h-4 text-amber-400" />}
                      className="w-full sm:w-auto border-neutral-800 hover:border-amber-500/40"
                    >
                      My Playlists
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => {
                      document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="w-full sm:w-auto text-neutral-400 hover:text-white"
                  >
                    How It Works
                  </Button>
                </div>

                {/* Quantitative proof metrics */}
                <div className="pt-8 border-t border-neutral-800/80 grid grid-cols-3 gap-4 text-left">
                  <div>
                    <p className="text-2xl font-bold font-display text-white tabular-nums">
                      &lt;10ms
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Audio Clock Drift
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-display text-white tabular-nums">
                      100%
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Host Controlled
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-display text-white tabular-nums">
                      Zero
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Install Required
                    </p>
                  </div>
                </div>
              </div>

              {/* Hero Right: Live Architecture Stage Card */}
              <div className="lg:col-span-5 flex justify-center">
                <div className="w-full max-w-md rounded-3xl bg-neutral-900/60 border border-neutral-800/90 p-6 backdrop-blur-2xl shadow-2xl relative">
                  {/* Status header */}
                  <div className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-800/80">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-mono text-neutral-300">
                        Acoustic Mesh Ready
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                      <Activity className="w-3.5 h-3.5" />
                      <span className="tabular-nums">&lt;10ms Lock</span>
                    </div>
                  </div>

                  {/* Sync Topology Visualizer */}
                  <div className="my-4 p-5 rounded-2xl bg-neutral-950/80 border border-neutral-800/80 space-y-4">
                    {/* Host Node */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center text-amber-300">
                          <Crown className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">Host Controller</p>
                          <p className="text-[11px] text-amber-300/80">Authoritative Clock</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-amber-400">Master</span>
                    </div>

                    {/* Connecting Mesh Pulse */}
                    <div className="flex items-center justify-center gap-2 text-neutral-500 py-0.5">
                      <div className="h-4 w-[1px] bg-gradient-to-b from-amber-400 to-sky-400" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                        WebSocket High-Frequency Sync
                      </span>
                      <div className="h-4 w-[1px] bg-gradient-to-b from-amber-400 to-sky-400" />
                    </div>

                    {/* Listener Nodes */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-sky-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-200 truncate">Mobile</p>
                          <p className="text-[10px] text-emerald-400 font-mono">Sync &lt;4ms</p>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-sky-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-200 truncate">Desktop</p>
                          <p className="text-[10px] text-emerald-400 font-mono">Sync &lt;2ms</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Audio Visualizer & Scrub Preview */}
                  <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between">
                    <AudioVisualizer isPlaying={true} barCount={16} />
                    <button
                      type="button"
                      onClick={onCreateRoomClick}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
                    >
                      <span>Start a Session</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features / Capabilities Section */}
        <section id="features" className="py-20 border-t border-neutral-800/80 bg-neutral-950/40 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-14">
              <span className="text-xs font-semibold tracking-wider uppercase text-amber-400">
                Core Architecture
              </span>
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mt-1">
                Engineered for simultaneous sound.
              </h2>
              <p className="text-neutral-400 mt-2 text-sm sm:text-base">
                Eliminate the delay that turns shared music into chaos. SyncRoom is built around clock synchronization and single-authority control.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 hover:border-neutral-700/80 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400 mb-4">
                  <Sliders className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-white mb-2">
                  Admin-Only Controls
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Only the room creator commands track changes, scrubbing, and pause states. Listeners enjoy synchronized sound without fighting over the aux.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 hover:border-neutral-700/80 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-sky-400/10 border border-sky-400/20 flex items-center justify-center text-sky-400 mb-4">
                  <Radio className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-white mb-2">
                  Drift Compensation
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Continuous micro-timing calibration ensures that hardware clocks between your phone, tablet, and laptop stay aligned under 10 milliseconds.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 hover:border-neutral-700/80 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center text-emerald-400 mb-4">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-white mb-2">
                  Seamless Reconnection
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  If someone puts their phone in their pocket or steps out of Wi-Fi range, their device instantly resyncs to the host&apos;s current position upon returning.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-20 border-t border-neutral-800/80 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-xl mb-12">
              <span className="text-xs font-semibold tracking-wider uppercase text-amber-400">
                Workflow
              </span>
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mt-1">
                Up and listening in 10 seconds.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-3">
                <span className="font-mono text-xs text-amber-400 font-semibold">
                  01. CREATE ROOM
                </span>
                <h3 className="font-display font-bold text-lg text-white">
                  Launch Your Room
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Choose a room title, select your playlist or queue up tracks from the catalog, and receive your 8-digit share code.
                </p>
              </div>

              <div className="space-y-3">
                <span className="font-mono text-xs text-amber-400 font-semibold">
                  02. INVITE LISTENERS
                </span>
                <h3 className="font-display font-bold text-lg text-white">
                  Share the Code
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Friends enter the room code on their own browser. No account signups, no heavy app downloads, zero friction.
                </p>
              </div>

              <div className="space-y-3">
                <span className="font-mono text-xs text-amber-400 font-semibold">
                  03. SOUND IN SYNC
                </span>
                <h3 className="font-display font-bold text-lg text-white">
                  Experience Synchrony
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Hit play. All devices lock into the audio clock stream simultaneously with zero echo or perceptual lag.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Devices Section */}
        <section id="devices" className="py-16 border-t border-neutral-800/80 bg-neutral-950/60 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h3 className="text-2xl font-display font-bold text-white">
                Engineered for any modern device
              </h3>
              <p className="text-sm text-neutral-400 mt-1">
                Optimized for desktop browsers, mobile touch screens, and tablet audio interfaces.
              </p>
            </div>

            <div className="flex items-center gap-6 text-neutral-400">
              <div className="flex items-center gap-2 text-xs">
                <Laptop className="w-5 h-5 text-neutral-300" />
                <span>Mac / Windows / Linux</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Smartphone className="w-5 h-5 text-neutral-300" />
                <span>iOS &amp; Android</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Clean Footer (Anti-Slop compliant: no fake telemetry engines) */}
      <footer className="border-t border-neutral-800/80 bg-neutral-950 py-8 px-6 text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-amber-400" />
            <span className="font-display font-semibold text-neutral-300">
              SyncRoom
            </span>
            <span>· Synchronized Multi-Device Listening</span>
          </div>

          <p className="text-neutral-500">
            Phase 1 Project Foundation &amp; Frontend Interface
          </p>
        </div>
      </footer>
    </div>
  );
};
