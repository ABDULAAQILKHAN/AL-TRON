import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';

export type OrbVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected';

export interface AltronOrb3DProps {
  voiceState: OrbVoiceState;
  /** 0..1 live audio level. Meaningful during 'listening' (mic level) and 'speaking' (playback level). */
  amplitude?: number;
  /** Hex color from Hume emotion inference; overrides the state's default color when set, smoothly. */
  emotionColor?: string | null;
  size?: number;
}

// Icosahedron subdivision level. Each +1 roughly quadruples the triangle count -
// detail 4 (~2.5k vertices) is smooth enough for per-vertex noise displacement
// to read as organic, while staying cheap enough for 60fps on mid-range mobile
// GPUs. Bump to 5-6 only after profiling on your actual target devices.
const ICOSAHEDRON_DETAIL = 4;

const STATE_COLOR: Record<OrbVoiceState, string> = {
  idle: '#22D3EE', // cyan
  listening: '#22D3EE',
  thinking: '#8B5CF6', // purple/blue
  speaking: '#22D3EE',
  disconnected: '#EF4444', // red
};

// Ashima Arts classic 3D simplex noise (public-domain-style, ubiquitous in shader work).
const NOISE_GLSL = `
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
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const ORB_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uDisplacement;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplacement;

  ${NOISE_GLSL}

  void main() {
    vNormal = normalize(normalMatrix * normal);

    float noise = snoise(position * 1.6 + uTime * 0.35);
    float breathing = sin(uTime * 0.6) * 0.5 + 0.5;
    float strength = uDisplacement * (0.4 + breathing * 0.3 + uAmplitude * 1.4);
    float displaced = noise * strength;
    vDisplacement = displaced;

    vec3 newPosition = position + normal * displaced;
    vPosition = (modelMatrix * vec4(newPosition, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

const ORB_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uGlow;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplacement;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.5);
    float core = 0.35 + vDisplacement * 0.8;
    vec3 color = uColor * (core + fresnel * uGlow * 1.5);
    float alpha = clamp(fresnel * uGlow + core * 0.6, 0.15, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

interface OrbMeshProps {
  voiceState: OrbVoiceState;
  amplitude: number;
  emotionColor: string | null;
}

function OrbMesh({ voiceState, amplitude, emotionColor }: OrbMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const flickerClockRef = useRef(0);
  const currentColorRef = useRef(new THREE.Color(STATE_COLOR.idle));

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, ICOSAHEDRON_DETAIL), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: 0 },
          uDisplacement: { value: 0.1 },
          uGlow: { value: 0.8 },
          uColor: { value: new THREE.Color(STATE_COLOR.idle) },
        },
        vertexShader: ORB_VERTEX_SHADER,
        fragmentShader: ORB_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Three.js resources are native GPU handles - React unmounting the component
  // doesn't free them on its own, so dispose explicitly.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 1 / 30); // clamp so a stutter/backgrounding spike can't cause a visual jolt
    const t = material.uniforms.uTime.value + dt;
    material.uniforms.uTime.value = t;

    // Frame-rate-independent smoothing factor (~spring-like, no overshoot) -
    // this is what makes every transition ("no abrupt animation") glide.
    const smooth = 1 - Math.pow(0.001, dt);

    const targetColor = emotionColor ?? STATE_COLOR[voiceState];
    currentColorRef.current.lerp(new THREE.Color(targetColor), smooth);
    material.uniforms.uColor.value.copy(currentColorRef.current);

    let targetDisplacement = 0.1;
    let targetGlow = 0.8;
    let targetScale = 1;
    let rotationSpeed = 0.15;

    switch (voiceState) {
      case 'idle':
        targetDisplacement = 0.07;
        targetGlow = 0.7;
        targetScale = 1 + Math.sin(t * 0.6) * 0.035; // slow breathing
        rotationSpeed = 0.15;
        break;
      case 'listening':
        targetDisplacement = 0.12 + amplitude * 0.22;
        targetGlow = 0.9 + amplitude * 0.4;
        targetScale = 1.06 + amplitude * 0.14; // slightly larger, pulses with mic level
        rotationSpeed = 0.45;
        break;
      case 'thinking':
        targetDisplacement = 0.2;
        targetGlow = 1.1;
        targetScale = 1.02 + Math.sin(t * 2.4) * 0.02;
        rotationSpeed = 0.9; // faster internal/orbital motion
        break;
      case 'speaking':
        targetDisplacement = 0.16 + amplitude * 0.5;
        targetGlow = 1.15 + amplitude * 0.9;
        targetScale = 1.05 + amplitude * 0.3; // fully audio reactive
        rotationSpeed = 0.55;
        break;
      case 'disconnected': {
        flickerClockRef.current += dt;
        const flicker = Math.sin(flickerClockRef.current * 3.0) > 0.7 ? 1 : 0;
        targetDisplacement = 0.04;
        targetGlow = 0.35 + flicker * 0.5; // slow flicker
        targetScale = 1;
        rotationSpeed = 0.08;
        break;
      }
    }

    material.uniforms.uDisplacement.value += (targetDisplacement - material.uniforms.uDisplacement.value) * smooth;
    material.uniforms.uGlow.value += (targetGlow - material.uniforms.uGlow.value) * smooth;
    material.uniforms.uAmplitude.value += (amplitude - material.uniforms.uAmplitude.value) * smooth;

    const mesh = meshRef.current;
    if (mesh) {
      mesh.rotation.y += dt * rotationSpeed;
      mesh.rotation.x += dt * rotationSpeed * 0.35;
      const nextScale = mesh.scale.x + (targetScale - mesh.scale.x) * smooth;
      mesh.scale.setScalar(nextScale);

      // Gentle float/tilt so the orb is never perfectly still, even at rest
      // (previously drei's <Float>, replaced to avoid its native barrel
      // pulling in a second, mismatched copy of three.js via stats-gl - see
      // git history / conversation for the "Multiple instances of Three.js"
      // bug that caused).
      mesh.position.y = Math.sin(t * 0.9) * 0.08;
      mesh.rotation.z = Math.sin(t * 0.5) * 0.05;
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

/**
 * A futuristic floating energy orb (icosahedron + custom noise-displacement
 * shader), voice-state and audio-amplitude reactive. Never fully static: a
 * gentle bob/tilt (see OrbMesh's useFrame) layers on top of the shader's own
 * breathing/rotation/displacement animation.
 */
export default function AltronOrb3D({ voiceState, amplitude = 0, emotionColor = null, size = 220 }: AltronOrb3DProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Canvas
        style={{ ...styles.canvas, width: size, height: size }}
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ alpha: true }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[2, 2, 2]} intensity={1.2} />
        <OrbMesh voiceState={voiceState} amplitude={amplitude} emotionColor={emotionColor} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    backgroundColor: 'transparent',
  },
});
