"use client";

// A part, projected.
//
// Same imperative useFrame pattern as the orb: the scan line and the glow are
// mutated on the objects each frame rather than routed through React state.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { framing, type ParsedModel } from "@/lib/stl";

// The look is the point of this one. A solid grey part in a viewport is a CAD
// program; what makes it a hologram is that you can see through it, that the
// edges glow, and that something is always moving over it. So: a faint filled
// body, bright wireframe over the top, a horizontal scan line sweeping up it,
// and the whole thing sitting on a projector disc.

const CYAN = new THREE.Color("#5eead4");
const DEEP = new THREE.Color("#0891b2");

function Part({ model, spin }: { model: ParsedModel; spin: boolean }) {
  const group = useRef<THREE.Group>(null);
  const scanRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const turn = useRef(0);

  const { geometry, height, scale, centre } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(model.positions, 3));
    geo.computeVertexNormals();

    const fit = framing(model, 3.2);
    return {
      geometry: geo,
      height: (model.max[1] - model.min[1]) * fit.scale,
      scale: fit.scale,
      centre: fit.centre,
    };
  }, [model]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (spin) turn.current += delta * 0.35;
    if (group.current) group.current.rotation.y = turn.current;

    // The scan line: rises through the part, wraps, and brightens the body as
    // it passes. It is the single thing that stops this looking like a render.
    if (scanRef.current) {
      const t = (performance.now() / 2600) % 1;
      scanRef.current.position.y = -height / 2 + t * height;
      // Fade in and out at the ends rather than popping. The frame carries the
      // sweep; the fill is barely there, so it never reads as a solid sheet.
      const fade = Math.sin(t * Math.PI);
      for (const child of scanRef.current.children) {
        const material = (child as THREE.Mesh | THREE.LineSegments).material as THREE.Material & {
          opacity: number;
        };
        material.opacity = (child.userData.peak as number) * fade;
      }
    }
    if (bodyRef.current) {
      const material = bodyRef.current.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.35 + 0.1 * Math.sin(performance.now() / 900);
    }
  });

  return (
    <group ref={group}>
      {/* Everything is centred on the origin and scaled to fit the stage. */}
      <group scale={scale} position={[-centre[0] * scale, -centre[1] * scale, -centre[2] * scale]}>
        <mesh ref={bodyRef} geometry={geometry}>
          <meshStandardMaterial
            color={DEEP}
            emissive={CYAN}
            emissiveIntensity={0.35}
            transparent
            opacity={0.22}
            roughness={0.4}
            metalness={0.1}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* The edges, which is what makes it read as a drawing rather than a lump. */}
        <lineSegments>
          <wireframeGeometry args={[geometry]} />
          <lineBasicMaterial
            color={CYAN}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      </group>

      {/* The sweep: a bright square frame with almost nothing inside it. A
          filled slab reads as a pane of glass sitting through the part, which
          is exactly the wrong thing to notice — the edge is what says scanning. */}
      <group ref={scanRef} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh userData={{ peak: 0.07 }}>
          <planeGeometry args={[2.9, 2.9]} />
          <meshBasicMaterial
            color={CYAN}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <lineSegments userData={{ peak: 0.75 }}>
          <edgesGeometry args={[new THREE.PlaneGeometry(2.9, 2.9)]} />
          <lineBasicMaterial
            color={CYAN}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      </group>

      {/* The projector plate it stands on. */}
      <group position={[0, -height / 2 - 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {[2.1, 2.45, 2.8].map((radius, i) => (
          <lineSegments key={radius}>
            <edgesGeometry args={[new THREE.CircleGeometry(radius, 64)]} />
            <lineBasicMaterial
              color={CYAN}
              transparent
              opacity={0.3 - i * 0.07}
              blending={THREE.AdditiveBlending}
            />
          </lineSegments>
        ))}
      </group>
    </group>
  );
}

export default function ModelHologram({
  model,
  spin = true,
  yaw = 0,
  pitch = 0,
}: {
  model: ParsedModel;
  spin?: boolean;
  yaw?: number;
  pitch?: number;
}) {
  return (
    <Canvas camera={{ position: [0, 1.4, 6.2], fov: 42 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 6, 4]} intensity={40} color="#a5f3fc" />
      <pointLight position={[-5, -2, -3]} intensity={18} color="#0891b2" />
      <group rotation={[pitch, yaw, 0]}>
        <Part model={model} spin={spin} />
      </group>
    </Canvas>
  );
}
