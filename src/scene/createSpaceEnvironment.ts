import * as THREE from 'three';

export interface SpaceEnvironmentRig {
  group: THREE.Group;
  update: (elapsed: number, delta: number) => void;
  dispose: () => void;
}

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = aColor;
    // Ultra-subtle realistic scintillation
    float twinkle = 0.86 + 0.14 * sin(uTime * (0.6 + fract(aPhase) * 1.1) + aPhase * 6.2831);
    vTwinkle = twinkle;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp(aSize * uPixelRatio * (185.0 / max(1.0, -mvPos.z)), 0.9, 4.2);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Razor-sharp pinpoint star core with minimal soft photographic halo
    float core = smoothstep(0.48, 0.02, d);
    float pinpoint = pow(core, 3.4);
    gl_FragColor = vec4(vColor, pinpoint * vTwinkle);
  }
`;

export function createSpaceEnvironment(pixelRatio: number): SpaceEnvironmentRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Realistic deep-space starfield against true pitch-black outer space (#000000)
  // Power-law brightness distribution: many faint tiny pinpoints, few brighter distant stars
  const starCount = 3400;
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const starColor = new Float32Array(starCount * 3);

  const palette = [
    new THREE.Color('#eef4ff'), // cool white
    new THREE.Color('#ffffff'), // pure white
    new THREE.Color('#fff5e6'), // warm white
    new THREE.Color('#d2e2ff'), // faint blue giant
    new THREE.Color('#ffe4c4'), // faint K-type gold
  ];

  let seed = 42197;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < starCount; i++) {
    const u = rand();
    const v = rand();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const radius = 85 + rand() * 85;

    starPos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = radius * Math.cos(phi);
    starPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    // Realistic astronomical magnitude curve: mostly tiny crisp distant points
    const mag = Math.pow(rand(), 4.5);
    starSize[i] = 0.52 + mag * 2.25;
    starPhase[i] = rand();

    const c = palette[Math.floor(rand() * palette.length)];
    const brightness = 0.24 + mag * 0.72;
    starColor[i * 3] = c.r * brightness;
    starColor[i * 3 + 1] = c.g * brightness;
    starColor[i * 3 + 2] = c.b * brightness;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(starColor, 3));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);
  disposables.push(starGeo, starMat);

  return {
    group,
    update: (elapsed, delta) => {
      starMat.uniforms.uTime.value = elapsed;
      stars.rotation.y += delta * 0.0014;
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
    },
  };
}
