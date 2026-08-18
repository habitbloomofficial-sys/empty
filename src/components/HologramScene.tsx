"use client";

// Same imperative useFrame pattern as the orb — mutate materials directly each
// frame rather than routing animation through React state.
/* eslint-disable react-hooks/immutability */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  createHologramUniforms,
  createPointsMaterial,
  createSurfaceMaterial,
  createWireMaterial,
} from "./hologramMaterials";
import type { HologramSource } from "@/lib/depthMap";

export type HologramMode = "points" | "surface" | "wire";

export interface HologramSettings {
  mode: HologramMode;
  depthScale: number;
  density: number;
  opacity: number;
  colorMix: number;
  autoRotate: boolean;
}

interface ProjectionProps {
  source: HologramSource;
  settings: HologramSettings;
  /** Yaw the viewer has dragged to, in radians. */
  yaw: number;
  pitch: number;
}

function Projection({ source, settings, yaw, pitch }: ProjectionProps) {
  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef(0);
  const { size, camera } = useThree();

  const uniforms = useMemo(() => createHologramUniforms(), []);

  const materials = useMemo(
    () => ({
      points: createPointsMaterial(uniforms),
      surface: createSurfaceMaterial(uniforms),
      wire: createWireMaterial(uniforms),
    }),
    [uniforms]
  );

  // Both textures come from the picture, so they're rebuilt only when it does.
  const textures = useMemo(() => {
    const color = new THREE.CanvasTexture(source.color);
    color.colorSpace = THREE.SRGBColorSpace;
    color.minFilter = THREE.LinearFilter;
    color.magFilter = THREE.LinearFilter;

    const { width, height, data } = source.depth;
    const bytes = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) bytes[i] = Math.round(data[i] * 255);

    const depth = new THREE.DataTexture(bytes, width, height, THREE.RedFormat);
    depth.minFilter = THREE.LinearFilter;
    depth.magFilter = THREE.LinearFilter;
    depth.wrapS = THREE.ClampToEdgeWrapping;
    depth.wrapT = THREE.ClampToEdgeWrapping;
    depth.needsUpdate = true;

    return { color, depth };
  }, [source]);

  // Aspect-correct plane: a portrait photo shouldn't be stretched square.
  const { width: planeWidth, height: planeHeight } = useMemo(() => {
    const aspect = source.depth.width / source.depth.height;
    return aspect >= 1
      ? { width: 2.9, height: 2.9 / aspect }
      : { width: 2.9 * aspect, height: 2.9 };
  }, [source]);

  const segments = Math.max(24, Math.min(400, Math.round(settings.density)));

  useEffect(() => {
    uniforms.uColor.value = textures.color;
    uniforms.uDepth.value = textures.depth;
  }, [uniforms, textures]);

  useEffect(
    () => () => {
      textures.color.dispose();
      textures.depth.dispose();
    },
    [textures]
  );

  useEffect(
    () => () => {
      materials.points.dispose();
      materials.surface.dispose();
      materials.wire.dispose();
    },
    [materials]
  );

  useFrame((_, delta) => {
    uniforms.uTime.value += delta;
    uniforms.uDepthScale.value = settings.depthScale;
    uniforms.uOpacity.value = settings.opacity;
    uniforms.uColorMix.value = settings.colorMix;
    uniforms.uPointSize.value = 1.5;
    // Pixels per world unit at one unit of depth, from the live canvas height
    // and field of view, times the spacing between neighbouring points.
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const pixelsPerUnit = size.height / (2 * Math.tan((fov * Math.PI) / 360));
    uniforms.uPointScale.value = (planeHeight / segments) * pixelsPerUnit;
    // Points overlap their neighbours and stack additively; a surface lays
    // down one fragment per pixel and comes out far dimmer for the same
    // opacity. Each mode gets the exposure it needs to read the same.
    uniforms.uAlphaScale.value =
      settings.mode === "points"
        ? THREE.MathUtils.clamp(Math.pow(150 / segments, 0.4), 0.55, 1.4)
        : 2.1;

    if (settings.autoRotate) spinRef.current += delta * 0.35;

    if (groupRef.current) {
      groupRef.current.rotation.y = spinRef.current + yaw;
      groupRef.current.rotation.x = pitch;
      groupRef.current.position.y = Math.sin(uniforms.uTime.value * 0.8) * 0.03;
    }
  });

  const geometryArgs: [number, number, number, number] = [
    planeWidth,
    planeHeight,
    segments,
    segments,
  ];

  return (
    <group ref={groupRef}>
      {settings.mode === "points" ? (
        <points material={materials.points}>
          <planeGeometry args={geometryArgs} />
        </points>
      ) : (
        <mesh material={settings.mode === "wire" ? materials.wire : materials.surface}>
          <planeGeometry args={geometryArgs} />
        </mesh>
      )}
    </group>
  );
}

/** The projector plinth and its beam — the frame around the illusion. */
function Projector({ radius }: { radius: number }) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.6;
  });

  return (
    <group position={[0, -1.75, 0]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.62, radius * 0.72, 64]} />
        <meshBasicMaterial
          color="#22d3ee"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.6, 64]} />
        <meshBasicMaterial
          color="#0ea5e9"
          transparent
          opacity={0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* The beam: wide at the top, narrow at the emitter. */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[radius * 1.1, radius * 0.26, 3.2, 48, 1, true]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** Shown before a picture is loaded, so the stage is never simply empty. */
function IdleField() {
  const ref = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const count = 600;
    const positions = new Float32Array(count * 3);
    // Deterministic scatter: the same dust every time the panel opens, and no
    // impure call during render.
    const scatter = (n: number) => {
      const x = Math.sin(n * 127.1) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = scatter(i + 1) * 6;
      positions[i * 3 + 1] = scatter(i + 101) * 4;
      positions[i * 3 + 2] = scatter(i + 211) * 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.08;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        color="#67e8f9"
        size={0.035}
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export default function HologramScene({
  source,
  settings,
  yaw,
  pitch,
}: {
  source: HologramSource | null;
  settings: HologramSettings;
  yaw: number;
  pitch: number;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.1, 5.6], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.4} />
      {source ? (
        <Projection source={source} settings={settings} yaw={yaw} pitch={pitch} />
      ) : (
        <IdleField />
      )}
      <Projector radius={1.25} />
    </Canvas>
  );
}
