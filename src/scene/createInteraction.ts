import * as THREE from 'three';

export interface InteractionRig {
  group: THREE.Group;
  update: (
    elapsed: number,
    sunPos: THREE.Vector3,
    moonPos: THREE.Vector3,
    camera: THREE.Camera,
    mergeAmount: number,
  ) => void;
  dispose: () => void;
}

const ECLIPSE_FLARE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ECLIPSE_FLARE_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Subtle cinematic anamorphic streak + warm solar convergence halo (no dots or clutter)
    float streak = exp(-abs(p.y) * 38.0) * exp(-abs(p.x) * 1.9);
    float ringHalo = exp(-pow((r - 0.34) * 9.0, 2.0)) * 0.32;
    float softCore = exp(-r * 4.5) * 0.25;

    float breathe = 0.94 + 0.06 * sin(uTime * 1.6);
    float total = (streak * 0.85 + ringHalo + softCore) * uIntensity * breathe;

    vec3 warmGold = vec3(1.0, 0.58, 0.20);
    vec3 incandescent = vec3(1.0, 0.90, 0.72);
    vec3 col = mix(warmGold, incandescent, clamp(streak + softCore, 0.0, 1.0));

    gl_FragColor = vec4(col * total, clamp(total * 0.85, 0.0, 0.82));
  }
`;

// Pre-allocated vectors for zero per-frame allocations
const _camToSun = new THREE.Vector3();
const _camToMoon = new THREE.Vector3();
const _flarePos = new THREE.Vector3();

export function createInteractionSystem(_pixelRatio: number): InteractionRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Pure cinematic optical lens flare & convergence corona glow during alignment/merge
  // (All dots/particles and lines between the Sun and Moon removed for clean realism)
  const flareGeo = new THREE.PlaneGeometry(9.2, 9.2);
  const flareMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: ECLIPSE_FLARE_VERTEX,
    fragmentShader: ECLIPSE_FLARE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const lensFlare = new THREE.Mesh(flareGeo, flareMat);
  lensFlare.renderOrder = 10;
  group.add(lensFlare);
  disposables.push(flareGeo, flareMat);

  return {
    group,
    update: (elapsed, sunPos, moonPos, camera, mergeAmount) => {
      _camToSun.subVectors(sunPos, camera.position).normalize();
      _camToMoon.subVectors(moonPos, camera.position).normalize();

      const alignment = Math.max(0, _camToSun.dot(_camToMoon));
      const alignCurve = Math.pow(Math.max(0, (alignment - 0.82) / 0.18), 2.2);
      const mergeCurve = Math.pow(mergeAmount, 2.0);
      const flareIntensity = Math.min(0.65, alignCurve * 0.52 + mergeCurve * 0.24);

      _flarePos.copy(sunPos).lerp(moonPos, 0.5);
      lensFlare.position.copy(_flarePos);
      lensFlare.quaternion.copy(camera.quaternion);
      flareMat.uniforms.uIntensity.value = flareIntensity;
      flareMat.uniforms.uTime.value = elapsed;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
