"use client";

// react-three-fiber's documented performance pattern is to mutate objects
// (materials, refs) directly inside useFrame every animation frame rather
// than going through React state — see https://r3f.docs.pmnd.rs/api/hooks#useframe.
// That's intentionally at odds with the newer react-hooks/immutability rule,
// which doesn't model useFrame's imperative escape hatch.
/* eslint-disable react-hooks/immutability */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  circuitTraces,
  motes,
  radialSpokes,
  shardPlates,
  shellRings,
} from "@/lib/orbGeometry";
import type { OrbState } from "@/lib/types";

// The core.
//
// A sphere made of light rather than surface: a hot ring at the middle, spokes
// thrown out from it, a cage of fine filaments and circuit traces around the
// outside, and a haze of motes hanging in between — some of them deliberately
// out of focus, which is what stops a flat screen looking flat.
//
// It is all lines and points, drawn additively. Nothing here is a solid object,
// which is the whole trick: overlapping light adds up, so where filaments cross
// they burn brighter without anything being modelled to make them.
//
// Drag it and it turns, and keeps turning when you let go.

interface OrbSceneProps {
  state: OrbState;
  audioLevel: number;
}

const STATE_COLOR: Record<OrbState, string> = {
  // Amber throughout, shifted by state: hotter when he is listening to you,
  // deeper while he thinks, brightest while he speaks.
  idle: "#ff7a00",
  listening: "#ffc400",
  thinking: "#c2410c",
  speaking: "#ff9d00",
};

/**
 * A soft round blob, drawn once into a canvas and used for every mote.
 *
 * Points are square by default, and a field of squares reads as pixels rather
 * than light. The falloff is deliberately gentle at the edge — that soft rim is
 * what makes the big ones look out of focus rather than merely large.
 */
function moteTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,235,190,0.7)");
    gradient.addColorStop(0.55, "rgba(255,160,40,0.18)");
    gradient.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Positions and colours straight into a geometry, with no copying. */
function lineGeometry(data: { positions: Float32Array; colors: Float32Array }): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
  return geometry;
}

