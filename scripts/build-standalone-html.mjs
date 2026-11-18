import fs from 'fs';
import path from 'path';
import { build } from 'esbuild';

const root = process.cwd();

const moonPath = path.join(root, 'public/assets/aistudio/Panoramic_Lunar_Surface_Map_c6c39a37.png');
const sunPath = path.join(root, 'public/assets/aistudio/sun_7bb59800.png');
const audioPath = path.join(
  root,
  'public/assets/aistudio/Woodkid___To_The_Wilder__from_DEATH_STRANDING_2__ON_THE_BEACH____Lyric_Video__BSN1rPPKK9s__6a0105d3.mp3',
);

const result = await build({
  entryPoints: [path.join(root, 'scripts/standalone-entry.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
});

const bundledJs = result.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');

const moonBase64 = fs.readFileSync(moonPath).toString('base64');
const sunBase64 = fs.readFileSync(sunPath).toString('base64');
const audioBase64 = fs.readFileSync(audioPath).toString('base64');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sun &amp; Moon — 3D Celestial Experience</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000000;
      color: #f5f5f4;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
      -webkit-user-select: none;
    }
    #canvas-mount {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      cursor: grab;
    }
    #canvas-mount:active { cursor: grabbing; }
    #loading-curtain {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000000;
      pointer-events: none;
      transition: opacity 700ms ease;
    }
    #error-box {
      display: none;
      pointer-events: auto;
      max-width: 380px;
      padding: 20px 24px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: #08080a;
      text-align: center;
    }
    #error-box h2 { font-size: 14px; font-weight: 500; color: #fde68a; }
    #error-box p { margin-top: 8px; font-size: 12px; line-height: 1.5; color: #a8a29e; word-break: break-word; }
    #context-lost {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 30;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.85);
    }
    #context-lost div {
      padding: 16px 24px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: #08080a;
      font-size: 14px;
      color: #e7e5e4;
    }
    .sound-dock {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(7, 7, 9, 0.9);
    }
    .sound-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #e7e5e4;
      cursor: pointer;
      transition: background 150ms ease, color 150ms ease;
    }
    .sound-btn:hover { background: rgba(255,255,255,0.08); color: #fde68a; }
    .sound-btn:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
    .sound-btn svg { width: 16px; height: 16px; display: none; }
    .sound-btn svg.active-amber { color: #fcd34d; }
    #play-label {
      display: none;
      border: none;
      background: transparent;
      color: #d6d3d1;
      font-size: 12px;
      font-weight: 500;
      padding-right: 4px;
      cursor: pointer;
      white-space: nowrap;
    }
    #play-label:hover { color: #fde68a; }
    input[type="range"].celestial-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 88px;
      background: transparent;
      cursor: pointer;
    }
    input[type="range"].celestial-slider::-webkit-slider-runnable-track {
      height: 3px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.16);
    }
    input[type="range"].celestial-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: #f59e0b;
      border: 2px solid #fef3c7;
      margin-top: -4.5px;
    }
    input[type="range"].celestial-slider::-moz-range-track {
      height: 3px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.16);
    }
    input[type="range"].celestial-slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: #f59e0b;
      border: 2px solid #fef3c7;
    }
  </style>
</head>
<body>
  <div id="canvas-mount" aria-label="Cinematic 3D Sun and Moon experience"></div>

  <div id="loading-curtain">
    <div id="error-box">
      <h2>Unable to Render Scene</h2>
      <p id="error-text"></p>
    </div>
  </div>

  <div id="context-lost">
    <div>Restoring graphics context...</div>
  </div>

  <div class="sound-dock" role="region" aria-label="Sound controls">
    <button id="sound-toggle" class="sound-btn" type="button" aria-label="Mute sound">
      <svg id="icon-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>
        <line x1="22" x2="16" y1="9" y2="15"/>
        <line x1="16" x2="22" y1="9" y2="15"/>
      </svg>
      <svg id="icon-low" class="active-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>
        <path d="M16 9a5 5 0 0 1 0 6"/>
      </svg>
      <svg id="icon-high" class="active-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>
        <path d="M16 9a5 5 0 0 1 0 6"/>
        <path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>
      </svg>
    </button>
    <button id="play-label" type="button">Play sound</button>
    <input id="volume-slider" class="celestial-slider" type="range" min="0" max="1" step="0.01" value="0.72" aria-label="Volume" />
  </div>

  <script type="text/plain" id="asset-moon">${moonBase64}</script>
  <script type="text/plain" id="asset-sun">${sunBase64}</script>
  <script type="text/plain" id="asset-audio">${audioBase64}</script>
  <script>${bundledJs}</script>
</body>
</html>
`;

const outPath = path.join(root, 'public/sun-and-moon.html');
fs.writeFileSync(outPath, html, 'utf8');
const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
console.log(`Standalone HTML generated at ${outPath} (${sizeMB} MB)`);
