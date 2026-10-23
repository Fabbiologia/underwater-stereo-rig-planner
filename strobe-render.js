/*
 * strobe-render.js — GPU renderer for the Strobe Lighting Lab.
 *
 * One fragment-shader invocation per pixel traces a ray from the camera's
 * entrance pupil through the port into the water and adds up, in physical
 * units (luminance-time, cd·s/m²):
 *   1. strobe light reflected by the scene: beam profile × inverse square ×
 *      exp(−c·path) × Lambert (+ a little specular), with soft shadows from the
 *      strobe's light-emitting window;
 *   2. backscatter haze: single scattering by the water, integrated along the
 *      ray, with the Fournier–Forand phase function and (optionally) the
 *      shadows the scene casts inside the water;
 *   3. backscatter specks: discrete particles (marine snow) placed
 *      procedurally in depth slices, lit by the strobes and blurred by defocus;
 *   4. daylight: downwelling light on the scene and the blue/green water
 *      background (approximate model).
 * The sum is scaled by the camera exposure (ISO, f-number, shutter) and tone
 * mapped. The CPU reference implementation of the same model is in
 * strobe-physics.js.
 */
(function (root) {
  'use strict';
  var Sim = root.StrobeSim;
  var MAXP = 48;

  var VS = '#version 300 es\nin vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }\n';

  var FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 fragColor;

#define MAXP ${MAXP}
#define PI 3.14159265359

uniform vec2 uRes;
uniform int uView;          // 0 camera, 1 observer
uniform int uMode;          // 0 photo, 1 backscatter only, 2 same scene in air, 3 exposure map, 4 strobe light only
uniform int uProj;          // 0 flat port, 1 rectilinear in water (dome / wet lens), 2 fisheye in dome, 3 observer pinhole
uniform float uFpx;
uniform float uNw;
uniform float uPupil;
uniform mat3 uCamRot;
uniform vec3 uObsPos;
uniform mat3 uObsRot;
uniform float uObsFpx;

uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uPhase;

uniform int uNS;
uniform vec3 uSPos[2];
uniform vec3 uSAx[2];
uniform vec3 uSRt[2];
uniform vec3 uSUp[2];
uniform vec3 uSI[2];
uniform vec4 uSBeam[2];
uniform float uSRad[2];

uniform vec3 uEd;
uniform vec3 uKd;
uniform vec3 uLinf;
uniform float uShutter;
uniform float uAmb;
uniform float uKexp;

uniform sampler2D uPrims;
uniform int uNP;
uniform vec3 uAnchor;

uniform float uRho;
uniform float uDep;
uniform float uFocusInv;
uniform float uFpxAir;
uniform float uDomeR;
uniform float uPartMax;
uniform int uSlices;
uniform int uSteps;
uniform int uSoft;
uniform int uVolShadow;
uniform float uWarp;
uniform float uRmax;
uniform uint uSeed;
uniform float uBoost;
uniform float uPhaseConst;   // > 0: use this constant phase function (observer view, beam-shape teaching mode)

/* ---------------- hashing and noise (identical to strobe-physics.js) ---------------- */
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint h3(ivec3 p) { return pcg(uint(p.x) + pcg(uint(p.y) + pcg(uint(p.z)))); }
float hf(uint h) { return float(h) * 2.3283064365386963e-10; }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = x - i; vec3 u = f * f * (3.0 - 2.0 * f); ivec3 q = ivec3(i);
  float a = hf(h3(q)), b = hf(h3(q + ivec3(1, 0, 0))), c = hf(h3(q + ivec3(0, 1, 0))), d = hf(h3(q + ivec3(1, 1, 0)));
  float e = hf(h3(q + ivec3(0, 0, 1))), f2 = hf(h3(q + ivec3(1, 0, 1))), g = hf(h3(q + ivec3(0, 1, 1))), h = hf(h3(q + ivec3(1, 1, 1)));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }

bool fanSolid(vec2 uv, float R) {
  vec2 q = vec2(uv.x, uv.y + R);
  float ang = atan(q.x, max(q.y, 1e-4));
  float rad = length(q) / (2.0 * R);
  float nz = vnoise(vec3(q.x / R * 2.25, q.y / R * 2.25, 1.7)), nz2 = vnoise(vec3(q.x / R * 5.1, q.y / R * 5.1, 4.3));
  if (abs(ang) > 1.25 + 0.12 * nz2) return false;
  if (rad > 0.90 + 0.10 * nz) return false;
  if (rad < 0.05 && abs(q.x) < 0.025 * R) return true;
  float br = abs(fract(ang * 7.0 + 2.2 * nz + 0.9 * nz2 * rad) - 0.5);
  float thick = mix(0.17, 0.08, rad);
  float lk = abs(fract(rad * 24.0 + 2.6 * nz2 + 1.1 * nz + 0.8 * sin(ang * 9.0)) - 0.5);
  return br > 0.5 - thick || lk > 0.5 - 0.05;
}

/* ---------------- primitives ---------------- */
vec4 PT(int i, int k) { return texelFetch(uPrims, ivec2(k, i), 0); }
mat3 primFrame(int i) { return mat3(PT(i, 3).xyz, PT(i, 4).xyz, PT(i, 5).xyz); }  // columns = local axes in world

float intersectPrim(int i, int type, int mat, vec3 ro, vec3 rd, out vec3 n) {
  n = vec3(0.0, 1.0, 0.0);
  vec4 A = PT(i, 1), Bv = PT(i, 2);
  if (type == 1) {
    vec3 oc = ro - A.xyz; float b = dot(oc, rd); float cc = dot(oc, oc) - A.w * A.w; float h = b * b - cc;
    if (h < 0.0) return -1.0; h = sqrt(h); float t = -b - h; if (t <= 1e-6) t = -b + h; if (t <= 1e-6) return -1.0;
    n = (ro + rd * t - A.xyz) / A.w; return t;
  } else if (type == 2) {
    mat3 Wm = primFrame(i); mat3 Lm = transpose(Wm);
    vec3 ol = Lm * (ro - A.xyz), dl = Lm * rd; vec3 os = ol / Bv.xyz, ds = dl / Bv.xyz;
    float a = dot(ds, ds), b = dot(os, ds), cc = dot(os, os) - 1.0; float h = b * b - a * cc;
    if (h < 0.0) return -1.0; h = sqrt(h); float t = (-b - h) / a; if (t <= 1e-6) t = (-b + h) / a; if (t <= 1e-6) return -1.0;
    vec3 pl = ol + dl * t; n = normalize(Wm * (pl / (Bv.xyz * Bv.xyz))); return t;
  } else if (type == 3) {
    float den = dot(Bv.xyz, rd); if (abs(den) < 1e-9) return -1.0;
    float t = (Bv.w - dot(Bv.xyz, ro)) / den; if (t <= 1e-6) return -1.0; n = Bv.xyz; return t;
  } else if (type == 4) {
    mat3 Wm = primFrame(i); vec3 nn = Wm[2]; float dd = dot(nn, rd); if (abs(dd) < 1e-9) return -1.0;
    float t = dot(A.xyz - ro, nn) / dd; if (t <= 1e-6) return -1.0;
    vec3 q = ro + rd * t - A.xyz; float u = dot(q, Wm[0]), v = dot(q, Wm[1]);
    if (u * u + v * v > A.w * A.w) return -1.0;
    if ((mat == 3 || mat == 18) && !fanSolid(vec2(u, v), A.w)) return -1.0;
    n = nn; return t;
  } else if (type == 5) {
    mat3 Wm = primFrame(i); mat3 Lm = transpose(Wm);
    vec3 bo = Lm * (ro - A.xyz), bd = Lm * rd; vec3 inv = 1.0 / bd;
    vec3 t1 = (-Bv.xyz - bo) * inv, t2 = (Bv.xyz - bo) * inv;
    vec3 tn = min(t1, t2), tf = max(t1, t2);
    float tmin = max(max(tn.x, tn.y), tn.z), tmax = min(min(tf.x, tf.y), tf.z);
    if (tmax < max(tmin, 1e-6) || tmin <= 1e-6) return -1.0;
    vec3 nl = vec3(0.0);
    if (tmin == tn.x) nl.x = -sign(bd.x); else if (tmin == tn.y) nl.y = -sign(bd.y); else nl.z = -sign(bd.z);
    n = Wm * nl; return tmin;
  } else if (type == 6) {
    vec3 a = A.xyz, ba = Bv.xyz - a, oc = ro - a; float ra = A.w;
    float baba = dot(ba, ba), bard = dot(ba, rd), baoc = dot(ba, oc);
    float k2 = baba - bard * bard, k1 = baba * dot(oc, rd) - baoc * bard, k0 = baba * dot(oc, oc) - baoc * baoc - ra * ra * baba;
    float h = k1 * k1 - k2 * k0; if (h < 0.0) return -1.0; h = sqrt(h);
    float t = (-k1 - h) / k2; float y = baoc + t * bard;
    if (t > 1e-6 && y > 0.0 && y < baba) { n = (oc + rd * t - ba * y / baba) / ra; return t; }
    t = ((y < 0.0 ? 0.0 : baba) - baoc) / bard;
    if (t > 1e-6 && abs(k1 + k2 * t) < h) { n = ba * sign(y) / sqrt(baba); return t; }
    return -1.0;
  }
  return -1.0;
}

struct Hit { float t; vec3 n; int mat; int flags; float k; vec3 pc; };

Hit trace(vec3 ro, vec3 rd, float tmax, bool rig) {
  Hit h; h.t = -1.0; h.n = vec3(0.0, 1.0, 0.0); h.mat = 0; h.flags = 0; h.k = 0.0; h.pc = vec3(0.0);
  float best = tmax;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    vec4 m = PT(i, 0); int flags = int(m.z + 0.5);
    if (!rig && (flags & 4) != 0) continue;
    vec3 n; int mat = int(m.y + 0.5);
    float t = intersectPrim(i, int(m.x + 0.5), mat, ro, rd, n);
    if (t > 0.0 && t < best) { best = t; h.t = t; h.n = n; h.mat = mat; h.flags = flags; h.k = m.w; h.pc = PT(i, 1).xyz; }
  }
  return h;
}
bool occluded(vec3 ro, vec3 rd, float tmax) {
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    vec4 m = PT(i, 0); int flags = int(m.z + 0.5);
    if ((flags & 1) == 0) continue;
    vec3 n; float t = intersectPrim(i, int(m.x + 0.5), int(m.y + 0.5), ro, rd, n);
    if (t > 0.0 && t < tmax) return true;
  }
  return false;
}

