import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createInteractionSystem, type InteractionRig } from './createInteraction';
import { createMoon, type MoonRig } from './createMoon';
import { createSpaceEnvironment, type SpaceEnvironmentRig } from './createSpaceEnvironment';
import { createSun, SUN_RADIUS, type SunRig } from './createSun';
import {
  createLunarTextures,
  createSolarTextures,
  MOON_TEXTURE_URL,
  SUN_TEXTURE_URL,
  type LunarTextureSet,
  type SolarTextureSet,
} from './texturePipeline';

export interface CelestialCallbacks {
  onReady?: () => void;
  onError?: (message: string) => void;
  onContextLost?: (lost: boolean) => void;
  moonTextureUrl?: string;
  sunTextureUrl?: string;
}

// Pre-allocated math helpers for zero GC inside the render loop
const _sunPos = new THREE.Vector3();
const _moonPos = new THREE.Vector3();
const _sunToMoon = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _midFocus = new THREE.Vector3();
const _rimOffset = new THREE.Vector3(0, 3.2, 4.5);

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class CelestialExperience {
  private container: HTMLElement;
  private callbacks: CelestialCallbacks;
  private isSoftwareGl: boolean;
  private isMobile: boolean;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private envTexture: THREE.Texture | null = null;

  private spaceRig: SpaceEnvironmentRig | null = null;
  private sunRig: SunRig | null = null;
  private moonRig: MoonRig | null = null;
  private interactionRig: InteractionRig | null = null;

  private solarDirLight!: THREE.DirectionalLight;
  private solarPointLight!: THREE.PointLight;
  private coolRimLight!: THREE.DirectionalLight;

  private lunarTextures: LunarTextureSet | null = null;
  private solarTextures: SolarTextureSet | null = null;

  private frameId = 0;
  private isDisposed = false;
  private isContextLost = false;
  private userControlling = false;
  private lastUserInteraction = 0;

  private lastTimestamp = 0;
  private simTime = 0;
  private reducedMotion = false;

  private handleResizeBound: () => void;
  private handleContextLostBound: (e: Event) => void;
  private handleContextRestoredBound: () => void;

  constructor(container: HTMLElement, callbacks: CelestialCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();
    this.isMobile = window.innerWidth < 768;
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.handleResizeBound = this.onResize.bind(this);
    this.handleContextLostBound = this.onContextLost.bind(this);
    this.handleContextRestoredBound = this.onContextRestored.bind(this);

    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const width = Math.max(1, this.container.clientWidth || window.innerWidth);
      const height = Math.max(1, this.container.clientHeight || window.innerHeight);

      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.04;
      this.renderer.setPixelRatio(
        this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      );
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = !this.isSoftwareGl;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.container.innerHTML = '';
      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.container.appendChild(this.renderer.domElement);

      this.renderer.domElement.addEventListener(
        'webglcontextlost',
        this.handleContextLostBound,
        false,
      );
      this.renderer.domElement.addEventListener(
        'webglcontextrestored',
        this.handleContextRestoredBound,
        false,
      );

      this.scene = new THREE.Scene();
      // True pitch-black deep space background
      this.scene.background = new THREE.Color('#000000');

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTexture;
      pmrem.dispose();

      const aspect = width / height;
      const startZ = aspect < 1 ? 15.6 : 11.4;
      this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 350);
      this.camera.position.set(0.0, 0.45, startZ);

      // Subtle optional 360° user inspection; returns smoothly to autonomous cinematic drift when idle
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = !this.isSoftwareGl;
      this.controls.dampingFactor = 0.055;
      this.controls.enablePan = false;
      this.controls.minDistance = 3.2;
      this.controls.maxDistance = 28;
      this.controls.rotateSpeed = 0.6;
      this.controls.zoomSpeed = 0.8;
      this.controls.target.set(0, 0, 0);

      this.controls.addEventListener('start', () => {
        this.userControlling = true;
        this.lastUserInteraction = performance.now();
      });
      this.controls.addEventListener('end', () => {
        this.lastUserInteraction = performance.now();
      });

      this.setupLighting();

      const pixelRatio = this.renderer.getPixelRatio();
      const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

      const moonUrl = this.callbacks.moonTextureUrl || MOON_TEXTURE_URL;
      const sunUrl = this.callbacks.sunTextureUrl || SUN_TEXTURE_URL;

      const [lunarTextures, solarTextures] = await Promise.all([
        createLunarTextures(moonUrl, maxAnisotropy, this.isMobile),
        createSolarTextures(sunUrl, maxAnisotropy, this.isMobile),
      ]);

      if (this.isDisposed) {
        lunarTextures.dispose();
        solarTextures.dispose();
        return;
      }

      this.lunarTextures = lunarTextures;
      this.solarTextures = solarTextures;

      this.spaceRig = createSpaceEnvironment(pixelRatio);
      this.scene.add(this.spaceRig.group);

      this.sunRig = createSun(solarTextures, lunarTextures.colorMap);
      this.scene.add(this.sunRig.group);

      this.moonRig = createMoon(lunarTextures);
      this.scene.add(this.moonRig.group);

      this.interactionRig = createInteractionSystem(pixelRatio);
      this.scene.add(this.interactionRig.group);

      if (!this.isSoftwareGl) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.4,
          0.55,
          0.84,
        );
        this.composer.addPass(this.bloomPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
      }

      this.updateCelestialKinematics(0);

      if (!this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.camera);
      }

      window.addEventListener('resize', this.handleResizeBound);

      this.lastTimestamp = performance.now();
      this.callbacks.onReady?.();
      this.tick();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to initialize 3D celestial scene.';
      this.callbacks.onError?.(message);
    }
  }

  private setupLighting(): void {
    // 1. Dynamic warm solar directional light illuminating the Moon's displaced craters
    this.solarDirLight = new THREE.DirectionalLight(0xffa452, 3.6);
    this.solarDirLight.castShadow = !this.isSoftwareGl;
    this.solarDirLight.shadow.mapSize.width = 2048;
    this.solarDirLight.shadow.mapSize.height = 2048;
    this.solarDirLight.shadow.camera.near = 0.5;
    this.solarDirLight.shadow.camera.far = 26;
    const d = 3.2;
    this.solarDirLight.shadow.camera.left = -d;
    this.solarDirLight.shadow.camera.right = d;
    this.solarDirLight.shadow.camera.top = d;
    this.solarDirLight.shadow.camera.bottom = -d;
    this.solarDirLight.shadow.bias = -0.0004;
    this.solarDirLight.shadow.normalBias = 0.02;
    this.scene.add(this.solarDirLight);
    this.scene.add(this.solarDirLight.target);

    // 2. Intense warm solar point light for natural inverse-square orange falloff across the Moon
    this.solarPointLight = new THREE.PointLight(0xff7e26, 28, 28, 1.4);
    this.scene.add(this.solarPointLight);

    // 3. Subtle cool starlight hemisphere fill so the Moon's dark hemisphere stays visibly rocky & complete
    const spaceHemi = new THREE.HemisphereLight(0x4b638a, 0x0b0f18, 0.36);
    this.scene.add(spaceHemi);

    // 4. Delicate front-side lunar earthshine / starlight fill so during total eclipse merge
    // the Moon's craters remain hauntingly visible rather than turning into a blank hole
    this.coolRimLight = new THREE.DirectionalLight(0x6b84ad, 0.34);
    this.coolRimLight.position.set(4, 3, 10);
    this.scene.add(this.coolRimLight);
  }

  private computeMergePhase(): number {
    // Continuous, automatic physical Sun-Moon merge & separation (~32s full cycle)
    // Starts cleanly side-by-side and steadily pulls the Moon straight into the Sun
    const raw = 0.5 - 0.5 * Math.cos(this.simTime * 0.2 + 0.45);
    const s1 = raw * raw * (3 - 2 * raw);
    return s1 * s1 * (3 - 2 * s1);
  }

  private updateCelestialKinematics(delta: number): void {
    const merge = this.computeMergePhase();
    const floatT = this.simTime * 0.16;

    // Physical Sun + Moon merge:
    // Both spheres glide smoothly from side-by-side straight into the exact same center (0, 0, 0).
    // As the Moon physically penetrates the Sun's fiery photosphere, molten plasma ignites along
    // the contact boundary and lunar craters fuse directly across the blazing unified star.
    const sunX = THREE.MathUtils.lerp(-3.35, 0.0, merge);
    const moonX = THREE.MathUtils.lerp(3.55, 0.0, merge);
    const sunZ = THREE.MathUtils.lerp(-0.18, 0.0, merge);
    const moonZ = THREE.MathUtils.lerp(0.24, 0.0, merge);

    const sunFloatY = Math.sin(floatT * 0.85) * 0.15 * (1 - merge);
    const moonFloatY = Math.cos(floatT * 0.92 + 0.5) * 0.2 * (1 - merge);

    _sunPos.set(sunX, sunFloatY, sunZ);
    _moonPos.set(moonX, moonFloatY, moonZ);

    if (this.moonRig) {
      this.moonRig.group.position.copy(_moonPos);
      // Settle smoothly inside the Sun's core once completely enveloped (zero Z-fighting)
      const coreScale = THREE.MathUtils.lerp(1.0, 0.9, THREE.MathUtils.smoothstep(merge, 0.78, 1.0));
      this.moonRig.group.scale.setScalar(coreScale);
      this.moonRig.update(this.simTime, delta, _sunPos, merge);
    }

    const moonRotY = this.moonRig ? this.moonRig.sphere.rotation.y : 0;

    if (this.sunRig) {
      this.sunRig.group.position.copy(_sunPos);
      this.sunRig.update(this.simTime, delta, this.camera, _moonPos, moonRotY, merge);
    }

    // Dynamic solar light tracks the live Sun-to-Moon vector (safely clamped as distance nears 0)
    _sunToMoon.subVectors(_moonPos, _sunPos);
    if (_sunToMoon.lengthSq() > 0.0001) {
      _sunToMoon.normalize();
    } else {
      _sunToMoon.set(1, 0, 0);
    }

    this.solarDirLight.position.copy(_sunPos);
    this.solarDirLight.target.position.copy(_moonPos);
    this.solarDirLight.target.updateMatrixWorld();
    this.solarDirLight.intensity = THREE.MathUtils.lerp(3.5, 5.0, merge);

    this.solarPointLight.position
      .copy(_sunPos)
      .addScaledVector(_sunToMoon, SUN_RADIUS * 0.88 * (1 - merge * 0.5));
    this.solarPointLight.intensity = THREE.MathUtils.lerp(24, 44, merge);

    this.coolRimLight.position.copy(_moonPos).add(_rimOffset);
    this.coolRimLight.intensity = THREE.MathUtils.lerp(0.28, 0.18, merge);

    if (this.interactionRig) {
      this.interactionRig.update(this.simTime, _sunPos, _moonPos, this.camera, merge);
    }

    if (this.spaceRig) {
      this.spaceRig.update(this.simTime, delta);
    }

    this.updateCamera(delta, merge);
  }

  private updateCamera(delta: number, merge: number): void {
    // If user manually rotated, smoothly hand back to autonomous cinema after 7s of stillness
    if (this.userControlling && performance.now() - this.lastUserInteraction > 7000) {
      this.userControlling = false;
    }

    if (!this.userControlling) {
      const aspect = this.camera.aspect || 1.6;
      const responsiveScale = aspect < 1 ? 1.48 : aspect < 1.35 ? 1.18 : 1.0;

      _midFocus.copy(_sunPos).lerp(_moonPos, 0.5);
      _desiredTarget.copy(_midFocus);

      // Smoothly move closer during the celestial merge, then gently pull back as they part
      const camZ = THREE.MathUtils.lerp(11.6, 8.9, merge) * responsiveScale;
      const swayX = Math.sin(this.simTime * 0.11) * 1.15 * (1 - merge * 0.72);
      const swayY = 0.25 + Math.sin(this.simTime * 0.14 + 0.6) * 0.42 * (1 - merge * 0.65);

      _desiredCamPos.set(_midFocus.x + swayX, _midFocus.y + swayY, _midFocus.z + camZ);

      const dampFactor = 1 - Math.exp(-1.5 * delta);
      this.camera.position.lerp(_desiredCamPos, dampFactor);
      this.controls.target.lerp(_desiredTarget, dampFactor);
    }

    this.controls.update();
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.isDisposed) return;

    const now = performance.now();
    const rawDelta = Math.min(0.08, Math.max(0.001, (now - this.lastTimestamp) / 1000));
    this.lastTimestamp = now;

    if (!this.isContextLost) {
      const speedScale = this.reducedMotion ? 0.35 : 1.0;
      const effectiveDelta = rawDelta * speedScale;
      this.simTime += effectiveDelta;

      this.updateCelestialKinematics(effectiveDelta);

      if (this.isSoftwareGl || !this.composer) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private onResize(): void {
    if (this.isDisposed || !this.renderer) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  }

  private onContextLost(event: Event): void {
    event.preventDefault();
    this.isContextLost = true;
    this.callbacks.onContextLost?.(true);
  }

  private onContextRestored(): void {
    this.isContextLost = false;
    this.callbacks.onContextLost?.(false);
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResizeBound);

    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener(
        'webglcontextlost',
        this.handleContextLostBound,
      );
      this.renderer.domElement.removeEventListener(
        'webglcontextrestored',
        this.handleContextRestoredBound,
      );
    }

    this.controls?.dispose();
    this.spaceRig?.dispose();
    this.sunRig?.dispose();
    this.moonRig?.dispose();
    this.interactionRig?.dispose();
    this.lunarTextures?.dispose();
    this.solarTextures?.dispose();
    this.envTexture?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}
