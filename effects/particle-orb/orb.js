/**
 * Motion+ Hero Particle Orb (WebGL 1 Faithful Replica)
 *
 * Architecture:
 * - 17,800 particles total:
 *     12,000 outer Fibonacci sphere particles
 *      5,800 inner volumetric 3D "+" core particles
 * - 4 WebGL gl.POINTS passes with premultiplied alpha blending:
 *     1) Outer Shell Halo (24% subset, 1.3x scale, depth blur, warm cream tint)
 *     2) Main Sphere + Inner "+" Core (top-left lighting, Fresnel rim, mottling,
 *        lower-right crescent shadow, travelling dust patch, ripple/shimmer)
 *     3) Hover Cloud (lifted fine particles around pointer)
 *     4) Burst Debris (radial + tangential particles spawned on click / fast drag)
 * - Physics & Interactions:
 *     - 2.5s cubic ease-out entrance scale (0.78 -> 1.0) + 90 deg yaw sweep
 *     - Autonomous Y-axis spin (0.06 rad/s) with smooth momentum inertia
 *     - Cursor hover dent, warm glow, lifted cloud & gentle moving ripples
 *     - Left-click spherical shockwave ripples + directional debris burst
 *     - Left-drag 3D orbit with inertia + high-speed debris shedding
 *     - Right-click hold spring-physics contraction pulse
 */

const TONES = {
  rind: {
    shade: [0.04, 0.36, 0.2],
    light: [0.62, 0.96, 0.76],
    impact: [0.32, 0.8, 0.53],
    css: "#52cc86",
  },
  amber: {
    shade: [0.42, 0.22, 0.03],
    light: [1.0, 0.86, 0.58],
    impact: [0.95, 0.65, 0.22],
    css: "#f2a638",
  },
  cobalt: {
    shade: [0.05, 0.18, 0.45],
    light: [0.62, 0.84, 1.0],
    impact: [0.3, 0.6, 0.98],
    css: "#4d99fa",
  },
  rose: {
    shade: [0.42, 0.08, 0.2],
    light: [1.0, 0.72, 0.82],
    impact: [0.94, 0.38, 0.56],
    css: "#f0618f",
  },
};