/* ---------------- materials (linear albedo; spec/rough for highlights) ---------------- */
vec3 albedo(int mat, vec3 p, vec3 n, vec3 pc, out float spec, out float rough) {
  vec3 q = p - uAnchor; vec3 l = p - pc;
  spec = 0.04; rough = 0.6;
  if (mat == 0) { float r = 0.5 + 0.5 * sin(q.x * 16.0 + 4.0 * vnoise(q * 2.0) + q.z * 3.0); float g = vnoise(q * 55.0);
    return vec3(0.60, 0.54, 0.42) * (0.86 + 0.14 * r) * (0.90 + 0.18 * g); }
  if (mat == 1 || mat == 19) { float f = fbm(q * 6.0); vec3 base = vec3(0.30, 0.28, 0.26) * (0.70 + 0.60 * f) * (0.85 + 0.3 * vnoise(q * 160.0));
    float m = smoothstep(0.52, 0.60, vnoise(q * 3.5 + 7.0)); vec3 cor = vec3(0.80, 0.42, 0.48) * (0.85 + 0.30 * vnoise(q * 30.0));
    vec3 r = mix(base, cor, m);
    if (mat == 19) r = mix(r, vec3(0.55, 0.50, 0.40) * (0.8 + 0.4 * vnoise(q * 20.0)), smoothstep(0.45, 0.55, vnoise(q * 6.0 + 3.0)));
    return r; }
  if (mat == 2) { vec3 w = q * 190.0; float s = 0.5 + 0.5 * sin(dot(w, vec3(1.0, 0.7, 0.5)) + 6.0 * vnoise(w * 0.06));
    vec3 c = mix(vec3(0.36, 0.30, 0.17), vec3(0.70, 0.62, 0.38), smoothstep(0.25, 0.75, s));
    return c * (0.85 + 0.25 * vnoise(q * 6.0)); }
  if (mat == 3) { return vec3(0.86, 0.36, 0.50) * (0.82 + 0.30 * vnoise(q * 90.0)) + vec3(0.08) * smoothstep(0.7, 0.9, vnoise(q * 400.0)); }
  if (mat == 18) { return vec3(0.55, 0.28, 0.62) * (0.82 + 0.30 * vnoise(q * 90.0)); }
  if (mat == 4) { float o = smoothstep(0.74, 0.80, vnoise(q * 28.0));
    return mix(vec3(0.88, 0.72, 0.16) * (0.85 + 0.30 * vnoise(q * 40.0)), vec3(0.35, 0.25, 0.05), o); }
  if (mat == 5) { spec = 0.05; rough = 0.35;
    vec3 body = vec3(0.86, 0.30, 0.07);
    body = mix(body, vec3(0.55, 0.20, 0.08), 0.5 * smoothstep(0.0, 0.035, l.y));
    body = mix(body, vec3(0.95, 0.62, 0.35), smoothstep(-0.01, -0.035, l.y));
    float stripe = abs(fract((l.y - 0.35 * l.x) * 30.0) - 0.5);
    body = mix(body, vec3(0.10, 0.30, 0.95), smoothstep(0.02, 0.06, l.x) * smoothstep(0.30, 0.40, stripe));
    return body; }
  if (mat == 6) { spec = 0.1; return mix(vec3(0.95, 0.60, 0.22), vec3(0.15, 0.35, 0.95), smoothstep(0.42, 0.48, abs(fract(l.x * 40.0) - 0.5)) * 0.6); }
  if (mat == 7) { spec = 0.06; rough = 0.35; return mix(vec3(0.52, 0.22, 0.72), vec3(0.95), smoothstep(0.0010, 0.0003, abs(l.z))); }
  if (mat == 8) { spec = 0.06; rough = 0.35; float h = clamp(length(p - pc) / 0.0055, 0.0, 1.0);
    vec3 c = mix(vec3(0.55, 0.22, 0.72), vec3(0.98, 0.45, 0.08), smoothstep(0.35, 0.8, h)); return mix(c, vec3(0.96), smoothstep(0.86, 1.0, h)); }
  if (mat == 9) {
    // jewel anemones grow in clonal patches of one colour on encrusted rock
    vec2 P = q.xy * 2.2 + 1.2 * vec2(fbm(vec3(q.xy * 1.7, 2.0)), fbm(vec3(q.xy * 1.7, 8.0)));
    vec2 pc = floor(P); float best = 9.0; vec2 bid = pc;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = pc + vec2(float(i), float(j)); uint hh = h3(ivec3(int(c.x), int(c.y), 31));
      float d = length(P - c - vec2(hf(hh), hf(pcg(hh)))); if (d < best) { best = d; bid = c; } }
    uint ph = h3(ivec3(int(bid.x), int(bid.y), 37)); float psel = hf(ph);
    float present = step(hf(pcg(ph + 3u)), 0.82);
    vec3 pcol = psel < 0.26 ? vec3(0.95, 0.42, 0.68) : (psel < 0.48 ? vec3(0.42, 0.88, 0.48) : (psel < 0.68 ? vec3(0.98, 0.58, 0.20) : (psel < 0.84 ? vec3(0.68, 0.48, 0.95) : vec3(0.90, 0.86, 0.78))));
    vec2 g = q.xy * 42.0; vec2 cid = floor(g); float dmin = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = cid + vec2(float(i), float(j)); uint hh = h3(ivec3(int(c.x), int(c.y), 9));
      vec2 o = 0.5 + 0.7 * (vec2(hf(hh), hf(pcg(hh))) - 0.5);
      float d = length(g - c - o) / (0.30 + 0.16 * hf(pcg(hh + 5u))); dmin = min(dmin, d); }
    float edge = smoothstep(0.38, 0.52, fbm(vec3(q.xy * 3.2, 5.0)) + 0.15 * (0.6 - best));
    float anem = smoothstep(1.0, 0.8, dmin) * present * edge;
    vec3 rock = mix(vec3(0.42, 0.36, 0.32), vec3(0.52, 0.30, 0.30), smoothstep(0.55, 0.7, vnoise(q * 11.0))) * (0.72 + 0.50 * fbm(q * 7.0));
    vec3 col = pcol * (0.78 + 0.30 * vnoise(q * 140.0));
    col = mix(col, vec3(0.97), smoothstep(0.55, 0.9, dmin) * 0.45);
    return mix(rock, col, anem); }
  if (mat == 10) { vec2 f = abs(fract(q.xy * 10.0) - 0.5); float line = step(0.47, max(f.x, f.y));
    vec2 G = abs(fract(q.xy * 2.0) - 0.5); float major = step(0.485, max(G.x, G.y));
    return vec3(0.18) * (1.0 - 0.35 * line - 0.35 * major); }
  if (mat == 11) { spec = 0.2; rough = 0.35; return vec3(0.07, 0.07, 0.08); }
  if (mat == 12) { spec = 0.4; rough = 0.3; return vec3(0.22, 0.24, 0.27); }
  if (mat == 13) { spec = 0.2; rough = 0.4; return vec3(0.10, 0.10, 0.11); }
  if (mat == 15) { spec = 0.8; rough = 0.12; return vec3(0.03); }
  if (mat == 16) { spec = 0.08; rough = 0.4; return vec3(0.85); }
  if (mat == 17) { float d = smoothstep(0.30, 0.20, length(fract(q.xz * 60.0) - 0.5)); return mix(vec3(0.62, 0.56, 0.42), vec3(0.80, 0.74, 0.55), d); }
  if (mat == 20) { spec = 1.0; rough = 0.08; return vec3(0.02, 0.02, 0.03); }
  if (mat == 21) { return vec3(0.45, 0.38, 0.12); }
  return vec3(0.5);
}

