/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Volume1, Volume2, VolumeX } from 'lucide-react';
import { CelestialExperience } from './scene/CelestialExperience';

const SOUNDTRACK_URL =
  '/assets/aistudio/Woodkid___To_The_Wilder__from_DEATH_STRANDING_2__ON_THE_BEACH____Lyric_Video__BSN1rPPKK9s__6a0105d3.mp3';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.72);
  const [needsGesture, setNeedsGesture] = useState(false);

  // Initialize 3D celestial scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new CelestialExperience(container, {
      onReady: () => setIsReady(true),
      onError: (msg) => setErrorMessage(msg),
      onContextLost: (lost) => setContextLost(lost),
    });

    return () => {
      engine.dispose();
    };
  }, []);

  // Initialize soundtrack with graceful autoplay & first-gesture unlock
  useEffect(() => {
    const audio = new Audio(SOUNDTRACK_URL);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = volume;
    audioRef.current = audio;

    const handlePlay = () => {
      setIsPlaying(true);
      setNeedsGesture(false);
    };
    const handlePause = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    // Attempt immediate autoplay; if blocked by browser policy, unlock cleanly on first gesture
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => {
        setNeedsGesture(true);
      });
    }

    const unlockOnGesture = () => {
      if (audioRef.current && audioRef.current.paused && !audioRef.current.muted) {
        audioRef.current.play().catch(() => {
          // User can still toggle manually via the sound button
        });
      }
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
    };

    window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
    window.addEventListener('keydown', unlockOnGesture, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleSound = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!isPlaying) {
      audio.muted = false;
      setIsMuted(false);
      if (audio.volume === 0) {
        audio.volume = 0.72;
        setVolume(0.72);
      }
      audio.play().catch(() => {});
      return;
    }

    const nextMuted = !isMuted;
    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleVolumeChange = (nextVol: number) => {
    const clamped = Math.max(0, Math.min(1, nextVol));
    setVolume(clamped);

    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = clamped;
    if (clamped === 0) {
      audio.muted = true;
      setIsMuted(true);
    } else {
      audio.muted = false;
      setIsMuted(false);
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    }
  };

  const effectivelyMuted = isMuted || !isPlaying || volume === 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black select-none">
      {/* Dedicated isolated WebGL canvas container */}
      <div
        ref={mountRef}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        aria-label="Cinematic 3D Sun and Moon experience"
      />

      {/* Seamless pitch-black fade-in once textures wrap */}
      <div
        className={`pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-black transition-opacity duration-700 ${
          isReady && !errorMessage ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden={isReady && !errorMessage}
      >
        {errorMessage && (
          <div className="pointer-events-auto max-w-sm rounded-xl border border-white/10 bg-[#08080a] px-6 py-5 text-center">
            <p className="text-sm font-medium text-amber-200">WebGL Unavailable</p>
            <p className="mt-2 text-xs leading-relaxed text-stone-400">{errorMessage}</p>
          </div>
        )}
      </div>

      {/* WebGL context recovery notice */}
      {contextLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/85">
          <div className="rounded-xl border border-white/10 bg-[#08080a] px-6 py-4 text-center">
            <p className="text-sm text-stone-200">Restoring graphics context...</p>
          </div>
        </div>
      )}

      {/* Minimal discreet sound & standalone HTML download controls (bottom-right) */}
      <div
        className="fixed right-5 bottom-5 z-10 flex items-center gap-2 sm:right-6 sm:bottom-6"
      >
        <a
          href="/sun-and-moon.html"
          download="sun-and-moon.html"
          title="Download standalone HTML file"
          aria-label="Download standalone HTML file"
          className="flex h-[44px] items-center gap-1.5 rounded-xl border border-white/10 bg-[#070709]/90 px-3 text-xs font-medium text-stone-300 transition-colors hover:border-amber-400/40 hover:text-amber-200 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>HTML</span>
        </a>

        <div
          className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#070709]/90 px-3 py-2"
          role="region"
          aria-label="Sound controls"
        >
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={effectivelyMuted ? 'Enable sound' : 'Mute sound'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-200 transition-colors hover:bg-white/[0.08] hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            {effectivelyMuted ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : volume < 0.45 ? (
              <Volume1 className="h-4 w-4 text-amber-300" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4 text-amber-300" aria-hidden="true" />
            )}
          </button>

          {needsGesture && !isPlaying ? (
            <button
              type="button"
              onClick={handleToggleSound}
              className="pr-1 text-xs font-medium text-stone-300 transition-colors hover:text-amber-200 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              Play sound
            </button>
          ) : (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              aria-label="Volume"
              className="celestial-slider w-20 sm:w-24"
            />
          )}
        </div>
      </div>
    </main>
  );
}
