import * as THREE from 'three';
import type { SolarTextureSet } from './texturePipeline';

export const SUN_RADIUS = 2.65;

export interface SunRig {
  group: THREE.Group;
  sphere: THREE.Mesh;
  applyTextures: (textures: SolarTextureSet) => void;
  update: (
    elapsed: number,
    delta: number,
    camera: THREE.Camera,
    moonWorldPos: THREE.Vector3,
    moonRotY: number,
    mergeAmount: number,
  ) => void;
  dispose: () => void;
}

const NOISE_3D_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const SUN_SURFACE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uMerge;
  uniform vec3 uMoonPosition;
  varying vec2 vUv;
  varying vec3 vLocalDir;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  ${NOISE_3D_GLSL}

  void main() {
    vUv = uv;
    vLocalDir = normalize(position);

    vec4 initialWorld = modelMatrix * vec4(position, 1.0);
    float distToMoon = length(initialWorld.xyz - uMoonPosition);
    // Gentle plasma swell on the Sun's surface where the Moon physically enters and merges
    float entryRipple = exp(-pow(distToMoon - 1.58, 2.0) * 3.8) * uMerge;

    float boil = snoise(vLocalDir * 4.2 + vec3(uTime * 0.14, -uTime * 0.11, uTime * 0.09));
    float micro = snoise(vLocalDir * 9.5 - vec3(uTime * 0.22, uTime * 0.16, -uTime * 0.13));
    float disp = (boil * 0.65 + micro * 0.35) * (0.018 + 0.022 * uMerge) + entryRipple * 0.055;

    vec3 displaced = position + normal * disp;
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SUN_SURFACE_FRAGMENT = /* glsl */ `
  uniform sampler2D uSolarMap;
  uniform sampler2D uActivityMap;
  uniform sampler2D uMoonMap;
  uniform float uTime;
  uniform float uMerge;
  uniform float uMoonRotY;
  uniform vec3 uMoonPosition;

  varying vec2 vUv;
  varying vec3 vLocalDir;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  ${NOISE_3D_GLSL}

  vec2 safeEquirectUv(vec2 uv) {
    return vec2(fract(uv.x), clamp(uv.y, 0.002, 0.998));
  }

  void main() {
    vec3 dir = normalize(vLocalDir);

    float nA = snoise(dir * 3.6 + vec3(uTime * 0.12, -uTime * 0.09, uTime * 0.07));
    float nB = snoise(dir * 7.2 - vec3(uTime * 0.17, uTime * 0.14, -uTime * 0.11));
    float nC = snoise(dir * 13.0 + vec3(-uTime * 0.24, uTime * 0.19, uTime * 0.15));

    float poleSafe = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265);
    vec2 flow1 = vec2(nA, nB) * (0.011 + 0.006 * uMerge) * poleSafe;
    vec2 flow2 = vec2(-nB, nC) * 0.0065 * poleSafe;

    vec3 texBase = texture2D(uSolarMap, safeEquirectUv(vUv + flow1)).rgb;
    vec3 texSwirl = texture2D(uSolarMap, safeEquirectUv(vUv + flow2 + vec2(uTime * 0.0025, 0.0))).rgb;
    float activity = texture2D(uActivityMap, safeEquirectUv(vUv + flow1)).r;

    vec3 surface = mix(texBase, texSwirl, 0.34);

    // Incandescent shockwave ring along the exact physical boundary where the Moon enters the Sun
    float distToMoon = length(vWorldPos - uMoonPosition);
    float contactRing = exp(-pow(distToMoon - 1.56, 2.0) * 4.5) * smoothstep(0.25, 0.72, uMerge) * smoothstep(0.99, 0.84, uMerge);
    surface += vec3(1.5, 0.92, 0.42) * contactRing * (0.65 + 0.35 * nB);

    // Full celestial merge: as the Moon fuses completely into the Sun, lunar craters & basalt maria
    // imprint across the blazing star—dark cool-charred maria framed by incandescent molten crater ridges!
    float fusionBlend = smoothstep(0.62, 0.98, uMerge);
    if (fusionBlend > 0.001) {
      vec2 moonUv = safeEquirectUv(vec2(vUv.x - uMoonRotY * 0.15915494, vUv.y) + flow1 * 0.45);
      float lunarLum = texture2D(uMoonMap, moonUv).r;

      // Darken lunar maria into dramatic glowing obsidian-ember valleys; ignite bright lunar craters & rays
      vec3 lunarShadow = mix(vec3(0.12, 0.04, 0.02), vec3(0.95, 0.56, 0.22), smoothstep(0.18, 0.65, lunarLum));
      vec3 lunarHighlight = vec3(1.45, 1.05, 0.62) * smoothstep(0.58, 0.96, lunarLum);
      vec3 fusedLook = surface * (0.45 + 0.95 * lunarShadow) + lunarHighlight * 0.55;

      // Swirl fusion transition organically with 3D plasma noise
      float organicMask = clamp(fusionBlend * 1.15 + nA * 0.14 * fusionBlend, 0.0, 1.0);
      surface = mix(surface, fusedLook, organicMask * 0.78);
    }

    // Living incandescent pulse in active solar zones
    float plasmaPulse = 0.5 + 0.5 * snoise(dir * 5.8 + vec3(0.0, uTime * 0.28, -uTime * 0.19));
    float hotBoost = activity * (0.14 + 0.20 * plasmaPulse + 0.16 * uMerge);
    surface += vec3(1.0, 0.52, 0.12) * hotBoost * 0.38;

    // Solar limb darkening + molten chromosphere rim
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndotv = clamp(dot(N, V), 0.0, 1.0);

    float limbCurve = pow(ndotv, 0.28);
    vec3 limbTint = mix(vec3(1.05, 0.34, 0.06), vec3(1.02, 0.96, 0.88), limbCurve);
    vec3 color = surface * limbTint;

    // Bright silvery-gold eclipse corona rim surges slightly during full Sun-Moon fusion
    float rim = pow(1.0 - ndotv, 2.9);
    vec3 rimCol = mix(vec3(1.35, 0.56, 0.10), vec3(1.45, 0.88, 0.48), fusionBlend);
    color += rimCol * rim * (0.58 + 0.42 * uMerge);

    color *= (1.08 + 0.14 * uMerge);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CHROMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalDir;

  void main() {
    vLocalDir = normalize(position);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const CHROMOSPHERE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMerge;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalDir;

  ${NOISE_3D_GLSL}

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndotv = max(dot(N, V), 0.0);

    float rim = pow(1.0 - ndotv, 2.6);
    float flareNoise = 0.55 + 0.45 * snoise(vLocalDir * 5.2 + vec3(uTime * 0.32, -uTime * 0.25, uTime * 0.18));
    float heatWave = 0.65 + 0.35 * snoise(vLocalDir * 11.0 - vec3(uTime * 0.45, uTime * 0.3, 0.0));

    float intensity = rim * flareNoise * heatWave * (0.72 + 0.52 * uMerge);
    vec3 col = mix(vec3(1.0, 0.26, 0.04), vec3(1.0, 0.82, 0.42), flareNoise * rim + uMerge * 0.25);

    gl_FragColor = vec4(col * intensity * 1.18, clamp(intensity * 0.88, 0.0, 0.92));
  }
`;

const CORONA_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORONA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMerge;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float discEdge = 0.445;
    float outsideDisc = smoothstep(discEdge - 0.06, discEdge + 0.025, r);
    float decayRate = mix(4.6, 3.6, uMerge);
    float radialDecay = exp(-max(0.0, r - discEdge) * decayRate);
    float outerFade = smoothstep(1.0, 0.56, r);

    float angle = atan(p.y, p.x);
    float ray1 = noise2D(vec2(angle * 4.5 + uTime * 0.08, r * 3.5 - uTime * 0.26));
    float ray2 = noise2D(vec2(angle * 9.0 - uTime * 0.12, r * 6.0 - uTime * 0.42));
    float streamers = 0.62 + 0.38 * (ray1 * 0.65 + ray2 * 0.35);

    float heatShimmer = 0.92 + 0.08 * sin(r * 36.0 - uTime * 3.2 + ray1 * 4.0);

    float glow = outsideDisc * radialDecay * outerFade * streamers * heatShimmer;
    float boost = 0.85 + 0.48 * uMerge;

    vec3 innerCol = mix(vec3(1.0, 0.72, 0.28), vec3(1.0, 0.86, 0.56), uMerge * 0.55);
    vec3 midCol = vec3(1.0, 0.38, 0.06);
    vec3 outerCol = vec3(0.75, 0.14, 0.02);

    float t = clamp((r - discEdge) / (1.0 - discEdge), 0.0, 1.0);
    vec3 col = mix(innerCol, midCol, smoothstep(0.0, 0.35, t));
    col = mix(col, outerCol, smoothstep(0.32, 0.9, t));

    gl_FragColor = vec4(col * glow * boost * 0.92, clamp(glow * boost * 0.82, 0.0, 0.92));
  }