/* ---------------- surface relief (bump mapping) ---------------- */
float heightAt(int mat, vec3 q) {
  if (mat == 0) return 0.004 * sin(q.x * 16.0 + 4.0 * vnoise(q * 2.0) + q.z * 3.0) + 0.0012 * vnoise(q * 45.0);
  if (mat == 1 || mat == 19) return 0.016 * fbm(q * 6.0) + 0.003 * vnoise(q * 40.0) + 0.0008 * vnoise(q * 180.0) + 0.0003 * vnoise(q * 520.0);
  if (mat == 2) { vec3 w = q * 190.0; return 0.004 * smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(dot(w, vec3(1.0, 0.7, 0.5)) + 6.0 * vnoise(w * 0.06))); }
  if (mat == 9) return 0.012 * fbm(q * 5.0) + 0.002 * vnoise(q * 60.0);
  if (mat == 4) return -0.004 * smoothstep(0.74, 0.80, vnoise(q * 28.0)) + 0.0015 * vnoise(q * 60.0);
  if (mat == 17) return 0.002 * vnoise(q * 60.0);
  return 0.0;
}
vec3 bump(int mat, vec3 p, vec3 n) {
  if (!(mat == 0 || mat == 1 || mat == 19 || mat == 2 || mat == 9 || mat == 4 || mat == 17)) return n;
  vec3 q = p - uAnchor;
  vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float e = 0.002, h0 = heightAt(mat, q);
  float g1 = (heightAt(mat, q + t1 * e) - h0) / e, g2 = (heightAt(mat, q + t2 * e) - h0) / e;
  return normalize(n - g1 * t1 - g2 * t2);
}

