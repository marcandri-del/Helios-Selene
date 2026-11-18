import { CelestialExperience } from '../src/scene/CelestialExperience';

function base64ElementToBlobUrl(elementId: string, mimeType: string): string {
  const el = document.getElementById(elementId);
  if (!el || !el.textContent) {
    throw new Error(`Embedded asset "${elementId}" is missing.`);
  }
  const b64 = el.textContent.trim();
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

const mountEl = document.getElementById('canvas-mount') as HTMLDivElement;
const curtainEl = document.getElementById('loading-curtain') as HTMLDivElement;
const errorEl = document.getElementById('error-box') as HTMLDivElement;
const errorTextEl = document.getElementById('error-text') as HTMLParagraphElement;
const contextEl = document.getElementById('context-lost') as HTMLDivElement;

const soundToggleBtn = document.getElementById('sound-toggle') as HTMLButtonElement;
const iconMuted = document.getElementById('icon-muted') as HTMLElement;
const iconLow = document.getElementById('icon-low') as HTMLElement;
const iconHigh = document.getElementById('icon-high') as HTMLElement;
const playLabelBtn = document.getElementById('play-label') as HTMLButtonElement;
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;

function showFatalError(msg: string) {
  errorTextEl.textContent = msg;
  errorEl.style.display = 'block';
  curtainEl.style.opacity = '1';
  curtainEl.setAttribute('aria-hidden', 'false');
}

window.addEventListener('error', (ev) => {
  if (ev.message) showFatalError(ev.message);
});

window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason || 'Unexpected error');
  showFatalError(reason);
});

try {
  // Decode embedded base64 assets into short blob: URLs to avoid Chromium/Brave's 2MB data: URL limit
  const moonBlobUrl = base64ElementToBlobUrl('asset-moon', 'image/png');
  const sunBlobUrl = base64ElementToBlobUrl('asset-sun', 'image/png');
  const audioBlobUrl = base64ElementToBlobUrl('asset-audio', 'audio/mpeg');

  let isPlaying = false;
  let isMuted = false;
  let volume = 0.72;
  let needsGesture = false;

  const audio = new Audio(audioBlobUrl);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = volume;

  function syncSoundUI() {
    const effectivelyMuted = isMuted || !isPlaying || volume === 0;
    iconMuted.style.display = effectivelyMuted ? 'block' : 'none';
    iconLow.style.display = !effectivelyMuted && volume < 0.45 ? 'block' : 'none';
    iconHigh.style.display = !effectivelyMuted && volume >= 0.45 ? 'block' : 'none';

    soundToggleBtn.setAttribute('aria-label', effectivelyMuted ? 'Enable sound' : 'Mute sound');

    if (needsGesture && !isPlaying) {
      playLabelBtn.style.display = 'inline-block';
      volumeSlider.style.display = 'none';
    } else {
      playLabelBtn.style.display = 'none';
      volumeSlider.style.display = 'block';
      volumeSlider.value = String(isMuted ? 0 : volume);
    }
  }

  audio.addEventListener('play', () => {
    isPlaying = true;
    needsGesture = false;
    syncSoundUI();
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    syncSoundUI();
  });

  function toggleSound() {
    if (!isPlaying) {
      audio.muted = false;
      isMuted = false;
      if (audio.volume === 0) {
        audio.volume = 0.72;
        volume = 0.72;
      }
      audio.play().catch(() => {});
      syncSoundUI();
      return;
    }
    isMuted = !isMuted;
    audio.muted = isMuted;
    syncSoundUI();
  }

  soundToggleBtn.addEventListener('click', toggleSound);
  playLabelBtn.addEventListener('click', toggleSound);

  volumeSlider.addEventListener('input', () => {
    const next = Math.max(0, Math.min(1, parseFloat(volumeSlider.value)));
    volume = next;
    audio.volume = next;
    if (next === 0) {
      audio.muted = true;
      isMuted = true;
    } else {
      audio.muted = false;
      isMuted = false;
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    }
    syncSoundUI();
  });

  const initialPlay = audio.play();
  if (initialPlay) {
    initialPlay.catch(() => {
      needsGesture = true;
      syncSoundUI();
    });
  }

  function unlockOnGesture() {
    if (audio.paused && !audio.muted) {
      audio.play().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlockOnGesture);
    window.removeEventListener('keydown', unlockOnGesture);
  }

  window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
  window.addEventListener('keydown', unlockOnGesture, { passive: true });

  syncSoundUI();

  const engine = new CelestialExperience(mountEl, {
    moonTextureUrl: moonBlobUrl,
    sunTextureUrl: sunBlobUrl,
    onReady: () => {
      curtainEl.style.opacity = '0';
      curtainEl.setAttribute('aria-hidden', 'true');
    },
    onError: (msg) => {
      showFatalError(msg);
    },
    onContextLost: (lost) => {
      contextEl.style.display = lost ? 'flex' : 'none';
    },
  });

  window.addEventListener('beforeunload', () => {
    engine.dispose();
    audio.pause();
    URL.revokeObjectURL(moonBlobUrl);
    URL.revokeObjectURL(sunBlobUrl);
    URL.revokeObjectURL(audioBlobUrl);
  });
} catch (err) {
  showFatalError(err instanceof Error ? err.message : 'Unable to start 3D experience.');
}