const VERTEX_SHADER_SRC = `
precision highp float;

attribute vec3 aPos;
attribute vec4 aMeta; // x: seed, y: strand, z: shellSeed, w: kind (0 = sphere, 1 = plusCore)

uniform vec2 uSize;
uniform float uDpr;
uniform float uTime;
uniform float uYaw;
uniform float uTilt;
uniform float uEnter;
uniform float uZoom;

uniform vec4 uSettings; // x: brightness, y: noise, z: shellOpacity, w: spread (1.3)
uniform float uBlur;
uniform float uDotSize;
uniform float uDotBrightness;

uniform float uShell;
uniform float uCloud;
uniform float uDebris;

uniform vec2 uMouse;
uniform float uMouseActive;

uniform float uNoisePulse;
uniform float uOuterPulse;

uniform vec4 uImpacts[4]; // x: age, y: strength, z: speed, w: active
uniform vec3 uHitDirs[4];

uniform vec4 uDebrisInfo; // x: age, y: life, z: speed, w: seedOffset
uniform vec3 uDebrisDir;
uniform vec3 uDebrisTangent;

uniform vec3 uShade;
uniform vec3 uLight;
uniform vec3 uImpact;

varying vec3 vColour;
varying float vAlpha;
varying float vBlur;

mat3 rotY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(
    c, 0.0, s,
    0.0, 1.0, 0.0,
   -s, 0.0, c
  );
}

mat3 rotX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(
    1.0, 0.0, 0.0,
    0.0, c, -s,
    0.0, s, c
  );
}

void main() {
  float seed = aMeta.x;
  float strand = aMeta.y;
  float shellSeed = aMeta.z;
  float isCore = aMeta.w;

  // Pass filtering
  if (uShell > 0.5) {
    if (isCore > 0.5 || shellSeed < 0.76) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
  } else if (uCloud > 0.5) {
    if (isCore > 0.5 || uMouseActive < 0.01 || shellSeed < 0.35) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
  } else if (uDebris > 0.5) {
    if (isCore > 0.5 || shellSeed < 0.88) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
  }

  vec2 center = vec2(uSize.x * 0.5, uSize.y * 0.5);
  float scale = min(uSize.x, uSize.y) * 0.34 * uZoom * uEnter;

  // Base position & rotation
  vec3 basePos = aPos;
  mat3 R = rotX(uTilt) * rotY(uYaw);
  vec3 p = R * basePos;
  vec3 surface = normalize(p + vec3(1e-5));

  // Right-click contraction pulse
  float coreContract = 1.0 - uNoisePulse * 0.42;
  float shellContract = 1.0 - uOuterPulse * 0.16;

  // Autonomous ripple + shimmer noise
  float ripple = sin(p.x * 11.0 + p.y * 7.0 + uTime * 0.7) * 0.006;
  float shimmer =
    sin(p.x * 19.0 + p.z * 13.0 + uTime * 1.2) *
    sin(p.y * 17.0 - p.z * 11.0 + uTime * 0.9) * 0.65 +
    sin(seed * 73.0 + uTime * 1.5) * 0.35;

  // Travelling silhouette dust patch (~1 rev/min)
  float dustAngle = 0.6 + uTime * 0.105;
  vec3 dustCenter = normalize(vec3(cos(dustAngle), sin(dustAngle) * 0.72, 0.15));
  float dustProx = smoothstep(0.62, 0.98, dot(surface, dustCenter));
  float dust = dustProx * smoothstep(0.45, 0.95, strand) * (1.0 - isCore);

  // Spherical shockwave impacts
  float impactDisp = 0.0;
  float impactBlush = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 imp = uImpacts[i];
    if (imp.w > 0.5) {
      float age = imp.x;
      float strength = imp.y;
      float speed = imp.z;
      float ang = acos(clamp(dot(surface, normalize(uHitDirs[i])), -1.0, 1.0));
      float frontDist = ang - age * speed;
      float env = exp(-frontDist * frontDist * 14.0) * exp(-age * 1.45) * strength;
      float wave = sin(frontDist * 15.0);
      impactDisp += wave * env * 0.13;
      impactBlush += abs(wave) * env;
    }
  }
  impactBlush = clamp(impactBlush, 0.0, 1.0);

  // Compute screen position before hover dent for pointer distance
  vec2 preScreen = vec2(center.x + p.x * scale, center.y - p.y * scale);
  vec2 deltaMouse = preScreen - uMouse;
  float mouseDistSq = dot(deltaMouse, deltaMouse);
  float frontMask = smoothstep(-0.1, 0.4, p.z);
  float hover = exp(-mouseDistSq / 6500.0) * frontMask * uMouseActive;
  float hoverLight = exp(-mouseDistSq / 12000.0) * uMouseActive;

  // Radial modulation
  float radius = length(p);
  if (isCore > 0.5) {
    radius *= coreContract;
    radius += shimmer * uSettings.y * 0.55;
    radius += impactDisp * 0.35;
    p = surface * radius;
  } else if (uShell > 0.5) {
    radius = uSettings.w * shellContract;
    radius += ripple * 1.4 + shimmer * uSettings.y * 2.2;
    radius += (seed - 0.5) * 0.06;
    p = surface * radius;
  } else if (uCloud > 0.5) {
    if (hover < 0.04) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float lift = 0.015 + seed * 0.05 + hover * 0.045;
    vec3 jitter = vec3(
      sin(seed * 91.7 + uTime * 2.4),
      cos(strand * 67.3 - uTime * 2.1),
      sin(shellSeed * 53.1 + uTime * 1.8)
    ) * 0.014;
    p = surface * (1.0 + lift) + jitter;
  } else if (uDebris > 0.5) {
    float age = uDebrisInfo.x;
    float life = uDebrisInfo.y;
    float spd = uDebrisInfo.z;
    float progress = clamp(age / max(life, 0.001), 0.0, 1.0);
    float cone = smoothstep(0.65, 0.98, dot(surface, normalize(uDebrisDir)));
    if (cone < 0.02 || progress >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float outTravel = (0.12 + seed * 0.55) * spd * (1.0 - pow(1.0 - progress, 2.2));
    vec3 tanMove = uDebrisTangent * (0.2 + strand * 0.65) * spd * progress;
    vec3 drift = vec3(
      sin(seed * 41.0 + age * 2.0),
      cos(strand * 37.0 + age * 1.7),
      sin(shellSeed * 29.0)
    ) * 0.03 * progress;
    p = surface * (1.0 + outTravel) + tanMove + drift;
  } else {
    // Main sphere pass
    radius = 1.0 * (1.0 - uNoisePulse * 0.08);
    radius += ripple + shimmer * uSettings.y;
    radius += impactDisp;
    radius -= hover * 0.09;
    // Dust drift outward & along tangent
    vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), surface) + vec3(0.001, 0.0, 0.0));
    p = surface * (radius + dust * (0.035 + seed * 0.06)) + tangent * (dust * 0.045 * (strand - 0.5));
  }

  // Lighting & Shadow (Y-up 3D space)
  float lighting = clamp(0.52 - surface.x * 0.48 + surface.y * 0.32, 0.08, 1.0);
  float front = clamp((p.z + 1.0) * 0.5, 0.0, 1.0);
  float edge = pow(max(1.0 - abs(surface.z), 0.0), 3.0);
  float rimLight = edge * (0.95 + lighting * lighting * 0.55);
  float mottle = 0.65 + 0.35 * sin(surface.x * 9.0 + surface.z * 4.0) * cos(surface.y * 8.0 - surface.z * 5.0);
  float lowerRightShadow = smoothstep(-0.25, 0.65, surface.x) * smoothstep(-0.25, 0.65, -surface.y);

  // Colour & Alpha per pass
  vec3 col = mix(uShade, uLight, clamp(lighting * 0.72 + rimLight * 0.58 + seed * 0.16, 0.0, 1.0));
  float alpha = 1.0;
  float pointSize = 1.0;
  vBlur = 0.0;

  if (uShell > 0.5) {
    // Outer atmospheric halo
    col = mix(col, vec3(1.0, 0.97, 0.91), 0.16);
    vBlur = uBlur * smoothstep(0.55, 1.3, p.z + 0.55);
    float coreSize = (1.2 + seed * 0.9 + edge * 1.1) * uDpr * uDotSize;
    pointSize = coreSize + vBlur * uDpr;
    alpha = (0.14 + lighting * 0.22 + rimLight * 0.28) * uSettings.z;
    alpha *= (1.0 - lowerRightShadow * 0.72);
    alpha *= smoothstep(-1.1, 0.85, p.z);
  } else if (uCloud > 0.5) {
    // Hover lifted particle cloud
    col = mix(uLight, vec3(1.0, 0.95, 0.72), 0.28);
    vBlur = 1.4;
    pointSize = (1.2 + seed * 1.0) * uDpr * uDotSize + vBlur * uDpr;
    alpha = hover * (0.45 + seed * 0.35);
  } else if (uDebris > 0.5) {
    // Burst debris
    float progress = clamp(uDebrisInfo.x / max(uDebrisInfo.y, 0.001), 0.0, 1.0);
    float fade = (1.0 - progress) * smoothstep(0.0, 0.08, progress);
    col = mix(uImpact, uLight, 0.55 + seed * 0.35);
    vBlur = 1.2 * progress;
    pointSize = (1.4 + seed * 1.4) * uDpr * uDotSize + vBlur * uDpr;
    alpha = fade * 0.78;
  } else if (isCore > 0.5) {
    // Inner 3D "+" core — crisp volumetric mint-white dots clearly legible inside the orb
    float coreDepth = clamp((p.z + 0.55) / 1.1, 0.0, 1.0);
    float coreLight = clamp(0.52 - p.x * 0.55 + p.y * 0.38, 0.18, 1.0);
    float glint = smoothstep(0.65, 1.0, seed);
    col = mix(uShade, uLight, clamp(coreLight * 0.58 + coreDepth * 0.52 + seed * 0.22, 0.0, 1.0));
    col = mix(col, vec3(0.92, 1.0, 0.95), glint * coreDepth * 0.58);
    col = mix(col, vec3(1.0, 0.95, 0.72), hoverLight * 0.12);
    col = mix(col, uImpact, impactBlush * 0.45);
    col *= (1.0 + hoverLight * front * 0.65);

    float sparkle = 0.65 + 0.35 * sin(seed * 120.0 + uTime * 1.4);
    alpha = (0.28 + coreDepth * 0.52 + coreLight * 0.28) * sparkle * uDotBrightness * 0.62;
    alpha *= (1.0 - lowerRightShadow * 0.35);
    alpha *= (1.0 + impactBlush * 0.55);

    pointSize = (1.45 + coreDepth * (0.45 + seed * 0.75) + glint * 0.5) * uDpr * uDotSize * 1.25;
    vBlur = 0.0;
  } else {
    // Main Fibonacci sphere
    col = mix(col, vec3(0.93, 1.0, 0.96), smoothstep(0.35, 1.1, rimLight) * 0.62);
    col = mix(col, vec3(1.0, 0.95, 0.72), hoverLight * 0.12);
    col = mix(col, uImpact, impactBlush * 0.45);
    col *= (1.0 + hoverLight * front * 0.9);

    float baseAlpha = (0.14 + front * 0.19 + rimLight * 0.88) * mottle;
    alpha = baseAlpha * uDotBrightness * 0.66 * uSettings.x * 0.82;
    alpha *= (1.0 - lowerRightShadow * 0.92);
    alpha *= (1.0 + impactBlush * 0.6);
    alpha *= (1.0 - dust * 0.35);

    pointSize = (1.35 + front * (0.25 + seed * 0.45) + edge * (1.6 + strand * 2.5)) * (1.0 - dust * 0.45) * uDpr * uDotSize;
    vBlur = dust * 1.5;
  }

  // Project to NDC (CSS pixel top-left origin -> WebGL NDC)
  vec2 screenPos = vec2(center.x + p.x * scale, center.y - p.y * scale);
  vec2 ndc = vec2(
    (screenPos.x / uSize.x) * 2.0 - 1.0,
    1.0 - (screenPos.y / uSize.y) * 2.0
  );

  gl_Position = vec4(ndc, -p.z * 0.1, 1.0);
  gl_PointSize = clamp(pointSize, 1.0, 48.0);
  vColour = col;
  vAlpha = clamp(alpha, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision highp float;

varying vec3 vColour;
varying float vAlpha;
varying float vBlur;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;

  float sharp = 1.0 - smoothstep(0.25, 0.5, d);
  float soft = exp(-d * d * 18.0) * (1.0 - smoothstep(0.35, 0.5, d));
  float alpha = vAlpha * mix(sharp, soft, min(vBlur / 3.0, 1.0));

  if (alpha < 0.002) discard;

  // Premultiplied alpha output
  gl_FragColor = vec4(vColour * alpha, alpha);
}
`;