/* ---------------- light: strobe beam, phase function ---------------- */
float beam(int s, vec3 w) {
  vec4 bp = uSBeam[s];
  float ca = dot(w, uSAx[s]);
  if (ca <= cos(bp.w)) return 0.0;
  float th = acos(clamp(ca, -1.0, 1.0));
  float x = dot(w, uSRt[s]), y = dot(w, uSUp[s]), r2 = x * x + y * y;
  float inv2 = r2 > 1e-12 ? (x * x / (bp.x * bp.x) + y * y / (bp.y * bp.y)) / r2 : 1.0 / (bp.x * bp.x);
  float u = th * sqrt(inv2);
  float B = exp(-0.69314718 * pow(u, bp.z));
  float e0 = bp.w - 0.26179939;
  if (th > e0) { float f = (th - e0) / (bp.w - e0); B *= 1.0 - f * f * (3.0 - 2.0 * f); }
  return B;
}
float phaseFn(float cpsi) {
  float psi = acos(clamp(cpsi, -1.0, 1.0));
  float u = sqrt(psi / PI) * 512.0 - 0.5;
  int i0 = int(clamp(floor(u), 0.0, 511.0)); int i1 = min(i0 + 1, 511); float f = clamp(u - float(i0), 0.0, 1.0);
  float a = texelFetch(uPhase, ivec2(i0, 0), 0).r, b = texelFetch(uPhase, ivec2(i1, 0), 0).r;
  return pow(10.0, mix(a, b, f));
}
float softVis(int s, vec3 p, vec3 n, float jit) {
  float vis = 0.0; float ns = float(uSoft);
  for (int k = 0; k < 16; k++) {
    if (k >= uSoft) break;
    float r = sqrt((float(k) + 0.5) / ns) * uSRad[s];
    float a = float(k) * 2.39996323 + jit * 6.2831853;
    vec3 q = uSPos[s] + uSRt[s] * (r * cos(a)) + uSUp[s] * (r * sin(a));
    vec3 dv = q - p; float L = length(dv);
    if (!occluded(p + n * 4e-4, dv / L, L - 1e-3)) vis += 1.0;
  }
  return vis / ns;
}
vec3 strobeLight(vec3 p, vec3 n, vec3 V, vec3 alb, float spec, float rough, vec3 c, float jit) {
  vec3 L = vec3(0.0);
  for (int s = 0; s < 2; s++) {
    if (s >= uNS) break;
    vec3 w = p - uSPos[s]; float D2 = max(dot(w, w), uSRad[s] * uSRad[s]); float D = sqrt(D2); w /= D;
    float B = beam(s, w); if (B <= 0.0) continue;
    float ndl = dot(n, -w); if (ndl <= 0.0) continue;
    float vis = softVis(s, p, n, jit); if (vis <= 0.0) continue;
    vec3 E = uSI[s] * (B / D2) * exp(-c * D);
    float m = 2.0 / max(rough * rough, 1e-3) - 2.0;
    float sz = uSRad[s] / D; m = 1.0 / (1.0 / max(m, 1.0) + 2.0 * sz * sz);
    vec3 H = normalize(-w + V);
    float spc = spec * (m + 8.0) / (8.0 * PI) * pow(max(dot(n, H), 0.0), m);
    L += E * vis * ndl * (alb / PI + vec3(spc));
  }
  return L;
}