`;

const FLARE_LOOP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLARE_LOOP_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uMerge;
  varying vec2 vUv;

  void main() {
    float archMask = sin(vUv.x * 3.14159265);
    float core = pow(sin(vUv.y * 3.14159265), 1.6);

    float surge1 = 0.5 + 0.5 * sin(vUv.x * 14.0 - uTime * 2.2 + uPhase);
    float surge2 = 0.5 + 0.5 * sin(vUv.x * 23.0 + uTime * 1.4 - uPhase * 1.7);
    float lifePulse = 0.55 + 0.45 * sin(uTime * 0.65 + uPhase * 2.1);

    float intensity = archMask * core * (0.45 + 0.55 * (surge1 * 0.65 + surge2 * 0.35)) * lifePulse;
    intensity *= (0.75 + 0.75 * uMerge);

    vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.88, 0.52), surge1 * archMask + uMerge * 0.25);
    gl_FragColor = vec4(col * intensity * 1.25, clamp(intensity * 0.88, 0.0, 0.92));
  }
`;

function createSolarFlareLoop(
  radius: number,
  latDeg: number,
  lonDeg: number,
  spanDeg: number,
  archHeight: number,
  tiltRad: number,
  phase: number,
): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; geometry: THREE.TubeGeometry } {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const halfSpan = THREE.MathUtils.degToRad(spanDeg * 0.5);

  const dir1 = new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon - halfSpan),
    Math.sin(lat),
    Math.cos(lat) * Math.sin(lon - halfSpan),
  ).normalize();

  const dir2 = new THREE.Vector3(
    Math.cos(lat + Math.sin(tiltRad) * 0.14) * Math.cos(lon + halfSpan),
    Math.sin(lat + Math.sin(tiltRad) * 0.14),
    Math.cos(lat + Math.sin(tiltRad) * 0.14) * Math.sin(lon + halfSpan),
  ).normalize();

  const midDir = dir1.clone().add(dir2).normalize();
  const sideAxis = dir1.clone().cross(dir2).normalize();
  midDir.addScaledVector(sideAxis, Math.sin(tiltRad) * 0.18).normalize();

  const p0 = dir1.clone().multiplyScalar(radius * 0.975);
  const p3 = dir2.clone().multiplyScalar(radius * 0.975);
  const p1 = dir1.clone().lerp(midDir, 0.55).normalize().multiplyScalar(radius + archHeight);
  const p2 = dir2.clone().lerp(midDir, 0.55).normalize().multiplyScalar(radius + archHeight);

  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  const geometry = new THREE.TubeGeometry(curve, 44, 0.036, 10, false);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
      uMerge: { value: 0 },
    },
    vertexShader: FLARE_LOOP_VERTEX,
    fragmentShader: FLARE_LOOP_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  return { mesh, material, geometry };
}