// Deterministic PRNG (Mulberry32) so the "+" core looks identical every load
function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGeometryData() {
  const SPHERE_COUNT = 12000;
  const CORE_COUNT = 5800;
  const TOTAL = SPHERE_COUNT + CORE_COUNT;

  const positions = new Float32Array(TOTAL * 3);
  const meta = new Float32Array(TOTAL * 4);

  const rng = createRng(133742);
  const GOLDEN_ANGLE = 2.39996323;

  // 1) Outer Fibonacci sphere (12,000 points)
  for (let i = 0; i < SPHERE_COUNT; i++) {
    const y = 1.0 - (2.0 * (i + 0.5)) / SPHERE_COUNT;
    const r = Math.sqrt(Math.max(0.0, 1.0 - y * y));
    const theta = i * GOLDEN_ANGLE;

    const i3 = i * 3;
    positions[i3] = Math.cos(theta) * r;
    positions[i3 + 1] = y;
    positions[i3 + 2] = Math.sin(theta) * r;

    const i4 = i * 4;
    meta[i4] = rng(); // seed
    meta[i4 + 1] = rng(); // strand
    meta[i4 + 2] = rng(); // shellSeed
    meta[i4 + 3] = 0.0; // kind: sphere
  }

  // 2) Inner volumetric 3D "+" core (5,800 points)
  // Two intersecting 3D bars: half-thickness t = 0.22, arm length = 0.8, scaled by 0.59,
  // clipped to spherical Z depth sqrt(max(0, 0.92 - x^2 - y^2)), tilted 10 deg around X.
  const BAR_HALF_T = 0.22;
  const BAR_LEN = 0.8;
  const CORE_SIZE = 0.59;
  const TILT_RAD = (10 * Math.PI) / 180;
  const cosT = Math.cos(TILT_RAD);
  const sinT = Math.sin(TILT_RAD);

  let placed = 0;
  let guard = 0;
  while (placed < CORE_COUNT && guard < CORE_COUNT * 10) {
    guard++;
    let x, y;
    if (rng() < 0.5) {
      // Horizontal bar
      x = (rng() * 2 - 1) * BAR_LEN;
      y = (rng() * 2 - 1) * BAR_HALF_T;
    } else {
      // Vertical bar
      x = (rng() * 2 - 1) * BAR_HALF_T;
      y = (rng() * 2 - 1) * BAR_LEN;
      // Avoid double-density in the overlapping center square
      if (Math.abs(y) < BAR_HALF_T && rng() < 0.5) continue;
    }

    const rSq = x * x + y * y;
    const maxZ = Math.sqrt(Math.max(0.0, 0.92 - rSq));
    // Bias slightly toward front/back faces and edges for crisp 3D "+" readability
    let zRaw = rng() * 2 - 1;
    if (rng() < 0.35) {
      zRaw = Math.sign(zRaw || 1) * (0.65 + rng() * 0.35);
    }
    const z = zRaw * maxZ * 0.46;

    const sx = x * CORE_SIZE;
    const sy = y * CORE_SIZE;
    const sz = z * CORE_SIZE;

    // Static 10 deg X-axis tilt baked into core
    const ty = sy * cosT - sz * sinT;
    const tz = sy * sinT + sz * cosT;

    const idx = SPHERE_COUNT + placed;
    const i3 = idx * 3;
    positions[i3] = sx;
    positions[i3 + 1] = ty;
    positions[i3 + 2] = tz;

    const i4 = idx * 4;
    meta[i4] = rng();
    meta[i4 + 1] = rng();
    meta[i4 + 2] = rng();
    meta[i4 + 3] = 1.0; // kind: plusCore
    placed++;
  }

  return { positions, meta, count: TOTAL };
}

