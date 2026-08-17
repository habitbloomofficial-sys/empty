"use client";

// react-three-fiber's documented performance pattern is to mutate objects
// (materials, refs) directly inside useFrame every animation frame rather
// than going through React state — see https://r3f.docs.pmnd.rs/api/hooks#useframe.
// That's intentionally at odds with the newer react-hooks/immutability rule,
// which doesn't model useFrame's imperative escape hatch.
/* eslint-disable react-hooks/immutability */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { OrbMaterial } from "./orbMaterial";
import type { OrbState } from "@/lib/types";

interface OrbSceneProps {
  state: OrbState;
  audioLevel: number;
}

const STATE_COLOR: Record<OrbState, string> = {
  idle: "#38bdf8",
  listening: "#22d3ee",
  thinking: "#818cf8",
  speaking: "#7dd3fc",
};

function OrbMesh({ state, audioLevel }: OrbSceneProps) {
  const material = useMemo(() => new OrbMaterial(), []);
  const groupRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const glowInnerRef = useRef<THREE.Mesh>(null);
  const glowOuterRef = useRef<THREE.Mesh>(null);
  const targetColor = useMemo(() => new THREE.Color(), []);
  const currentIntensity = useRef(0.15);
  const currentScale = useRef(1);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    const t = performance.now() / 1000;

    let target = 0.14;
    let timeSpeed = 1;
    let scaleTarget = 1;

    switch (state) {
      case "listening":
        target = 0.24 + Math.sin(t * 3.2) * 0.05;
        timeSpeed = 1.3;
        scaleTarget = 1.04;
        break;
      case "thinking":
        target = 0.34 + Math.sin(t * 5.5) * 0.08;
        timeSpeed = 2.1;
        scaleTarget = 1.02;
        break;
      case "speaking":
        target = 0.18 + audioLevel * 0.75;
        timeSpeed = 1.6;
        scaleTarget = 1 + audioLevel * 0.12;
        break;
      default:
        target = 0.13 + Math.sin(t * 0.6) * 0.03;
        timeSpeed = 0.7;
        scaleTarget = 1;
    }

    currentIntensity.current = THREE.MathUtils.damp(
      currentIntensity.current,
      target,
      6,
      delta
    );
    currentScale.current = THREE.MathUtils.damp(
      currentScale.current,
      scaleTarget,
      6,
      delta
    );

    material.uTime += delta * timeSpeed;
    material.uIntensity = currentIntensity.current;
    targetColor.set(STATE_COLOR[state]);
    material.uColorEdge.lerp(targetColor, 0.05);

    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.12;
      groupRef.current.rotation.x = Math.sin(t * 0.25) * 0.08;
      groupRef.current.scale.setScalar(currentScale.current);
    }

    if (shellRef.current) {
      shellRef.current.rotation.y -= delta * 0.05;
      shellRef.current.rotation.z += delta * 0.03;
    }

    const glowAmount = THREE.MathUtils.clamp(currentIntensity.current * 1.4, 0.08, 0.9);
    if (glowInnerRef.current) {
      const mat = glowInnerRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + glowAmount * 0.35;
      mat.color.set(STATE_COLOR[state]);
    }
    if (glowOuterRef.current) {
      const mat = glowOuterRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.12 + glowAmount * 0.22;
      mat.color.set(STATE_COLOR[state]);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh material={material}>
        <sphereGeometry args={[1, 128, 128]} />
      </mesh>
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[1.55, 1]} />
        <meshBasicMaterial
          color="#7dd3fc"
          wireframe
          transparent
          opacity={0.12}
        />
      </mesh>
      <mesh ref={glowInnerRef} scale={1.22}>
        <sphereGeometry args={[1, 48, 48]} />
        <meshBasicMaterial
          color="#7dd3fc"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      <mesh ref={glowOuterRef} scale={1.6}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color="#7dd3fc"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

export default function Orb({ state, audioLevel }: OrbSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4.4], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 3, 3]} intensity={40} color="#bae6fd" />
      <OrbMesh state={state} audioLevel={audioLevel} />
      <Sparkles
        count={60}
        scale={[6, 6, 6]}
        size={2}
        speed={0.25}
        opacity={0.35}
        color="#7dd3fc"
      />
    </Canvas>
  );
}