/* ---------------- daylight (approximate) ---------------- */
vec3 ambientAt(vec3 p, vec3 n) {
  float k = 0.70 * max(n.y, 0.0) + 0.30 * (0.5 + 0.5 * n.y);
  if (n.y > -0.3 && occluded(p + n * 3e-4, vec3(0.0, 1.0, 0.0), 4.0)) k *= 0.30;
  return uEd * k * exp(uKd * p.y);
}
vec3 background(vec3 rd) { return uLinf * exp(1.6 * clamp(rd.y, -1.0, 1.0)); }

/* ---------------- camera rays ---------------- */
bool getRay(vec2 pix, out vec3 o, out vec3 d) {
  if (uView == 1) { d = uObsRot * normalize(vec3(pix, uObsFpx)); o = uObsPos; return true; }
  vec3 dl, ol;
  if (uProj == 0) {
    vec3 da = normalize(vec3(pix, uFpx));
    ol = da * (uPupil / da.z);
    vec2 sw = da.xy / uNw;
    dl = vec3(sw, sqrt(max(0.0, 1.0 - dot(sw, sw))));
  } else if (uProj == 2) {
    float r = length(pix) / uFpx;
    if (r >= 2.0) return false;
    float th = 2.0 * asin(r * 0.5);
    vec2 dir2 = r > 1e-9 ? pix / length(pix) : vec2(0.0);
    dl = vec3(dir2 * sin(th), cos(th)); ol = dl * uPupil;
  } else {
    dl = normalize(vec3(pix, uFpx)); ol = dl * uPupil;
  }
  ol.z -= uPupil;
  d = uCamRot * dl; o = uCamRot * ol;
  return true;
}

/* ---------------- defocus of particles ---------------- */
float domeImage(float O) {
  float R = uDomeR, t = 0.008, ng = 1.49, nw = uNw, Ri = R - t;
  float so1 = O - R; float inv1 = (ng - nw) / R - nw / so1; float si1 = ng / inv1;
  float so2 = -(si1 - t); float inv2 = (1.0 - ng) / Ri - ng / so2;
  return -1.0 / inv2 + Ri;
}
float appDist(float s) {
  if (uView == 1) return s;
  if (uProj == 0) return uPupil + s / uNw;
  return domeImage(uDomeR + s);
}
float blurPx(float s) { return max(0.6, 0.5 * uDep * abs(1.0 / max(appDist(s), 1e-3) - uFocusInv) * uFpxAir); }

