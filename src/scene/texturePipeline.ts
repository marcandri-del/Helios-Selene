import * as THREE from 'three';

export const SUN_TEXTURE_URL = '/assets/aistudio/sun_7bb59800.png';
export const MOON_TEXTURE_URL = '/assets/aistudio/Panoramic_Lunar_Surface_Map_c6c39a37.png';

export interface LunarTextureSet {
  colorMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  displacementMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

export interface SolarTextureSet {
  colorMap: THREE.CanvasTexture;
  activityMap: THREE.CanvasTexture;
  dispose: () => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load texture image: ${url.slice(0, 80)} (${String(err)})`));
    img.src = url;
  });
}

function createEquirectangularCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
  forceGrayscale = false,
): { canvas: HTMLCanvasElement; imageData: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context for texture processing');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Enforce strict monochrome lunar grayscale if requested while preserving full tonal range
  if (forceGrayscale) {
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      data[i] = lum;
      data[i + 1] = lum;
      data[i + 2] = lum;
      data[i + 3] = 255;
    }
  }

  // Ensure exact seamless horizontal wrap along the u=0 / u=1 meridian (narrow 1.5% cosine feather)
  // so no visible vertical seam can appear on the 360° sphere.
  const blendCols = Math.max(8, Math.floor(width * 0.016));
  const leftCopy = new Uint8ClampedArray(blendCols * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < blendCols; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * blendCols + x) * 4;
      leftCopy[dstIdx] = data[srcIdx];
      leftCopy[dstIdx + 1] = data[srcIdx + 1];
      leftCopy[dstIdx + 2] = data[srcIdx + 2];
      leftCopy[dstIdx + 3] = 255;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let k = 0; k < blendCols; k++) {
      const t = 0.5 * (1 - Math.cos((Math.PI * k) / blendCols)); // 0 -> 1 smoothly
      const rx = width - blendCols + k;
      const rIdx = (y * width + rx) * 4;
      const lIdx = (y * blendCols + k) * 4;

      data[rIdx] = Math.round(data[rIdx] * (1 - t) + leftCopy[lIdx] * t);
      data[rIdx + 1] = Math.round(data[rIdx + 1] * (1 - t) + leftCopy[lIdx + 1] * t);
      data[rIdx + 2] = Math.round(data[rIdx + 2] * (1 - t) + leftCopy[lIdx + 2] * t);
    }
  }

  // Softly unify the very top & bottom 2 rows so polar vertices share identical color without pinholes
  for (const poleRows of [
    [0, 1, 2],
    [height - 1, height - 2, height - 3],
  ]) {
    const baseRow = poleRows[0];
    let avgR = 0;
    let avgG = 0;
    let avgB = 0;
    for (let x = 0; x < width; x++) {
      const idx = (baseRow * width + x) * 4;
      avgR += data[idx];
      avgG += data[idx + 1];
      avgB += data[idx + 2];
    }
    avgR /= width;
    avgG /= width;
    avgB /= width;

    poleRows.forEach((row, step) => {
      const weight = step === 0 ? 1.0 : step === 1 ? 0.55 : 0.22;
      for (let x = 0; x < width; x++) {
        const idx = (row * width + x) * 4;
        data[idx] = Math.round(data[idx] * (1 - weight) + avgR * weight);
        data[idx + 1] = Math.round(data[idx + 1] * (1 - weight) + avgG * weight);
        data[idx + 2] = Math.round(data[idx + 2] * (1 - weight) + avgB * weight);
      }
    });
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, imageData };
}

function separableBlurPeriodic(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(width * height);
  const dst = new Float32Array(width * height);
  const windowSize = radius * 2 + 1;

  // Horizontal pass (periodic wrap across 360° longitude)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = (dx + width) % width;
      sum += src[rowOffset + sx];
    }
    for (let x = 0; x < width; x++) {
      temp[rowOffset + x] = sum / windowSize;
      const oldX = (x - radius + width) % width;
      const newX = (x + radius + 1) % width;
      sum += src[rowOffset + newX] - src[rowOffset + oldX];
    }
  }

  // Vertical pass (clamped at poles)
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const sy = Math.max(0, Math.min(height - 1, dy));
      sum += temp[sy * width + x];
    }
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / windowSize;
      const oldY = Math.max(0, Math.min(height - 1, y - radius));
      const newY = Math.max(0, Math.min(height - 1, y + radius + 1));
      sum += temp[newY * width + x] - temp[oldY * width + x];
    }
  }

  return dst;
}

function configureTexture(
  tex: THREE.CanvasTexture,
  isColor: boolean,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 16);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export async function createLunarTextures(
  url: string,
  maxAnisotropy: number,
  isMobile = false,
): Promise<LunarTextureSet> {
  const img = await loadImage(url);
  const width = isMobile ? 1024 : 2048;
  const height = isMobile ? 512 : 1024;

  const { canvas: colorCanvas, imageData } = createEquirectangularCanvas(img, width, height, true);
  const srcData = imageData.data;

  // Build normalized grayscale height array directly from the uploaded lunar texture
  const rawLum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    rawLum[i] = srcData[i * 4] / 255;
  }

  // Multi-scale relief decomposition:
  // - smoothHeight drives clean vertex displacement without spiky noise artifacts
  // - localDetail isolates sharp crater rims, ejecta ridges, and rugged lunar regolith
  const smoothHeight = separableBlurPeriodic(rawLum, width, height, isMobile ? 2 : 3);
  const broadBase = separableBlurPeriodic(smoothHeight, width, height, isMobile ? 8 : 14);

  // Prepare derivative canvases
  const dispCanvas = document.createElement('canvas');
  dispCanvas.width = width;
  dispCanvas.height = height;
  const dispCtx = dispCanvas.getContext('2d')!;
  const dispImg = dispCtx.createImageData(width, height);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(width, height);

  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = width;
  aoCanvas.height = height;
  const aoCtx = aoCanvas.getContext('2d')!;
  const aoImg = aoCtx.createImageData(width, height);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(width, height);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(width, height);

  const combinedHeight = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    // Gently attenuate displacement right at the poles so pole vertices stay watertight
    const v = (y + 0.5) / height;
    const poleMask = Math.min(1, Math.sin(v * Math.PI) * 5.0);

    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const px = i * 4;
      const lum = rawLum[i];
      const sm = smoothHeight[i];
      const br = broadBase[i];
      const detail = lum - br;

      // Height combines lunar highland elevation (brighter) + crisp local crater rim relief
      const h = Math.max(0, Math.min(1, sm * 0.72 + (0.5 + detail * 1.45) * 0.28));
      const hDisp = 0.5 + (h - 0.5) * poleMask;
      combinedHeight[i] = h;

      const dVal = Math.round(hDisp * 255);
      dispImg.data[px] = dVal;
      dispImg.data[px + 1] = dVal;
      dispImg.data[px + 2] = dVal;
      dispImg.data[px + 3] = 255;

      // Crisp micro-bump map for grazing light crater shadows
      const bVal = Math.round(Math.max(0, Math.min(1, lum * 0.55 + (0.5 + detail * 2.1) * 0.45)) * 255);
      bumpImg.data[px] = bVal;
      bumpImg.data[px + 1] = bVal;
      bumpImg.data[px + 2] = bVal;
      bumpImg.data[px + 3] = 255;

      // Ambient occlusion: softly darken crater interiors and lower valleys
      const cavity = Math.max(0, Math.min(1, 0.72 + (sm - br) * 1.15 + lum * 0.22));
      const aoVal = Math.round(cavity * 255);
      aoImg.data[px] = aoVal;
      aoImg.data[px + 1] = aoVal;
      aoImg.data[px + 2] = aoVal;
      aoImg.data[px + 3] = 255;

      // Lunar regolith roughness: dusty matte (0.85 - 0.98)
      const roughVal = Math.round((0.86 + (1 - lum) * 0.11) * 255);
      roughImg.data[px] = roughVal;
      roughImg.data[px + 1] = roughVal;
      roughImg.data[px + 2] = roughVal;
      roughImg.data[px + 3] = 255;
    }
  }

  // Periodic Sobel tangent-space normal map from lunar grayscale heightfield
  const strength = 3.4;
  for (let y = 0; y < height; y++) {
    const yUp = Math.max(0, y - 1);
    const yDn = Math.min(height - 1, y + 1);
    const v = (y + 0.5) / height;
    const poleFade = Math.min(1, Math.sin(v * Math.PI) * 4.5);

    for (let x = 0; x < width; x++) {
      const xL = (x - 1 + width) % width;
      const xR = (x + 1) % width;

      const tl = combinedHeight[yUp * width + xL];
      const t = combinedHeight[yUp * width + x];
      const tr = combinedHeight[yUp * width + xR];
      const l = combinedHeight[y * width + xL];
      const r = combinedHeight[y * width + xR];
      const bl = combinedHeight[yDn * width + xL];
      const b = combinedHeight[yDn * width + x];
      const br = combinedHeight[yDn * width + xR];

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength * poleFade;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength * poleFade;
      const dz = 1.0;

      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = -dx * invLen;
      const ny = dy * invLen;
      const nz = dz * invLen;

      const px = (y * width + x) * 4;
      normalImg.data[px] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImg.data[px + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImg.data[px + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalImg.data[px + 3] = 255;
    }
  }

  dispCtx.putImageData(dispImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  aoCtx.putImageData(aoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);

  const colorMap = configureTexture(new THREE.CanvasTexture(colorCanvas), true, maxAnisotropy);
  const normalMap = configureTexture(new THREE.CanvasTexture(normalCanvas), false, maxAnisotropy);
  const bumpMap = configureTexture(new THREE.CanvasTexture(bumpCanvas), false, maxAnisotropy);
  const displacementMap = configureTexture(new THREE.CanvasTexture(dispCanvas), false, maxAnisotropy);
  const aoMap = configureTexture(new THREE.CanvasTexture(aoCanvas), false, maxAnisotropy);
  const roughnessMap = configureTexture(new THREE.CanvasTexture(roughCanvas), false, maxAnisotropy);

  return {
    colorMap,
    normalMap,
    bumpMap,
    displacementMap,
    aoMap,
    roughnessMap,
    dispose: () => {
      colorMap.dispose();
      normalMap.dispose();
      bumpMap.dispose();
      displacementMap.dispose();
      aoMap.dispose();
      roughnessMap.dispose();
    },
  };
}

export async function createSolarTextures(
  url: string,
  maxAnisotropy: number,
  isMobile = false,
): Promise<SolarTextureSet> {
  const img = await loadImage(url);
  const width = isMobile ? 1024 : 2048;
  const height = isMobile ? 512 : 1024;

  const { canvas: colorCanvas, imageData } = createEquirectangularCanvas(img, width, height, false);
  const srcData = imageData.data;

  // Derive solar incandescent activity map directly from the uploaded image's bright yellow/gold zones
  const actCanvas = document.createElement('canvas');
  actCanvas.width = width;
  actCanvas.height = height;
  const actCtx = actCanvas.getContext('2d')!;
  const actImg = actCtx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const px = i * 4;
    const r = srcData[px] / 255;
    const g = srcData[px + 1] / 255;
    const b = srcData[px + 2] / 255;
    // Hot active regions have strong yellow/white energy (high green + blue relative to deep red)
    const heat = Math.max(0, Math.min(1, r * 0.35 + g * 0.5 + b * 0.45));
    const boosted = Math.pow(heat, 1.35);
    const val = Math.round(boosted * 255);
    actImg.data[px] = val;
    actImg.data[px + 1] = val;
    actImg.data[px + 2] = val;
    actImg.data[px + 3] = 255;
  }

  actCtx.putImageData(actImg, 0, 0);

  const colorMap = configureTexture(new THREE.CanvasTexture(colorCanvas), true, maxAnisotropy);
  const activityMap = configureTexture(new THREE.CanvasTexture(actCanvas), false, maxAnisotropy);

  return {
    colorMap,
    activityMap,
    dispose: () => {
      colorMap.dispose();
      activityMap.dispose();
    },
  };
}