function Core({ state, audioLevel }: OrbSceneProps) {
  // The canvas is square and sized by CSS, so this is how many pixels tall it
  // currently is — the point shader needs it to size motes consistently.
  const { size } = useThree();
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Group>(null);
  const middle = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const debris = useRef<THREE.Group>(null);
  const heart = useRef<THREE.Mesh>(null);

  // Built once. Regenerating this on a re-render would re-tangle the whole
  // sphere in front of you, and cost a frame doing it.
  const parts = useMemo(
    () => ({
      // Tuned by eye against the reference: enough spokes to read as thrown
      // light, but not so many that it becomes a dandelion. The detail that
      // sells it is in the shell — the rings and the traces — so there is far
      // more of that than of anything else.
      spokes: lineGeometry(radialSpokes(105, { steps: 8, seed: 11 })),
      // Three cages at three depths rather than one. You see through the outer
      // one into the next, which is the difference between a sphere with
      // detail on it and a sphere with things inside it.
      outerRings: lineGeometry(shellRings(26, { segments: 120, seed: 22 })),
      midRings: lineGeometry(shellRings(18, { radius: 0.72, segments: 100, seed: 66 })),
      innerRings: lineGeometry(shellRings(12, { radius: 0.44, segments: 84, seed: 77 })),
      outerTraces: lineGeometry(circuitTraces(150, { steps: 12, seed: 33 })),
      midTraces: lineGeometry(circuitTraces(80, { radius: 0.72, steps: 10, seed: 44 })),
      innerTraces: lineGeometry(circuitTraces(50, { radius: 0.44, steps: 8, seed: 88 })),
      // The debris outside the shell — the thing that makes it read as an
      // object floating in a space rather than a disc on a screen.
      shards: lineGeometry(shardPlates(80, { seed: 99 })),
      dust: motes(1100, { seed: 55 }),
    }),
    []
  );

  const sprite = useMemo(() => moteTexture(), []);

  const moteGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(parts.dust.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(parts.dust.colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(parts.dust.sizes, 1));
    return geometry;
  }, [parts.dust]);

  /**
   * Points, sized individually.
   *
   * three's PointsMaterial gives every point the same size, and the whole depth
   * effect here depends on them differing — so this is the smallest shader that
   * reads a per-point size attribute and keeps the perspective falloff.
   */
  const moteMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSprite: { value: sprite },
          uScale: { value: 1 },
          uOpacity: { value: 1 },
          // Points are sized in pixels, so the same number means something
          // different on a phone and a monitor. This carries the canvas height
          // in, and the constant is tuned so a "size" of 3 is about three
          // pixels at the default camera distance.
          uPixels: { value: 1 },
        },
        vertexShader: `
          attribute float size;
          varying vec3 vColor;
          uniform float uScale;
          uniform float uPixels;
          void main() {
            vColor = color;
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * uScale * uPixels * (2.5 / -view.z);
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: `
          uniform sampler2D uSprite;
          uniform float uOpacity;
          varying vec3 vColor;
          void main() {
            vec4 blob = texture2D(uSprite, gl_PointCoord);
            if (blob.a < 0.01) discard;
            // Additive, so alpha is brightness rather than coverage: squaring
            // it keeps the soft edges from stacking into a white disc where
            // hundreds of motes overlap.
            gl_FragColor = vec4(vColor * blob.rgb * blob.a * uOpacity, 1.0);
          }
        `,
        transparent: true,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [sprite]
  );

  const lineMaterials = useMemo(
    () => ({
      spokes: new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      filaments: new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      shards: new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    []
  );

  useEffect(
    () => () => {
      for (const geometry of Object.values(parts)) {
        if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
      }
      moteGeometry.dispose();
      moteMaterial.dispose();
      sprite.dispose();
      lineMaterials.spokes.dispose();
      lineMaterials.filaments.dispose();
      lineMaterials.shards.dispose();
    },
    [parts, moteGeometry, moteMaterial, sprite, lineMaterials]
  );

  const tint = useMemo(() => new THREE.Color(STATE_COLOR.idle), []);
  const wanted = useMemo(() => new THREE.Color(), []);
  const brightness = useRef(0.85);
  const swell = useRef(1);

  useFrame((_, rawDelta) => {
    // A tab left in the background hands back an enormous delta on return,
    // which would fling the core across the screen.
    const delta = Math.min(rawDelta, 0.05);
    const t = performance.now() / 1000;

    let targetBrightness = 0.8;
    let targetSwell = 1;
    let spinRate = 0.05;

    switch (state) {
      case "listening":
        targetBrightness = 1.15 + Math.sin(t * 3.2) * 0.08;
        targetSwell = 1.03;
        spinRate = 0.09;
        break;
      case "thinking":
        targetBrightness = 1.0 + Math.sin(t * 6) * 0.16;
        targetSwell = 1.01;
        spinRate = 0.22;
        break;
      case "speaking":
        targetBrightness = 0.9 + audioLevel * 1.5;
        targetSwell = 1 + audioLevel * 0.09;
        spinRate = 0.11;
        break;
      default:
        targetBrightness = 0.78 + Math.sin(t * 0.6) * 0.06;
        targetSwell = 1;
        spinRate = 0.05;
    }

    brightness.current = THREE.MathUtils.damp(brightness.current, targetBrightness, 5, delta);
    swell.current = THREE.MathUtils.damp(swell.current, targetSwell, 6, delta);

    wanted.set(STATE_COLOR[state]);
    tint.lerp(wanted, 0.04);

    moteMaterial.uniforms.uOpacity.value = brightness.current;
    moteMaterial.uniforms.uPixels.value = size.height / 380;
    moteMaterial.uniforms.uScale.value = swell.current;
    lineMaterials.spokes.opacity = 0.32 + brightness.current * 0.3;
    lineMaterials.filaments.opacity = 0.16 + brightness.current * 0.2;
    lineMaterials.spokes.color.copy(tint).multiplyScalar(1.15);
    lineMaterials.filaments.color.copy(tint).multiplyScalar(0.95);
    lineMaterials.shards.opacity = 0.2 + brightness.current * 0.28;
    lineMaterials.shards.color.copy(tint).multiplyScalar(1.05);

    if (group.current) group.current.scale.setScalar(swell.current);

    // Five layers, each on its own axis and its own direction, and two of them
    // reversing on a slow cycle of their own. That is what makes it read as
    // machinery rather than as one thing on a turntable: at any moment
    // something is going one way, something else the other, and the two of
    // them cross.
    const sway = Math.sin(t * 0.11);
    const counterSway = Math.sin(t * 0.07 + 1.4);

    if (spin.current) {
      spin.current.rotation.y += delta * spinRate;
      spin.current.rotation.z += delta * spinRate * 0.12 * sway;
    }
    if (shell.current) {
      // Against the core, and tipping the other way as the cycle turns over.
      shell.current.rotation.y -= delta * spinRate * 0.62;
      shell.current.rotation.x += delta * spinRate * 0.34 * sway;
    }
    if (middle.current) {
      // Crosswise: this one turns about a different axis entirely.
      middle.current.rotation.z += delta * spinRate * 0.8 * counterSway;
      middle.current.rotation.x -= delta * spinRate * 0.5;
    }
    if (inner.current) {
      inner.current.rotation.y += delta * spinRate * 1.5;
      inner.current.rotation.z -= delta * spinRate * 0.7 * sway;
    }
    if (debris.current) {
      // Slowest of all, and against everything: distance reads as slowness.
      debris.current.rotation.y -= delta * spinRate * 0.28;
      debris.current.rotation.x += delta * spinRate * 0.16 * counterSway;
    }
    if (heart.current) {
      heart.current.rotation.z += delta * 0.6;
      const pulse = 1 + Math.sin(t * 2.4) * 0.06 + audioLevel * 0.35;
      heart.current.scale.setScalar(pulse);
      (heart.current.material as THREE.MeshBasicMaterial).color
        .copy(tint)
        .lerp(new THREE.Color("#fff3d0"), 0.55)
        .multiplyScalar(brightness.current);
    }
  });

  return (
    <group ref={group}>
      <group ref={spin}>
        <lineSegments geometry={parts.spokes} material={lineMaterials.spokes} />
        <points geometry={moteGeometry} material={moteMaterial} />
      </group>

      <group ref={inner}>
        <lineSegments geometry={parts.innerRings} material={lineMaterials.filaments} />
        <lineSegments geometry={parts.innerTraces} material={lineMaterials.filaments} />
      </group>

      <group ref={middle}>
        <lineSegments geometry={parts.midRings} material={lineMaterials.filaments} />
        <lineSegments geometry={parts.midTraces} material={lineMaterials.filaments} />
      </group>

      <group ref={shell}>
        <lineSegments geometry={parts.outerRings} material={lineMaterials.filaments} />
        <lineSegments geometry={parts.outerTraces} material={lineMaterials.filaments} />
      </group>

      <group ref={debris}>
        <lineSegments geometry={parts.shards} material={lineMaterials.shards} />
      </group>

      {/* The eye at the centre: a bright ring seen edge-on, with a hot bead
          inside it. In the reference this is the one thing that is unmistakably
          a made object rather than a cloud. */}
      <mesh ref={heart}>
        <torusGeometry args={[0.13, 0.018, 12, 64]} />
        <meshBasicMaterial
          color="#fff0cc"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh scale={0.045}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial
          color="#fffaf0"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* The haze the core sits in. Two shells, back-faced, so the light
          appears to come from inside rather than being painted on. */}
      <mesh scale={0.45}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color="#ff9d00"
          transparent
          opacity={0.07}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* The outer haze, as a sprite rather than a sphere.
          A back-faced sphere at a flat opacity has a hard silhouette — it drew
          a faint circle in the air around the core, which is exactly the kind
          of edge this whole thing is trying not to have. A sprite is a soft
          gradient with nothing to see the edge of, and it always faces you. */}
      <sprite scale={[3.4, 3.4, 1]}>
        <spriteMaterial
          map={sprite}
          color="#ff8c1a"
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

/**
 * Turning it by hand.
 *
 * Not OrbitControls: that moves the camera, which drags the haze and the
 * background glow around with it. This turns the object, leaves the lighting
 * where it is, and keeps a little of the speed when you let go — so a flick
 * spins it and it slows to a stop rather than freezing mid-turn.
 */
function Draggable({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();

  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const held = useRef(false);

  useEffect(() => {
    const element = gl.domElement;

    const down = (event: PointerEvent) => {
      dragging.current = true;
      held.current = true;
      last.current = { x: event.clientX, y: event.clientY };
      velocity.current = { x: 0, y: 0 };
      element.setPointerCapture(event.pointerId);
      element.style.cursor = "grabbing";
    };

    const move = (event: PointerEvent) => {
      if (!dragging.current || !group.current) return;
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };

      // Radians per pixel, chosen so a drag across the orb turns it about once.
      const rate = 0.008;
      group.current.rotation.y += dx * rate;
      group.current.rotation.x += dy * rate;
      velocity.current = { x: dx * rate, y: dy * rate };
    };

    const up = (event: PointerEvent) => {
      dragging.current = false;
      held.current = false;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      element.style.cursor = "grab";
    };

    element.style.cursor = "grab";
    // Without this a drag on a phone scrolls the page instead of turning it.
    element.style.touchAction = "none";

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("pointerleave", up);

    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("pointerleave", up);
    };
  }, [gl]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    if (!group.current || held.current) return;

    // Coasting: what was left of the flick, bled away over about a second.
    group.current.rotation.y += velocity.current.x;
    group.current.rotation.x += velocity.current.y;
    const decay = Math.pow(0.94, delta * 60);
    velocity.current.x *= decay;
    velocity.current.y *= decay;

    // Tipped-over is a strange place to leave it, so the tilt drifts back to
    // level while the spin around the axis is left exactly where you put it.
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, 0, 0.6, delta);
  });

  return <group ref={group}>{children}</group>;
}

export default function Orb({ state, audioLevel }: OrbSceneProps) {
  // Kept out of the render path: the canvas should never re-mount because a
  // parent re-rendered, or the whole sphere is rebuilt mid-conversation.
  const scene = useCallback(
    () => <Core state={state} audioLevel={audioLevel} />,
    [state, audioLevel]
  );

  return (
    <Canvas
      // Further back than the sphere needs, deliberately. The canvas is square
      // and everything in it is glowing, so anything still lit where the canvas
      // stops draws a hard edge across the light. Pulling the camera back and
      // growing the element instead leaves a margin of darkness all the way
      // round — the orb ends up bigger on screen and the edge is nowhere near
      // anything bright.
      camera={{ position: [0, 0, 5.2], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      // Capped at 2: the mote shader is fill-heavy, and a phone at 3x spends
      // the whole frame budget drawing blur nobody can see.
      dpr={[1, 2]}
    >
      <Draggable>{scene()}</Draggable>
    </Canvas>
  );
}