/* ---------------- single-scattering backscatter along the ray ---------------- */
vec3 volume(vec3 ro, vec3 rd, float tEnd, vec3 c, float jit) {
  vec3 sum = vec3(0.0);
  float T = min(tEnd, uRmax); float fN = float(uSteps);
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps) break;
    float u0 = float(i) / fN, u1 = float(i + 1) / fN, u = (float(i) + jit) / fN;
    float t = T * pow(u, uWarp); float dt = T * (pow(u1, uWarp) - pow(u0, uWarp));
    vec3 x = ro + rd * t;
    vec3 acc = vec3(0.0);
    for (int s = 0; s < 2; s++) {
      if (s >= uNS) break;
      vec3 w = x - uSPos[s]; float D2 = max(dot(w, w), uSRad[s] * uSRad[s]); float D = sqrt(D2); w /= D;
      float B = beam(s, w); if (B <= 1e-5) continue;
      if (uVolShadow == 1 && occluded(x, -w, D - 1e-3)) continue;
      float ph = uPhaseConst > 0.0 ? uPhaseConst : phaseFn(dot(w, -rd));
      acc += uSI[s] * (B * ph / D2) * exp(-c * D);
    }
    sum += acc * exp(-c * t) * dt;
  }
  return uB * uBoost * sum;
}

/* ---------------- backscatter specks (procedural particles) ---------------- */
vec3 particles(vec2 pix, float tHit, float omegaPix, vec3 c) {
  vec3 sum = vec3(0.0);
  if (uRho <= 0.0 || uSlices <= 0) return sum;
  float sMin = 0.01, sMax = uPartMax;
  for (int k = 0; k < 24; k++) {
    if (k >= uSlices) break;
    float s0 = sMin * pow(sMax / sMin, float(k) / float(uSlices));
    float s1 = sMin * pow(sMax / sMin, float(k + 1) / float(uSlices));
    if (s0 > tHit) break;
    float rb = max(blurPx(s0), blurPx(s1));
    float vol3 = (s1 * s1 * s1 - s0 * s0 * s0) / 3.0;
    float csDen = inversesqrt(max(uRho * omegaPix * vol3, 1e-12));
    float cs = max(max(2.0 * rb + 2.0, csDen), 3.0);
    float Nc = uRho * cs * cs * omegaPix * vol3;
    int M = int(clamp(ceil(Nc * 1.25), 1.0, 3.0));
    float prob = min(1.0, Nc / float(M));
    uint ks = pcg(uint(k) * 977u + uSeed);
    vec2 off = vec2(hf(ks), hf(pcg(ks))) * cs;
    vec2 cell = floor((pix + off) / cs);
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        ivec2 ci = ivec2(cell) + ivec2(dx, dy);
        for (int j = 0; j < 3; j++) {
          if (j >= M) break;
          uint h = pcg(uint(ci.x) * 73856093u ^ pcg(uint(ci.y) * 19349663u ^ (uint(k * 8 + j) * 83492791u + uSeed)));
          if (hf(h) > prob) continue;
          uint h2 = pcg(h), h3v = pcg(h2), h4 = pcg(h3v), h5 = pcg(h4);
          vec2 pp = (vec2(ci) + vec2(hf(h2), hf(h3v))) * cs - off;
          float s = pow(mix(s0 * s0 * s0, s1 * s1 * s1, hf(h4)), 1.0 / 3.0);
          if (s > tHit) continue;
          float r = blurPx(s);
          float dist = length(pix - pp);
          if (dist > r + 0.5) continue;
          float cov = clamp(r + 0.5 - dist, 0.0, 1.0);
          vec3 po, pd; if (!getRay(pp, po, pd)) continue;
          vec3 x = po + pd * s;
          float ua = hf(h5);
          float a = inversesqrt(1.6e7 - ua * (1.6e7 - 1.6e5));   // radius 0.25–2.5 mm, n(a) ∝ a^-3
          vec3 J = vec3(0.0);
          for (int si = 0; si < 2; si++) {
            if (si >= uNS) break;
            vec3 w = x - uSPos[si]; float D2 = max(dot(w, w), 1e-4); float D = sqrt(D2); w /= D;
            float B = beam(si, w); if (B <= 0.0) continue;
            J += uSI[si] * (B * phaseFn(dot(w, -pd)) / D2) * exp(-c * D);
          }
          J *= 0.6 * PI * a * a;   // weak backscatter of porous aggregates (see strobe-physics.js)
          float sp = s + uPupil;
          float omegaDisk = PI * r * r * omegaPix;
          sum += J * exp(-c * s) / (sp * sp * omegaDisk) * cov;
        }
      }
    }
  }
  return sum;
}

/* ---------------- output ---------------- */
vec3 evColor(float ev) {
  if (ev < -3.0) return vec3(0.05, 0.05, 0.35);
  if (ev < -2.0) return vec3(0.10, 0.25, 0.85);
  if (ev < -1.0) return vec3(0.15, 0.65, 0.95);
  if (ev < -0.33) return vec3(0.35, 0.75, 0.45);
  if (ev < 0.33) return vec3(0.55, 0.55, 0.55);
  if (ev < 1.0) return vec3(0.95, 0.85, 0.25);
  if (ev < 2.0) return vec3(0.98, 0.55, 0.15);
  if (ev < 3.0) return vec3(0.90, 0.15, 0.15);
  return vec3(0.95, 0.30, 0.90);
}
vec3 toSRGB(vec3 x) { return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x)); }