export function createSun(textures: SolarTextureSet, moonColorMap: THREE.Texture): SunRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const sphereGeo = new THREE.SphereGeometry(SUN_RADIUS, 160, 128);
  const surfaceMat = new THREE.ShaderMaterial({
    uniforms: {
      uSolarMap: { value: textures.colorMap },
      uActivityMap: { value: textures.activityMap },
      uMoonMap: { value: moonColorMap },
      uTime: { value: 0 },
      uMerge: { value: 0 },
      uMoonRotY: { value: 0 },
      uMoonPosition: { value: new THREE.Vector3(4, 0, 0) },
    },
    vertexShader: SUN_SURFACE_VERTEX,
    fragmentShader: SUN_SURFACE_FRAGMENT,
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  const sphere = new THREE.Mesh(sphereGeo, surfaceMat);
  sphere.rotation.z = THREE.MathUtils.degToRad(-7.25);
  group.add(sphere);
  disposables.push(sphereGeo, surfaceMat);

  const chromoGeo = new THREE.SphereGeometry(SUN_RADIUS * 1.035, 96, 64);
  const chromoMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMerge: { value: 0 },
    },
    vertexShader: CHROMOSPHERE_VERTEX,
    fragmentShader: CHROMOSPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const chromosphere = new THREE.Mesh(chromoGeo, chromoMat);
  chromosphere.renderOrder = 2;
  group.add(chromosphere);
  disposables.push(chromoGeo, chromoMat);

  const flareConfigs = [
    { lat: 18, lon: 15, span: 22, height: 0.42, tilt: 0.4, phase: 0.2 },
    { lat: -22, lon: 85, span: 26, height: 0.48, tilt: -0.5, phase: 1.7 },
    { lat: 12, lon: 160, span: 20, height: 0.36, tilt: 0.7, phase: 3.1 },
    { lat: -14, lon: 235, span: 24, height: 0.44, tilt: -0.3, phase: 4.5 },
    { lat: 28, lon: 300, span: 18, height: 0.34, tilt: 0.6, phase: 5.8 },
    { lat: -8, lon: -25, span: 25, height: 0.5, tilt: -0.45, phase: 2.4 },
  ];

  const flareMaterials: THREE.ShaderMaterial[] = [];
  for (const cfg of flareConfigs) {
    const loop = createSolarFlareLoop(
      SUN_RADIUS,
      cfg.lat,
      cfg.lon,
      cfg.span,
      cfg.height,
      cfg.tilt,
      cfg.phase,
    );
    sphere.add(loop.mesh);
    flareMaterials.push(loop.material);
    disposables.push(loop.geometry, loop.material);
  }

  const coronaGeo = new THREE.PlaneGeometry(SUN_RADIUS * 4.55, SUN_RADIUS * 4.55);
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMerge: { value: 0 },
    },
    vertexShader: CORONA_VERTEX,
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const coronaBillboard = new THREE.Mesh(coronaGeo, coronaMat);
  coronaBillboard.renderOrder = 1;
  group.add(coronaBillboard);
  disposables.push(coronaGeo, coronaMat);

  return {
    group,
    sphere,
    applyTextures: (newTextures: SolarTextureSet) => {
      surfaceMat.uniforms.uSolarMap.value = newTextures.colorMap;
      surfaceMat.uniforms.uActivityMap.value = newTextures.activityMap;
    },
    update: (elapsed, delta, camera, moonWorldPos, moonRotY, mergeAmount) => {
      sphere.rotation.y += delta * 0.036;

      // Subtle majestic swell as the Moon physically merges into the Sun
      const swell = 1.0 + 0.065 * Math.pow(mergeAmount, 1.8);
      group.scale.setScalar(swell);

      surfaceMat.uniforms.uTime.value = elapsed;
      surfaceMat.uniforms.uMerge.value = mergeAmount;
      surfaceMat.uniforms.uMoonRotY.value = moonRotY;
      surfaceMat.uniforms.uMoonPosition.value.copy(moonWorldPos);

      chromoMat.uniforms.uTime.value = elapsed;
      chromoMat.uniforms.uMerge.value = mergeAmount;

      coronaMat.uniforms.uTime.value = elapsed;
      coronaMat.uniforms.uMerge.value = mergeAmount;
      coronaBillboard.quaternion.copy(camera.quaternion);

      for (let i = 0; i < flareMaterials.length; i++) {
        flareMaterials[i].uniforms.uTime.value = elapsed;
        flareMaterials[i].uniforms.uMerge.value = mergeAmount;
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
