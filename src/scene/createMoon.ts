import * as THREE from 'three';
import { SUN_RADIUS } from './createSun';
import type { LunarTextureSet } from './texturePipeline';

export const MOON_RADIUS = 1.55;

export interface MoonRig {
  group: THREE.Group;
  sphere: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  applyTextures: (textures: LunarTextureSet) => void;
  update: (elapsed: number, delta: number, sunWorldPos: THREE.Vector3, mergeAmount: number) => void;
  dispose: () => void;
}

const LUNAR_RIM_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const LUNAR_RIM_FRAGMENT = /* glsl */ `
  uniform vec3 uSunPosition;
  uniform float uMerge;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunPosition - vWorldPos);

    float ndotv = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - ndotv, 2.9);

    // Distance to Sun surface drives molten fiery aura as Moon merges into the Sun
    float distToSun = length(vWorldPos - uSunPosition);
    float contactGlow = 1.0 - smoothstep(${ (SUN_RADIUS * 0.92).toFixed(2) }, ${ (SUN_RADIUS * 1.75).toFixed(2) }, distToSun);

    float sunFacing = smoothstep(-0.22, 0.72, dot(N, L));
    vec3 warmRim = vec3(1.0, 0.52, 0.14) * fresnel * (sunFacing * (0.28 + 0.55 * uMerge) + contactGlow * 1.1);

    // Subtle cool starlight rim on the night side when separated
    float nightSide = smoothstep(0.25, -0.55, dot(N, L)) * (1.0 - contactGlow);
    vec3 coolRim = vec3(0.32, 0.48, 0.78) * pow(1.0 - ndotv, 4.0) * nightSide * 0.22;

    // Fade outer rim cleanly once fully absorbed inside the Sun's core
    float insideFade = smoothstep(0.96, 0.78, uMerge);
    vec3 totalGlow = (warmRim + coolRim) * insideFade;
    float alpha = clamp(length(totalGlow), 0.0, 0.85);

    gl_FragColor = vec4(totalGlow, alpha);
  }
`;

export function createMoon(textures: LunarTextureSet): MoonRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const geometry = new THREE.SphereGeometry(MOON_RADIUS, 192, 144);
  geometry.setAttribute('uv1', geometry.attributes.uv);
  geometry.setAttribute('uv2', geometry.attributes.uv);
  geometry.computeTangents();
  disposables.push(geometry);

  const fusionUniforms = {
    uSunCenter: { value: new THREE.Vector3(-3.5, 0, 0) },
    uSunRadius: { value: SUN_RADIUS },
    uMerge: { value: 0 },
    uTime: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f4f2ee'),
    map: textures.colorMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    bumpMap: textures.bumpMap,
    bumpScale: 0.025,
    displacementMap: textures.displacementMap,
    displacementScale: 0.042,
    displacementBias: -0.021,
    aoMap: textures.aoMap,
    aoMapIntensity: 0.62,
    roughnessMap: textures.roughnessMap,
    roughness: 1.0,
    metalness: 0.02,
    envMapIntensity: 0.16,
  });

  // Extend PBR lunar material so craters ignite with incandescent molten orange-gold plasma
  // right where the Moon makes contact with and physically merges into the Sun
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunCenter = fusionUniforms.uSunCenter;
    shader.uniforms.uSunRadius = fusionUniforms.uSunRadius;
    shader.uniforms.uMerge = fusionUniforms.uMerge;
    shader.uniforms.uTime = fusionUniforms.uTime;

    shader.vertexShader =
      `varying vec3 vMoonWorldPos;\n` +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vMoonWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

    shader.fragmentShader =
      `
      uniform vec3 uSunCenter;
      uniform float uSunRadius;
      uniform float uMerge;
      uniform float uTime;
      varying vec3 vMoonWorldPos;
      ` +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #include <emissivemap_fragment>
        float distToSun = length(vMoonWorldPos - uSunCenter);
        float nearSun = 1.0 - smoothstep(uSunRadius * 0.86, uSunRadius * 1.48, distToSun);
        float deepMerge = 1.0 - smoothstep(uSunRadius * 0.72, uSunRadius * 1.08, distToSun);
        float rockLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float fissure = smoothstep(0.18, 0.78, rockLum);
        float shimmer = 0.88 + 0.12 * sin(vMoonWorldPos.x * 6.0 + vMoonWorldPos.y * 5.0 - uTime * 3.2);

        vec3 moltenEdge = mix(vec3(1.15, 0.28, 0.03), vec3(1.55, 0.85, 0.25), fissure);
        totalEmissiveRadiance += moltenEdge * nearSun * (0.45 + 0.95 * fissure) * shimmer * (0.4 + 0.85 * uMerge);
        totalEmissiveRadiance += vec3(1.35, 0.55, 0.12) * deepMerge * 1.25;
        `,
      );
  };
  disposables.push(material);

  const sphere = new THREE.Mesh(geometry, material);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  sphere.rotation.z = THREE.MathUtils.degToRad(6.68);
  sphere.rotation.y = -Math.PI * 0.42;
  group.add(sphere);

  const rimGeo = new THREE.SphereGeometry(MOON_RADIUS * 1.024, 96, 64);
  const rimMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunPosition: { value: new THREE.Vector3(-4, 0, 0) },
      uMerge: { value: 0 },
    },
    vertexShader: LUNAR_RIM_VERTEX,
    fragmentShader: LUNAR_RIM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const rimShell = new THREE.Mesh(rimGeo, rimMat);
  rimShell.renderOrder = 2;
  group.add(rimShell);
  disposables.push(rimGeo, rimMat);

  return {
    group,
    sphere,
    material,
    applyTextures: (newTextures: LunarTextureSet) => {
      material.map = newTextures.colorMap;
      material.normalMap = newTextures.normalMap;
      material.bumpMap = newTextures.bumpMap;
      material.displacementMap = newTextures.displacementMap;
      material.aoMap = newTextures.aoMap;
      material.roughnessMap = newTextures.roughnessMap;
      material.needsUpdate = true;
    },
    update: (elapsed, delta, sunWorldPos, mergeAmount) => {
      sphere.rotation.y += delta * 0.058;
      fusionUniforms.uSunCenter.value.copy(sunWorldPos);
      fusionUniforms.uMerge.value = mergeAmount;
      fusionUniforms.uTime.value = elapsed;

      rimMat.uniforms.uSunPosition.value.copy(sunWorldPos);
      rimMat.uniforms.uMerge.value = mergeAmount;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
