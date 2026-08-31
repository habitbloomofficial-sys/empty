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

export interface WeakPoint {
  axis: "x" | "y" | "z";
  /** Millimetres from the low end of that axis. */
  atMm: number;
  safetyFactor: number;
  holds: boolean;
}

const WARN = new THREE.Color("#fb7185");

/**
 * The band across the part where the stress test found it weakest.
 *
 * Drawn in the part's own millimetres, inside the same group that centres and
 * scales the geometry — so it lands on the real section instead of on a
 * proportion of the bounding box, and there is no axis mapping to get wrong.
 */
function WeakBand({ weakPoint, model }: { weakPoint: WeakPoint; model: ParsedModel }) {
  const index = weakPoint.axis === "x" ? 0 : weakPoint.axis === "y" ? 1 : 2;
  const size: [number, number, number] = [
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2],
  ];

  // The stress test measures from the low end of the axis, which is where it
  // treats the part as held.
  const position: [number, number, number] = [
    (model.min[0] + model.max[0]) / 2,
    (model.min[1] + model.max[1]) / 2,
    (model.min[2] + model.max[2]) / 2,
  ];
  position[index] = model.min[index] + weakPoint.atMm;

  // A plane's face points along +Z, so it is turned to face down the cut axis.
  // Its own two dimensions then land on two of the world axes, and it is sized
  // from those — a square the size of the whole bounding box reads as a wall
  // standing behind the model rather than a cut through it.
  const margin = 1.08;
  const [rotation, plane]: [[number, number, number], [number, number]] =
    weakPoint.axis === "x"
      ? [[0, Math.PI / 2, 0], [size[2] * margin, size[1] * margin]]
      : weakPoint.axis === "y"
        ? [[Math.PI / 2, 0, 0], [size[0] * margin, size[2] * margin]]
        : [[0, 0, 0], [size[0] * margin, size[1] * margin]];

  const colour = weakPoint.holds ? CYAN : WARN;
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <planeGeometry args={plane} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={weakPoint.holds ? 0.05 : 0.1}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(plane[0], plane[1])]} />
        <lineBasicMaterial
          color={colour}
          transparent
          opacity={weakPoint.holds ? 0.55 : 1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

function Part({
  model,
  spin,
  weakPoint,
}: {
  model: ParsedModel;
  spin: boolean;
  weakPoint?: WeakPoint;
}) {
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
      // The part's Z, because that is up in the model and about to be up here.
      height: (model.max[2] - model.min[2]) * fit.scale,
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
      {/* Stood up. Z is up everywhere in the modelling and the stress test —
          it is the orientation the part is used in and printed in — but three
          puts Y up, so without this turn every part is projected lying on its
          back and a wall bracket looks like a floor tile. */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {/* Centred on the origin and scaled to fit the stage. */}
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

          {/* Where it would give. Cyan if there is margin in hand, red if not. */}
          {weakPoint && <WeakBand weakPoint={weakPoint} model={model} />}
        </group>
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
  weakPoint,
}: {
  model: ParsedModel;
  spin?: boolean;
  yaw?: number;
  pitch?: number;
  weakPoint?: WeakPoint;
}) {
  return (
    <Canvas camera={{ position: [0, 1.4, 6.2], fov: 42 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 6, 4]} intensity={40} color="#a5f3fc" />
      <pointLight position={[-5, -2, -3]} intensity={18} color="#0891b2" />
      <group rotation={[pitch, yaw, 0]}>
        <Part model={model} spin={spin} weakPoint={weakPoint} />
      </group>
    </Canvas>
  );
}