void main() {
  vec2 pix = gl_FragCoord.xy - 0.5 * uRes;
  vec3 ro, rd;
  if (!getRay(pix, ro, rd)) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  uint seed = pcg(uint(gl_FragCoord.x) * 1973u + pcg(uint(gl_FragCoord.y) * 9277u + uSeed));
  float jit = hf(seed);
  bool water = uMode != 2;
  vec3 c = water ? uC : vec3(0.0);
  Hit h = trace(ro, rd, 1e5, uView == 1);
  vec3 Ls = vec3(0.0), La = vec3(0.0), Lbs = vec3(0.0), Lp = vec3(0.0), Le = vec3(0.0);
  float tEnd = h.t > 0.0 ? h.t : 1e5;
  if (h.t > 0.0) {
    vec3 p = ro + rd * h.t; vec3 n = h.n; if (dot(n, rd) > 0.0) n = -n;
    if (h.mat == 14) {
      int s = int(h.k + 0.5);
      if (s < uNS) { vec3 w = normalize(ro - uSPos[s]); Le = uSI[s] * beam(s, w) / (PI * uSRad[s] * uSRad[s]) * exp(-c * h.t); }
    } else {
      float spec, rough; vec3 alb = albedo(h.mat, p, n, h.pc, spec, rough);
      vec3 nb = bump(h.mat, p, n);
      if (dot(nb, -rd) < 0.02) nb = n;
      Ls = strobeLight(p, nb, -rd, alb, spec, rough, c, jit) * exp(-c * h.t);
      if (water) { vec3 att = exp(-c * h.t); La = alb / PI * ambientAt(p, nb) * att + background(rd) * (1.0 - att); }
    }
  } else if (water) {
    La = background(rd);
  }
  if (water) {
    Lbs = volume(ro, rd, tEnd, c, jit);
    vec3 o1, d1, o2, d2; getRay(pix + vec2(1.0, 0.0), o1, d1); getRay(pix + vec2(0.0, 1.0), o2, d2);
    float omegaPix = max(length(cross(d1 - rd, d2 - rd)), 1e-12);
    Lp = particles(pix, tEnd, omegaPix, c);
  }
  vec3 v;
  if (uMode == 1) v = uKexp * (Lbs + Lp);
  else if (uMode == 4 || uMode == 2) v = uKexp * (Ls + Lbs + Lp + Le);
  else v = uKexp * (Ls + Lbs + Lp + Le + uShutter * uAmb * La);
  if (uMode == 3) {
    float Y = dot(v, vec3(0.2126, 0.7152, 0.0722));
    vec3 base = evColor(log2(max(Y, 1e-6) / 0.18));
    float gl = pow(clamp(Y / (Y + 0.6), 0.0, 1.0), 0.6);
    fragColor = vec4(mix(base, vec3(gl), 0.18), 1.0); return;
  }
  vec3 x = max(v, vec3(0.0)) * 0.8;
  vec3 y = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  y += (hf(pcg(seed)) - 0.5) / 255.0;
  fragColor = vec4(toSRGB(clamp(y, 0.0, 1.0)), 1.0);
}
`;

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }

  function StrobeRenderer(canvas) {
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl; this.canvas = canvas;
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    this.loc = {};
    var nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < nu; i++) {
      var info = gl.getActiveUniform(prog, i), name = info.name.replace(/\[0\]$/, '');
      this.loc[name] = gl.getUniformLocation(prog, info.name);
    }
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // textures
    this.primTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.primTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.primData = new Float32Array(6 * MAXP * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 6, MAXP, 0, gl.RGBA, gl.FLOAT, this.primData);
    this.phaseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.phaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, Sim.PHASE_LUT_N, 1, 0, gl.RED, gl.FLOAT, Sim.PHASE_LUT);
  }

  StrobeRenderer.prototype.packPrims = function (prims) {
    var d = this.primData; d.fill(0);
    var n = Math.min(prims.length, MAXP);
    for (var i = 0; i < n; i++) {
      var p = prims[i], o = i * 24;
      d[o] = p.t; d[o + 1] = p.m; d[o + 2] = p.f; d[o + 3] = p.k || 0;
      d[o + 4] = p.c[0]; d[o + 5] = p.c[1]; d[o + 6] = p.c[2]; d[o + 7] = p.r || 0;
      d[o + 8] = p.v[0]; d[o + 9] = p.v[1]; d[o + 10] = p.v[2]; d[o + 11] = p.w || 0;
      for (var r = 0; r < 3; r++) { d[o + 12 + r * 4] = p.R[r][0]; d[o + 13 + r * 4] = p.R[r][1]; d[o + 14 + r * 4] = p.R[r][2]; }
    }
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.primTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 6, MAXP, gl.RGBA, gl.FLOAT, d);
    return n;
  };

  var QUALITY = {
    draft: { steps: 14, soft: 3, slices: 8, vol: 0 },
    high: { steps: 40, soft: 8, slices: 16, vol: 1 }
  };
  var MODES = { photo: 0, backscatter: 1, air: 2, exposure: 3, strobe: 4 };

  /**
   * Render a world (from StrobeSim.buildWorld, built for this canvas width).
   * opts: { view: 'camera'|'observer', mode, quality, observer: { pos, rot (rows: right, up, forward), fpx, target }, boost, seed }
   */
  StrobeRenderer.prototype.render = function (world, opts) {
    opts = opts || {};
    var gl = this.gl, L = this.loc, canvas = this.canvas, q = QUALITY[opts.quality || 'high'];
    var W = canvas.width, H = canvas.height, cam = world.cam;
    var observer = opts.view === 'observer';
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    var prims = world.prims.slice();
    var nScene = prims.length;
    if (observer) prims = prims.concat(Sim.rigPrimitives(world));
    var np = this.packPrims(prims);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.primTex); gl.uniform1i(L.uPrims, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.phaseTex); gl.uniform1i(L.uPhase, 1);
    gl.uniform2f(L.uRes, W, H);
    gl.uniform1i(L.uView, observer ? 1 : 0);
    gl.uniform1i(L.uMode, MODES[opts.mode] != null ? MODES[opts.mode] : 0);
    var proj = { flat: 0, dome: 1, water: 1, fisheye: 2 }[cam.proj];
    gl.uniform1i(L.uProj, proj);
    gl.uniform1f(L.uFpx, cam.fpx);
    gl.uniform1f(L.uNw, world.n);
    gl.uniform1f(L.uPupil, cam.pupil);
    var t = world.tilt * Sim.DEG, ct = Math.cos(t), st = Math.sin(t);
    // rig -> world (columns): right (1,0,0), up (0, cos t, -sin t), forward (0, sin t, cos t)
    gl.uniformMatrix3fv(L.uCamRot, false, new Float32Array([1, 0, 0, 0, ct, -st, 0, st, ct]));
    var ob = opts.observer;
    if (observer && ob) {
      gl.uniform3fv(L.uObsPos, new Float32Array(ob.pos));
      gl.uniformMatrix3fv(L.uObsRot, false, new Float32Array([].concat(ob.rot[0], ob.rot[1], ob.rot[2])));
      gl.uniform1f(L.uObsFpx, ob.fpx);
    }
    gl.uniform3fv(L.uB, new Float32Array(world.water.b));
    gl.uniform3fv(L.uC, new Float32Array(world.water.c));
    // strobes
    var ns = Math.min(2, world.strobes.length);
    var pos = new Float32Array(6), ax = new Float32Array(6), rt = new Float32Array(6), up = new Float32Array(6), I = new Float32Array(6), bm = new Float32Array(8), rad = new Float32Array(2);
    for (var i = 0; i < ns; i++) {
      var s = world.strobes[i];
      pos.set(s.pos, i * 3); ax.set(s.ax, i * 3); rt.set(s.rt, i * 3); up.set(s.up, i * 3); I.set(s.I, i * 3);
      bm.set([s.thx, s.thy, s.p, s.cut], i * 4); rad[i] = s.faceR;
    }
    gl.uniform1i(L.uNS, ns);
    gl.uniform3fv(L.uSPos, pos); gl.uniform3fv(L.uSAx, ax); gl.uniform3fv(L.uSRt, rt); gl.uniform3fv(L.uSUp, up);
    gl.uniform3fv(L.uSI, I); gl.uniform4fv(L.uSBeam, bm); gl.uniform1fv(L.uSRad, rad);
    // daylight and exposure
    gl.uniform3fv(L.uEd, new Float32Array(world.amb.Ed));
    gl.uniform3fv(L.uKd, new Float32Array(world.amb.Kd));
    gl.uniform3fv(L.uLinf, new Float32Array(world.amb.Linf));
    gl.uniform1f(L.uShutter, world.shutter);
    gl.uniform1f(L.uAmb, 1.0);
    gl.uniform1f(L.uKexp, world.kexp * Math.pow(2, opts.evShift || 0));
    // scene
    gl.uniform1i(L.uNP, observer ? np : Math.min(nScene, np));
    gl.uniform3fv(L.uAnchor, new Float32Array(world.anchor));
    // particles and defocus
    gl.uniform1f(L.uRho, opts.noParticles ? 0 : world.rho);
    if (observer) {
      gl.uniform1f(L.uDep, 0.004);
      gl.uniform1f(L.uFocusInv, 1 / Math.max(0.3, ob ? ob.focus : 2));
      gl.uniform1f(L.uFpxAir, ob ? ob.fpx : 800);
      gl.uniform1f(L.uPartMax, 6.0);
    } else {
      gl.uniform1f(L.uDep, world.Dep);
      gl.uniform1f(L.uFocusInv, 1 / world.focusApp);
      gl.uniform1f(L.uFpxAir, cam.fpxAir);
      gl.uniform1f(L.uPartMax, Math.min(4, world.Z * 1.5 + 0.5));
    }
    gl.uniform1f(L.uDomeR, cam.domeR);
    gl.uniform1i(L.uSlices, q.slices);
    gl.uniform1i(L.uSteps, observer ? Math.round(q.steps * 1.5) : q.steps);
    gl.uniform1i(L.uSoft, q.soft);
    gl.uniform1i(L.uVolShadow, opts.volShadows === false ? 0 : q.vol);
    gl.uniform1f(L.uWarp, observer ? 1.0 : 2.0);
    gl.uniform1f(L.uRmax, observer ? Math.min(10, world.rmax + 3) : world.rmax);
    gl.uniform1ui(L.uSeed, (opts.seed || 7) >>> 0);
    var boost = observer ? (opts.boost || 1) : 1;
    // teaching mode: side-scatter level of the phase function (≈ value at 110°) applied in every direction, times the boost
    gl.uniform1f(L.uPhaseConst, observer && boost > 1 ? 0.0028 * boost : 0.0);
    gl.uniform1f(L.uBoost, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  StrobeRenderer.MAXP = MAXP;
  root.StrobeRenderer = StrobeRenderer;
})(typeof self !== 'undefined' ? self : this);