class MotionPlusOrb {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      tone: "rind",
      brightness: 1.3,
      noise: 0.01,
      pulse: 0.6,
      showShell: true,
      shellOpacity: 0.7,
      spread: 1.3,
      blur: 5.0,
      spin: 0.06,
      reveal: 2.5,
      dotSize: 0.45,
      dotBrightness: 1.9,
      tiltDeg: 10,
      onFirstFrame: null,
      ...options,
    };

    this.gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });

    if (!this.gl) {
      console.error("WebGL 1 is not supported in this browser.");
      return;
    }

    // Animation & camera state
    this.time = 0;
    this.lastTs = 0;
    this.revealElapsed = 0;
    this.firstFrameFired = false;

    this.baseYaw = -Math.PI / 2;
    this.yaw = 0;
    this.tilt = (this.options.tiltDeg * Math.PI) / 180;
    this.yawVel = this.options.spin;
    this.tiltVel = 0;

    // Pointer / drag state
    this.isDragging = false;
    this.dragMoved = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.mouseTarget = [0, 0];
    this.mouseSmooth = [0, 0];
    this.mouseActive = 0;
    this.mouseInside = false;
    this.hoverRippleCooldown = 0;

    // Right-click spring contraction pulse
    this.isRightHeld = false;
    this.noisePulse = 0;
    this.noisePulseVel = 0;
    this.outerPulse = 0;
    this.outerPulseVel = 0;

    // Up to 4 concurrent spherical shockwave impacts
    this.impacts = Array.from({ length: 4 }, () => ({
      active: false,
      age: 0,
      strength: 0,
      speed: 1.9,
      dir: [0, 0, 1],
    }));
    this.nextImpactSlot = 0;

    // Active debris bursts (up to 3)
    this.debrisBursts = [];

    this.width = 1;
    this.height = 1;
    this.dpr = 1;

    this._initGL();
    this._bindEvents();
    this._resize();

    this.rafId = requestAnimationFrame((ts) => this._tick(ts));
  }

  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _initGL() {
    const gl = this.gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(prog));
      return;
    }
    this.program = prog;
    gl.useProgram(prog);

    const { positions, meta, count } = buildGeometryData();
    this.particleCount = count;

    this.posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.metaBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.metaBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, meta, gl.STATIC_DRAW);

    this.attribs = {
      aPos: gl.getAttribLocation(prog, "aPos"),
      aMeta: gl.getAttribLocation(prog, "aMeta"),
    };

    const uniformNames = [
      "uSize",
      "uDpr",
      "uTime",
      "uYaw",
      "uTilt",
      "uEnter",
      "uZoom",
      "uSettings",
      "uBlur",
      "uDotSize",
      "uDotBrightness",
      "uShell",
      "uCloud",
      "uDebris",
      "uMouse",
      "uMouseActive",
      "uNoisePulse",
      "uOuterPulse",
      "uDebrisInfo",
      "uDebrisDir",
      "uDebrisTangent",
      "uShade",
      "uLight",
      "uImpact",
    ];
    this.uniforms = {};
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
    this.uImpactsLoc = gl.getUniformLocation(prog, "uImpacts[0]");
    this.uHitDirsLoc = gl.getUniformLocation(prog, "uHitDirs[0]");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(8 / 255, 8 / 255, 8 / 255, 1.0);
  }

  _bindEvents() {
    this._onResize = () => this._resize();
    window.addEventListener("resize", this._onResize);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.canvas);
    }

    this._onPointerDown = (e) => {
      if (e.button === 2) {
        this.isRightHeld = true;
        return;
      }
      if (e.button !== 0) return;

      const pt = this._getLocalCoords(e);
      this.isDragging = true;
      this.dragMoved = 0;
      this.lastPointerX = pt.x;
      this.lastPointerY = pt.y;
      this.mouseTarget = [pt.x, pt.y];
      this.mouseInside = true;
      this.canvas.classList.add("is-grabbing");
      this.canvas.setPointerCapture?.(e.pointerId);
    };

    this._onPointerMove = (e) => {
      const pt = this._getLocalCoords(e);
      this.mouseTarget = [pt.x, pt.y];
      this.mouseInside = true;

      if (this.isDragging) {
        const dx = pt.x - this.lastPointerX;
        const dy = pt.y - this.lastPointerY;
        this.dragMoved += Math.hypot(dx, dy);
        this.lastPointerX = pt.x;
        this.lastPointerY = pt.y;

        this.yaw += dx * 0.003;
        this.tilt = Math.max(-1.25, Math.min(1.25, this.tilt - dy * 0.003));
        this.yawVel = dx * 0.14;
        this.tiltVel = -dy * 0.12;

        // High angular velocity sheds tangential debris
        const speed = Math.hypot(dx, dy);
        if (speed > 18 && this.debrisBursts.length < 3) {
          const hitDir = this._screenToSphereDir(pt.x, pt.y);
          if (hitDir) {
            const tangent = this._normalize([dx, -dy, 0.25]);
            this._spawnDebris(hitDir, tangent, Math.min(speed / 28, 1.4));
          }
        }
      } else {
        // Gentle periodic surface impacts while hovering & moving inside sphere
        if (this.hoverRippleCooldown <= 0) {
          const hitDir = this._screenToSphereDir(pt.x, pt.y);
          if (hitDir) {
            this.triggerImpact(hitDir, 0.36, 1.7);
            this.hoverRippleCooldown = 0.22;
          }
        }
      }
    };

    this._onPointerUp = (e) => {
      if (e.button === 2) {
        this.isRightHeld = false;
        return;
      }
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.classList.remove("is-grabbing");

      // Click (<= 6px drag) triggers shockwave ripple + directional debris burst
      if (this.dragMoved <= 6) {
        const pt = this._getLocalCoords(e);
        const hitDir = this._screenToSphereDir(pt.x, pt.y) || [0, 0, 1];
        this.triggerImpact(hitDir, 1.0, 1.9);
        const tangent = this._normalize([-hitDir[1], hitDir[0], 0.2]);
        this._spawnDebris(hitDir, tangent, 1.0);
      }
    };

    this._onPointerLeave = () => {
      this.mouseInside = false;
      if (!this.isDragging) {
        this.canvas.classList.remove("is-grabbing");
      }
    };

    this._onContextMenu = (e) => {
      e.preventDefault();
    };

    this.canvas.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    this.canvas.addEventListener("pointerleave", this._onPointerLeave);
    this.canvas.addEventListener("contextmenu", this._onContextMenu);
  }

  _getLocalCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _screenToSphereDir(sx, sy) {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const scale = Math.min(this.width, this.height) * 0.34;
    const nx = (sx - cx) / scale;
    const ny = -(sy - cy) / scale; // Y-up
    const rSq = nx * nx + ny * ny;
    if (rSq > 1.0) return null;
    const nz = Math.sqrt(Math.max(0.0, 1.0 - rSq));
    return [nx, ny, nz];
  }

  _normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  triggerImpact(dir = [0, 0.2, 0.98], strength = 1.0, speed = 1.9) {
    const slot = this.impacts[this.nextImpactSlot];
    this.nextImpactSlot = (this.nextImpactSlot + 1) % this.impacts.length;
    slot.active = true;
    slot.age = 0;
    slot.strength = strength;
    slot.speed = speed;
    slot.dir = this._normalize(dir);
  }

  _spawnDebris(dir, tangent, speed = 1.0) {
    this.debrisBursts.push({
      age: 0,
      life: 3.0 + Math.random() * 1.0,
      speed,
      dir: this._normalize(dir),
      tangent: this._normalize(tangent),
      seedOffset: Math.random() * 10,
    });
    if (this.debrisBursts.length > 3) {
      this.debrisBursts.shift();
    }
  }

  replayReveal() {
    this.revealElapsed = 0;
    this.yaw = 0;
    this.tilt = (this.options.tiltDeg * Math.PI) / 180;
    this.yawVel = this.options.spin;
    this.tiltVel = 0;
  }

  resetView() {
    this.yaw = 0;
    this.tilt = (this.options.tiltDeg * Math.PI) / 180;
    this.yawVel = this.options.spin;
    this.tiltVel = 0;
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  _tick(ts) {
    if (!this.lastTs) this.lastTs = ts;
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    this.time += dt;
    this.revealElapsed += dt;
    if (this.hoverRippleCooldown > 0) this.hoverRippleCooldown -= dt;

    // 1) Entrance reveal: cubic ease-out over 2.5s (scale 0.78 -> 1.0, yaw -PI/2 -> 0)
    const revealT = Math.min(this.revealElapsed / this.options.reveal, 1.0);
    const easeOut = 1.0 - Math.pow(1.0 - revealT, 3.0);
    const enterScale = 0.78 + 0.22 * easeOut;
    const revealYawOffset = this.baseYaw * (1.0 - easeOut);

    // 2) Autonomous spin + momentum inertia (1.6s decay toward spin target)
    if (!this.isDragging) {
      const decay = 1.0 - Math.exp(-dt / 1.6);
      this.yawVel += (this.options.spin - this.yawVel) * decay;
      this.tiltVel += (0.0 - this.tiltVel) * decay;
      this.yaw += this.yawVel * dt;
      this.tilt = Math.max(-1.25, Math.min(1.25, this.tilt + this.tiltVel * dt));
    }

    // 3) Smooth pointer tracking (0.045s exponential time constant)
    const ptrAlpha = 1.0 - Math.exp(-dt / 0.045);
    this.mouseSmooth[0] += (this.mouseTarget[0] - this.mouseSmooth[0]) * ptrAlpha;
    this.mouseSmooth[1] += (this.mouseTarget[1] - this.mouseSmooth[1]) * ptrAlpha;
    const targetActive = this.mouseInside ? 1.0 : 0.0;
    this.mouseActive += (targetActive - this.mouseActive) * (1.0 - Math.exp(-dt / 0.14));

    // 4) Right-click spring-physics contraction pulse
    const targetPulse = this.isRightHeld ? this.options.pulse : 0.0;
    const kCore = 120.0;
    const dCore = 14.0;
    this.noisePulseVel += ((targetPulse - this.noisePulse) * kCore - this.noisePulseVel * dCore) * dt;
    this.noisePulse = Math.max(0.0, this.noisePulse + this.noisePulseVel * dt);

    const kOuter = 75.0;
    const dOuter = 11.0;
    this.outerPulseVel += ((targetPulse - this.outerPulse) * kOuter - this.outerPulseVel * dOuter) * dt;
    this.outerPulse = Math.max(0.0, this.outerPulse + this.outerPulseVel * dt);

    // 5) Advance spherical impacts
    for (const imp of this.impacts) {
      if (!imp.active) continue;
      imp.age += dt;
      if (imp.age > 3.2) {
        imp.active = false;
      }
    }

    // 6) Advance debris bursts
    for (let i = this.debrisBursts.length - 1; i >= 0; i--) {
      this.debrisBursts[i].age += dt;
      if (this.debrisBursts[i].age >= this.debrisBursts[i].life) {
        this.debrisBursts.splice(i, 1);
      }
    }

    this._render(enterScale, this.yaw + revealYawOffset);

    if (!this.firstFrameFired) {
      this.firstFrameFired = true;
      this.options.onFirstFrame?.();
    }

    this.rafId = requestAnimationFrame((nextTs) => this._tick(nextTs));
  }

  _render(enterScale, totalYaw) {
    const gl = this.gl;
    const u = this.uniforms;
    const tone = TONES[this.options.tone] || TONES.rind;

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    // Bind vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(this.attribs.aPos);
    gl.vertexAttribPointer(this.attribs.aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.metaBuffer);
    gl.enableVertexAttribArray(this.attribs.aMeta);
    gl.vertexAttribPointer(this.attribs.aMeta, 4, gl.FLOAT, false, 0, 0);

    // Shared uniforms
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uYaw, totalYaw);
    gl.uniform1f(u.uTilt, this.tilt);
    gl.uniform1f(u.uEnter, enterScale);
    gl.uniform1f(u.uZoom, 1.0);

    gl.uniform4f(
      u.uSettings,
      this.options.brightness,
      this.options.noise,
      this.options.shellOpacity,
      this.options.spread
    );
    gl.uniform1f(u.uBlur, this.options.blur);
    gl.uniform1f(u.uDotSize, this.options.dotSize);
    gl.uniform1f(u.uDotBrightness, this.options.dotBrightness);

    gl.uniform2f(u.uMouse, this.mouseSmooth[0], this.mouseSmooth[1]);
    gl.uniform1f(u.uMouseActive, this.mouseActive);
    gl.uniform1f(u.uNoisePulse, this.noisePulse);
    gl.uniform1f(u.uOuterPulse, this.outerPulse);

    gl.uniform3fv(u.uShade, tone.shade);
    gl.uniform3fv(u.uLight, tone.light);
    gl.uniform3fv(u.uImpact, tone.impact);

    // Pack 4 impact uniforms
    const impData = new Float32Array(16);
    const dirData = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      const imp = this.impacts[i];
      impData[i * 4] = imp.age;
      impData[i * 4 + 1] = imp.strength;
      impData[i * 4 + 2] = imp.speed;
      impData[i * 4 + 3] = imp.active ? 1.0 : 0.0;

      dirData[i * 3] = imp.dir[0];
      dirData[i * 3 + 1] = imp.dir[1];
      dirData[i * 3 + 2] = imp.dir[2];
    }
    gl.uniform4fv(this.uImpactsLoc, impData);
    gl.uniform3fv(this.uHitDirsLoc, dirData);

    // Pass 1: Outer Shell Halo
    if (this.options.showShell) {
      gl.uniform1f(u.uShell, 1.0);
      gl.uniform1f(u.uCloud, 0.0);
      gl.uniform1f(u.uDebris, 0.0);
      gl.drawArrays(gl.POINTS, 0, this.particleCount);
    }

    // Pass 2: Main Sphere + Inner "+" Core
    gl.uniform1f(u.uShell, 0.0);
    gl.uniform1f(u.uCloud, 0.0);
    gl.uniform1f(u.uDebris, 0.0);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);

    // Pass 3: Hover Lifted Cloud
    if (this.mouseActive > 0.01) {
      gl.uniform1f(u.uShell, 0.0);
      gl.uniform1f(u.uCloud, 1.0);
      gl.uniform1f(u.uDebris, 0.0);
      gl.drawArrays(gl.POINTS, 0, this.particleCount);
    }

    // Pass 4: Burst Debris
    if (this.debrisBursts.length > 0) {
      gl.uniform1f(u.uShell, 0.0);
      gl.uniform1f(u.uCloud, 0.0);
      gl.uniform1f(u.uDebris, 1.0);
      for (const burst of this.debrisBursts) {
        gl.uniform4f(u.uDebrisInfo, burst.age, burst.life, burst.speed, burst.seedOffset);
        gl.uniform3fv(u.uDebrisDir, burst.dir);
        gl.uniform3fv(u.uDebrisTangent, burst.tangent);
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this._onResize);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointerleave", this._onPointerLeave);
    this.canvas.removeEventListener("contextmenu", this._onContextMenu);
  }
}

// Bootstrap page
window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("orb-canvas");
  const orb = new MotionPlusOrb(canvas, { tone: "rind" });
  window.__motionOrb = orb;
});
