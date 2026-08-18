import * as THREE from "three";

// The look is doing as much work here as the geometry. A displaced photo on
// its own reads as a warped picture; what makes it read as a *projection* is
// the light behaving wrongly on purpose — additive so it glows through itself,
// scanlines rolling across it, a rim that brightens where the surface turns
// away, and a flicker that never quite settles.

export interface HologramUniforms {
  uColor: { value: THREE.Texture | null };
  uDepth: { value: THREE.Texture | null };
  uTime: { value: number };
  uDepthScale: { value: number };
  uPointSize: { value: number };
  /**
   * World-space spacing between points, converted to pixels at one unit of
   * distance. Point size has to follow the grid spacing, the canvas size and
   * the field of view together — a fixed constant renders each point tens of
   * pixels wide and fuses the whole cloud into a solid sheet.
   */
  uPointScale: { value: number };
  uOpacity: { value: number };
  uTint: { value: THREE.Color };
  uColorMix: { value: number };
  uScanDensity: { value: number };
  uAspect: { value: number };
  /**
   * Compensates for how much the projection overlaps itself. Additive
   * blending sums every fragment, so doubling the point count doubles the
   * brightness — without this, raising resolution burns the image to white.
   */
  uAlphaScale: { value: number };
}

export function createHologramUniforms(): HologramUniforms {
  return {
    uColor: { value: null },
    uDepth: { value: null },
    uTime: { value: 0 },
    uDepthScale: { value: 0.55 },
    uPointSize: { value: 1.6 },
    uPointScale: { value: 40 },
    uOpacity: { value: 0.9 },
    uTint: { value: new THREE.Color("#67e8f9") },
    uColorMix: { value: 0.62 },
    uScanDensity: { value: 220 },
    uAspect: { value: 1 },
    uAlphaScale: { value: 1 },
  };
}

// Shared by every mode: read depth, push the vertex along z, and hand the
// fragment stage everything it needs to shade the result.
const COMMON_VERTEX = /* glsl */ `
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform float uTime;
  uniform float uDepthScale;

  varying vec2 vUv;
  varying vec3 vRgb;
  varying float vDepth;
  varying vec3 vNormalish;

  float depthAt(vec2 uv) {
    return texture2D(uDepth, uv).r;
  }

  vec3 displaced(vec2 uv, vec3 base) {
    float d = depthAt(uv);
    vec3 p = base;
    // Centre the relief on z = 0 so rotation pivots through the subject.
    p.z += (d - 0.5) * uDepthScale;
    // A slow vertical ripple: a perfectly rigid projection looks like a model,
    // not a beam of light.
    p.z += sin(uv.y * 26.0 - uTime * 1.6) * 0.006;
    return p;
  }
`;

const POINTS_VERTEX = /* glsl */ `
  uniform float uPointSize;
  uniform float uPointScale;

  void main() {
    vUv = uv;
    vDepth = depthAt(uv);
    vRgb = texture2D(uColor, uv).rgb;
    vNormalish = vec3(0.0, 0.0, 1.0);

    vec3 p = displaced(uv, position);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // Sized to just overlap its neighbours at any resolution or distance;
    // nearer points read slightly larger, which is most of the volume cue.
    gl_PointSize = uPointSize * (uPointScale / max(-mv.z, 0.1)) * (0.8 + vDepth * 0.4);
    gl_Position = projectionMatrix * mv;
  }
`;

const SURFACE_VERTEX = /* glsl */ `
  uniform float uAspect;

  void main() {
    vUv = uv;
    vDepth = depthAt(uv);
    vRgb = texture2D(uColor, uv).rgb;

    // Normals from the depth field by finite difference — there is no real
    // geometry normal to use, and this is what lets the rim light pick out
    // the silhouette of whatever is in the picture.
    float texel = 1.0 / 256.0;
    float dx = depthAt(uv + vec2(texel, 0.0)) - depthAt(uv - vec2(texel, 0.0));
    float dy = depthAt(uv + vec2(0.0, texel)) - depthAt(uv - vec2(0.0, texel));
    vNormalish = normalize(vec3(-dx * uDepthScale * 40.0, -dy * uDepthScale * 40.0, 1.0));

    vec3 p = displaced(uv, position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uAlphaScale;
  uniform vec3 uTint;
  uniform float uColorMix;
  uniform float uScanDensity;

  varying vec2 vUv;
  varying vec3 vRgb;
  varying float vDepth;
  varying vec3 vNormalish;

  void main() {
    #ifdef IS_POINTS
      // Round off the point sprite and soften its edge.
      vec2 offset = gl_PointCoord - 0.5;
      float radius = length(offset);
      if (radius > 0.5) discard;
      float sprite = smoothstep(0.5, 0.0, radius);
    #else
      float sprite = 1.0;
    #endif

    // How much light this part of the picture had. Everything downstream
    // hangs off it: a hologram is light, so the dark parts of a photograph
    // aren't dim — they simply aren't there.
    float lum = dot(vRgb, vec3(0.2126, 0.7152, 0.0722));

    // Keep some of the photograph, push the rest towards the projector's own
    // colour — entirely cyan loses the subject, entirely photographic loses
    // the hologram. The tint is scaled by luminance so black stays black.
    vec3 tinted = mix(uTint * lum, vRgb, uColorMix);

    // Scanlines rolling upward, plus mains-hum flicker.
    float scan = 0.78 + 0.22 * sin(vUv.y * uScanDensity - uTime * 7.0);
    float flicker = 0.94 + 0.06 * sin(uTime * 47.0) * sin(uTime * 13.0);

    // Rim: bright where the surface turns away from the viewer.
    float facing = clamp(vNormalish.z, 0.0, 1.0);
    float rim = pow(1.0 - facing, 2.0);

    // Nearer material is brighter; far material falls back into the beam.
    float depthLift = 0.38 + vDepth * 0.5;

    vec3 rgb = tinted * depthLift + uTint * rim * 0.45;
    // Dark picture, no projection: this is what makes the subject float free
    // of its background rather than sitting on a glowing rectangle.
    float presence = smoothstep(0.05, 0.42, lum);
    float alpha = uOpacity * uAlphaScale * sprite * scan * flicker * presence
                * (0.45 + vDepth * 0.55);

    // Horizontal interference band sweeping the projection.
    float band = smoothstep(0.02, 0.0, abs(fract(vUv.y - uTime * 0.11) - 0.5) - 0.005);
    rgb += uTint * band * 0.35 * presence;
    alpha += band * 0.08 * uAlphaScale * presence;

    // Soft roll-off instead of a hard clip, so bright areas keep their shape
    // rather than flattening into a white silhouette.
    rgb = rgb / (1.0 + rgb * 0.85);

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(rgb, alpha);
  }
`;

function baseMaterial(uniforms: HologramUniforms, vertex: string, points: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: COMMON_VERTEX + vertex,
    fragmentShader: FRAGMENT,
    defines: points ? { IS_POINTS: "" } : {},
    transparent: true,
    // Additive is what makes overlapping layers glow rather than occlude, and
    // depth writes are off so the projection never hides its own far side.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

export function createPointsMaterial(uniforms: HologramUniforms) {
  return baseMaterial(uniforms, POINTS_VERTEX, true);
}

export function createSurfaceMaterial(uniforms: HologramUniforms) {
  return baseMaterial(uniforms, SURFACE_VERTEX, false);
}

export function createWireMaterial(uniforms: HologramUniforms) {
  const material = baseMaterial(uniforms, SURFACE_VERTEX, false);
  material.wireframe = true;
  return material;
}
