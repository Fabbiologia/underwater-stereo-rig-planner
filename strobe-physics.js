/*
 * strobe-physics.js — physics, equipment data, scenes and a CPU reference
 * renderer for the Strobe Lighting Lab (strobes.html).
 *
 * The GPU renderer (strobe-render.js) implements the same model per pixel in
 * GLSL; this file is the readable, testable reference and computes the
 * numbers shown in the results panel.
 *
 * Frames
 *   Rig frame:   origin at the centre of the port glass (front of the dome),
 *                x right, y up, z forward along the lens axis. Strobes, arms
 *                and the housing are positioned in this frame.
 *   World frame: same origin; y is true up. The rig can be tilted (pitch) by
 *                `tilt` degrees; positive looks up.
 *
 * Units: metres, radians internally (degrees in the public state), lux,
 * candela-seconds (strobe), cd·s/m² (luminance-time). Colour is handled as
 * three channels: red ≈ 600 nm, green ≈ 540 nm, blue ≈ 465 nm.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StrobeSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180, RAD = 180 / Math.PI, LN2 = Math.LN2, PI = Math.PI;

  /* ------------------------------------------------------------------ */
  /* Small vector helpers                                                */
  /* ------------------------------------------------------------------ */
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function mulv(a, b) { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function expAtt(c, d) { return [Math.exp(-c[0] * d), Math.exp(-c[1] * d), Math.exp(-c[2] * d)]; }
  function lum(v) { return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  /** Rotation matrix rows (local axes in world) helpers: apply R (world->local) and R^T (local->world). */
  function toLocal(R, v) { return [dot(R[0], v), dot(R[1], v), dot(R[2], v)]; }
  function toWorld(R, v) { return [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]]; }
  /** Frame whose third row is `n` and second row is as close as possible to `upHint`. */
  function frameFromNormal(n, upHint) {
    n = norm(n);
    var up = upHint || [0, 1, 0];
    if (Math.abs(dot(up, n)) > 0.98) up = [0, 0, 1];
    var u = norm(cross(up, n)), v2 = cross(n, u);
    return [u, v2, n];
  }
  function frameYawPitchRoll(yaw, pitch, roll) {
    // local x (length axis), y (up), z (side); yaw about world y, then pitch about local z, then roll about local x
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    var x = [cy * cp, sp, -sy * cp];
    var y0 = [-cy * sp, cp, sy * sp];
    var z0 = cross(x, y0);
    var y = add(mul(y0, cr), mul(z0, sr)), z = add(mul(z0, cr), mul(y0, -sr));
    return [x, y, z];
  }

  /* ------------------------------------------------------------------ */
  /* Hash and value noise, bit-identical to the GLSL versions             */
  /* ------------------------------------------------------------------ */
  function pcg(v) {
    var state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
    var word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
  }
  function h3(ix, iy, iz) { return pcg(((ix >>> 0) + pcg(((iy >>> 0) + pcg(iz >>> 0)) >>> 0)) >>> 0); }
  function hf(h) { return h / 4294967296; }
  function vnoise(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    function g(a, b, c) { return hf(h3(ix + a, iy + b, iz + c)); }
    var x00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * ux, x10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * ux;
    var x01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * ux, x11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * ux;
    var y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
  }

  /* ------------------------------------------------------------------ */
  /* Water                                                               */
  /* ------------------------------------------------------------------ */

  /** Quan & Fry (1995) refractive index of seawater; S in PSU, T in °C, lambda in nm. */
  function refractiveIndex(S, T, lambda) {
    return 1.31405 + (1.779e-4 - 1.05e-6 * T + 1.6e-8 * T * T) * S - 2.02e-6 * T * T +
      (15.868 + 0.01155 * S - 0.00423 * T) / lambda - 4382 / (lambda * lambda) + 1.1455e6 / (lambda * lambda * lambda);
  }

  /**
   * Water presets. a = absorption (1/m) for the red, green and blue channels
   * (pure water after Pope & Fry 1997 weighted over broad camera bands, plus
   * phytoplankton and CDOM); b = particle scattering at 540 nm (1/m);
   * specks = suspended aggregates larger than 0.5 mm per litre (marine snow; coastal
   * waters 1–60 per litre, open ocean 0.1–1; Simon et al. 2002).
   */
  var WATER = [
    { id: 'tropical', name: 'Clear tropical reef', a: [0.32, 0.065, 0.022], b: 0.08, specks: 0.2, S: 35, T: 27,
      note: 'Jerlov oceanic type I–II; 25–35 m horizontal visibility.' },
    { id: 'shelf', name: 'Temperate shelf, good day', a: [0.36, 0.09, 0.10], b: 0.30, specks: 1, S: 35, T: 15,
      note: 'Offshore western Channel in summer; 10–15 m visibility.' },
    { id: 'plymouth', name: 'Plymouth Sound, typical', a: [0.42, 0.14, 0.22], b: 0.82, specks: 5, S: 34, T: 14,
      note: 'Green coastal water; 3–6 m visibility.' },
    { id: 'turbid', name: 'Turbid estuary or harbour', a: [0.65, 0.38, 0.65], b: 2.8, specks: 20, S: 30, T: 14,
      note: 'After rain or in a harbour; about 1–2 m visibility.' }
  ];
  var B_SPECTRAL = [0.96, 1.0, 1.08];     // particle scattering ∝ λ^-0.5 across the three bands
  var BB_RATIO = 0.0183;                  // Petzold average particle backscattering ratio
  var VIS_K = 4.8;                        // horizontal black-target visibility ≈ 4.8 / c (Zaneveld & Pegau 2003)

  function findById(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }

  /** Build the optical properties of the water. opts: { visibility (m), specks (per L), S, T } */
  function makeWater(presetId, opts) {
    opts = opts || {};
    var p = findById(WATER, presetId);
    var a = p.a.slice();
    var bG = p.b;
    if (opts.visibility) bG = Math.max(0.004, VIS_K / opts.visibility - a[1]);
    var b = [bG * B_SPECTRAL[0], bG, bG * B_SPECTRAL[2]];
    var c = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    var S = opts.S != null ? opts.S : p.S, T = opts.T != null ? opts.T : p.T;
    // diffuse attenuation of downwelling light, Kirk (1984): Kd = sqrt(a^2 + G a b) / mu0
    var Kd = [0, 1, 2].map(function (i) { return Math.sqrt(a[i] * a[i] + 0.264 * a[i] * b[i]) / 0.85; });
    return {
      id: p.id, name: p.name, a: a, b: b, c: c, Kd: Kd,
      n: refractiveIndex(S, T, 550), S: S, T: T,
      visibility: VIS_K / c[1],
      specks: opts.specks != null ? opts.specks : p.specks,
      omega: [b[0] / c[0], b[1] / c[1], b[2] / c[2]]
    };
  }

  /* ------------------------------------------------------------------ */
  /* Volume scattering: Fournier–Forand phase function                    */
  /* ------------------------------------------------------------------ */
  var FF_N = 1.10, FF_MU = 3.5835;        // gives b_b/b = 0.0183 (Mobley, Ocean Optics Web Book)

  function ffRaw(psi, n, mu) {
    var nu = (3 - mu) / 2, k = 4 / (3 * (n - 1) * (n - 1));
    var s2 = Math.sin(psi / 2); s2 *= s2;
    var d = k * s2, d180 = k;
    var dnu = Math.pow(d, nu);
    var t1 = (nu * (1 - d) - (1 - dnu) + (d * (1 - dnu) - nu * (1 - d)) / s2) / (4 * PI * (1 - d) * (1 - d) * dnu);
    var t2 = (1 - Math.pow(d180, nu)) / (16 * PI * (d180 - 1) * Math.pow(d180, nu)) * (3 * Math.cos(psi) * Math.cos(psi) - 1);
    return t1 + t2;
  }
  /** Normalised FF phase function (1/sr). The removable singularity at δ = 1 is bridged by interpolation. */
  function ffPhase(psi, n, mu) {
    n = n || FF_N; mu = mu || FF_MU;
    psi = Math.max(psi, 0.05 * DEG);
    var k = 4 / (3 * (n - 1) * (n - 1));
    var d = k * Math.pow(Math.sin(psi / 2), 2);
    if (Math.abs(1 - d) < 2e-3) {
      var pA = 2 * Math.asin(Math.sqrt((1 - 2e-3) / k)), pB = 2 * Math.asin(Math.sqrt((1 + 2e-3) / k));
      var fA = ffRaw(pA, n, mu), fB = ffRaw(pB, n, mu);
      return fA + (fB - fA) * (psi - pA) / (pB - pA);
    }
    return ffRaw(psi, n, mu);
  }
  function ffBackFraction(n, mu) {
    var nu = (3 - mu) / 2, d90 = 4 / (3 * (n - 1) * (n - 1)) * 0.5;
    return 1 - (1 - Math.pow(d90, nu + 1) - 0.5 * (1 - Math.pow(d90, nu))) / ((1 - d90) * Math.pow(d90, nu));
  }
  /** Lookup table: index u in [0,1] maps to psi = pi * u^2 (dense near the forward peak). Values are log10 p. */
  var PHASE_LUT_N = 512;
  var PHASE_LUT = (function () {
    var t = new Float32Array(PHASE_LUT_N);
    for (var i = 0; i < PHASE_LUT_N; i++) {
      var u = (i + 0.5) / PHASE_LUT_N;
      t[i] = Math.log(ffPhase(PI * u * u)) / Math.LN10;
    }
    return t;
  })();
  function phaseFast(cosPsi) {
    var psi = Math.acos(clamp(cosPsi, -1, 1));
    var u = Math.sqrt(psi / PI) * PHASE_LUT_N - 0.5;
    var i = Math.floor(u), f = u - i;
    var a = PHASE_LUT[clamp(i, 0, PHASE_LUT_N - 1)], b = PHASE_LUT[clamp(i + 1, 0, PHASE_LUT_N - 1)];
    return Math.pow(10, a + (b - a) * f);
  }

  /* ------------------------------------------------------------------ */
  /* Strobes                                                              */
  /* ------------------------------------------------------------------ */
  /*
   * Beam model: relative intensity B(θ, φ) = exp(−ln2 · (θ/θh(φ))^p), with θh
   * the half beam angle (−1 EV point) on an ellipse between the horizontal and
   * vertical values, and a smooth cut-off reaching zero at `cut` degrees from
   * the axis. p ≈ 2 for diffused heads, ≈ 2.6 for bare reflectors.
   * gn: guide number in air (ISO 100, metres) at full power. minEV: lowest
   * manual power step. faceR: radius of the light-emitting window (sets shadow
   * softness; not published by INON, estimated from the head size).
   * Sources: INON Z-330 and S-2000 specification pages and manuals.
   */
  var STROBES = [
    { id: 'z330', name: 'INON Z-330', gn: 33, beamH: 110, beamV: 110, p: 2.0, cut: 100, kelvin: 5500, minEV: -6,
      faceR: 0.036, bodyD: 0.102, bodyL: 0.125, note: '110° × 110° circular beam under water (nominal); GN 33 in air at full power; 13 manual steps of ½ EV down to −6 EV (GN 4.1).' },
    { id: 's2000', name: 'INON S-2000, bare', gn: 20, beamH: 105, beamV: 95, p: 2.6, cut: 92, kelvin: 5500, minEV: -5.5,
      faceR: 0.022, bodyD: 0.064, bodyL: 0.090, note: '105° × 95° beam without diffuser; GN 20; 12 manual steps of ½ EV down to −5.5 EV (GN 3.0).' },
    { id: 's2000d', name: 'INON S-2000 + −0.5 white diffuser', gn: 17, beamH: 110, beamV: 110, p: 2.0, cut: 98, kelvin: 5400, minEV: -5.5,
      faceR: 0.026, bodyD: 0.064, bodyL: 0.095, note: '110° × 110° circular beam with the supplied −0.5 white diffuser; GN 17 (−0.5 EV); 5400 K.' }
  ];

  /** Luminous intensity-time on the beam axis (cd·s) for a guide number in metres at ISO 100. */
  function intensityFromGN(gn) { return 10 * PI * gn * gn / (0.18 * 0.65 * 100); }

  /** Approximate relative RGB of a blackbody, normalised to 5500 K = white and unit luminance. */
  function kelvinRGB(K) {
    function th(k) {
      var t = k / 100, r, g, b;
      if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
      else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
      return [r, g, b].map(function (x) { return Math.pow(clamp(x, 0, 255) / 255, 2.2); });
    }
    var a = th(K), w = th(5500), v = [a[0] / w[0], a[1] / w[1], a[2] / w[2]], L = lum(v);
    return [v[0] / L, v[1] / L, v[2] / L];
  }

  /** Strobe local frame (rig coordinates) from yaw (+ toward +x) and pitch (+ up), degrees. */
  function strobeAxis(yawDeg, pitchDeg) {
    var y = yawDeg * DEG, p = pitchDeg * DEG;
    return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  }
  function strobeFrame(ax) {
    var rt = cross([0, 1, 0], ax);
    if (len(rt) < 1e-6) rt = [1, 0, 0];
    rt = norm(rt);
    var up = cross(ax, rt);
    return { ax: ax, rt: rt, up: up };
  }
  /** Relative intensity of strobe `s` (world-space beam) in unit direction w (from strobe outward). */
  function beam(s, w) {
    var ca = dot(w, s.ax);
    if (ca <= Math.cos(s.cut)) return 0;
    var th = Math.acos(clamp(ca, -1, 1));
    var x = dot(w, s.rt), y = dot(w, s.up), r2 = x * x + y * y;
    var inv2 = r2 > 1e-12 ? (x * x / (s.thx * s.thx) + y * y / (s.thy * s.thy)) / r2 : 1 / (s.thx * s.thx);
    var u = th * Math.sqrt(inv2);
    var B = Math.exp(-LN2 * Math.pow(u, s.p));
    var e0 = s.cut - 15 * DEG;
    if (th > e0) { var f = (th - e0) / (s.cut - e0); B *= 1 - f * f * (3 - 2 * f); }
    return B;
  }
  /** Angle from the axis at which the relative intensity falls to `level` (on the horizontal meridian). */
  function beamAngleAt(model, level) {
    var thx = model.beamH / 2 * DEG;
    return thx * Math.pow(Math.log(1 / level) / LN2, 1 / model.p) * RAD;
  }

  /* ------------------------------------------------------------------ */
  /* Cameras, lenses, ports and kits                                       */
  /* ------------------------------------------------------------------ */
  /*
   * proj: 'flat'    rectilinear lens behind a flat port (refraction at the glass)
   *       'dome'    rectilinear lens behind a dome centred on the entrance pupil
   *       'fisheye' equisolid fisheye behind a dome
   *       'water'   wet wide-angle lens: rectilinear mapping with a given field under water
   * pupil: distance from the entrance pupil to the port surface (m). For domes it is the dome radius.
   */
  var LENSES = [
    { id: 'g9x-w', name: 'Canon G9 X Mark II in housing · 10.2 mm (28 mm equiv.) · flat port', f: 10.2, sensor: [13.2, 8.8], proj: 'flat',
      pupil: 0.025, Nmin: 2.0, Nmax: 11, Ndef: 5.6 },
    { id: 'g9x-t', name: 'Canon G9 X Mark II in housing · 30.6 mm (84 mm equiv.) · flat port', f: 30.6, sensor: [13.2, 8.8], proj: 'flat',
      pupil: 0.035, Nmin: 4.9, Nmax: 11, Ndef: 8 },
    { id: 'g9x-wwl', name: 'Canon G9 X Mark II + INON UWL-H100 wet lens (100° diagonal)', f: 10.2, sensor: [13.2, 8.8], proj: 'water',
      hfovW: 90, pupil: 0.06, domeR: 0.06, Nmin: 2.0, Nmax: 11, Ndef: 5.6 },
    { id: 'ff16', name: 'Full frame · 16 mm rectilinear · 8-inch dome', f: 16, sensor: [36, 24], proj: 'dome',
      pupil: 0.10, domeR: 0.10, Nmin: 2.8, Nmax: 22, Ndef: 8 },
    { id: 'ff15fe', name: 'Full frame · 15 mm fisheye · 4.33-inch dome', f: 15, sensor: [36, 24], proj: 'fisheye',
      pupil: 0.055, domeR: 0.055, Nmin: 2.8, Nmax: 22, Ndef: 8 },
    { id: 'ff60', name: 'Full frame · 60 mm macro · flat port', f: 60, sensor: [36, 24], proj: 'flat',
      pupil: 0.07, Nmin: 2.8, Nmax: 32, Ndef: 11 },
    { id: 'ff100', name: 'Full frame · 100 mm macro · flat port', f: 100, sensor: [36, 24], proj: 'flat',
      pupil: 0.09, Nmin: 2.8, Nmax: 32, Ndef: 16 }
  ];

  /*
   * Kits: housing and tray geometry (rig frame) plus default equipment.
   * housing: width, height, depth, back offset of its front face from the port glass.
   * tray: handle x (±), handle z, top of the handle (arm base) y.
   */
  var KITS = [
    { id: 'compact', name: 'MRes compact kit: Canon G9 X Mark II + 1 × INON S-2000', lens: 'g9x-w',
      housing: { w: 0.150, h: 0.105, d: 0.095, front: -0.012 }, port: { type: 'flat', r: 0.032, len: 0.012 },
      tray: { x: 0.150, z: -0.060, top: 0.050, bottom: -0.130 }, arms: [0.203, 0.203],
      strobes: ['s2000d', 's2000d'], on: [true, false], N: 5.6, shutter: 1 / 125, iso: 200, sync: 1 / 2000 },
    { id: 'big', name: 'Full-frame housing + 2 × INON Z-330', lens: 'ff16',
      housing: { w: 0.330, h: 0.215, d: 0.150, front: -0.100 }, port: { type: 'dome', r: 0.10, len: 0 },
      tray: { x: 0.215, z: -0.180, top: 0.075, bottom: -0.160 }, arms: [0.203, 0.254],
      strobes: ['z330', 'z330'], on: [true, true], N: 8, shutter: 1 / 125, iso: 200, sync: 1 / 200 }
  ];

  /** Optical set-up of a lens in water for a render of width W pixels (3:2 frame). */
  function lensSetup(lensId, n, W) {
    var L = findById(LENSES, lensId);
    var H = W * L.sensor[1] / L.sensor[0];
    var fpxAir = L.f * W / L.sensor[0];
    var out = { id: L.id, name: L.name, proj: L.proj, W: W, H: H, fpxAir: fpxAir, pupil: L.pupil, domeR: L.domeR || 0.1, f: L.f };
    if (L.proj === 'flat') {
      out.fpx = fpxAir;
      var ha = Math.atan(W / 2 / fpxAir), va = Math.atan(H / 2 / fpxAir);
      out.hfovAir = 2 * ha * RAD; out.vfovAir = 2 * va * RAD;
      out.hfov = 2 * Math.asin(Math.sin(ha) / n) * RAD; out.vfov = 2 * Math.asin(Math.sin(va) / n) * RAD;
      out.pixAngW = 1 / (n * fpxAir);
    } else if (L.proj === 'water') {
      out.fpx = (W / 2) / Math.tan(L.hfovW / 2 * DEG);
      out.hfov = L.hfovW; out.vfov = 2 * Math.atan(H / 2 / out.fpx) * RAD;
      out.hfovAir = out.hfov; out.vfovAir = out.vfov;
      out.pixAngW = 1 / out.fpx;
    } else if (L.proj === 'fisheye') {
      out.fpx = fpxAir;
      out.hfov = 4 * Math.asin(Math.min(1, (W / 2) / (2 * fpxAir))) * RAD;
      out.vfov = 4 * Math.asin(Math.min(1, (H / 2) / (2 * fpxAir))) * RAD;
      out.hfovAir = out.hfov; out.vfovAir = out.vfov;
      out.pixAngW = 1 / fpxAir;
    } else {
      out.fpx = fpxAir;
      out.hfov = 2 * Math.atan(W / 2 / fpxAir) * RAD; out.vfov = 2 * Math.atan(H / 2 / fpxAir) * RAD;
      out.hfovAir = out.hfov; out.vfovAir = out.vfov;
      out.pixAngW = 1 / fpxAir;
    }
    out.Nmin = L.Nmin; out.Nmax = L.Nmax; out.Ndef = L.Ndef;
    return out;
  }

  /** Camera ray in the rig frame for pixel offsets (px right, py up) from the image centre. */
  function cameraRayRig(cam, px, py, n) {
    var d, o;
    if (cam.proj === 'flat') {
      var da = norm([px, py, cam.fpx]);
      o = mul(da, cam.pupil / da[2]);
      var sx = da[0] / n, sy = da[1] / n;
      d = [sx, sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy))];
    } else if (cam.proj === 'fisheye') {
      var r = Math.sqrt(px * px + py * py) / cam.fpx;
      if (r >= 2) return null;
      var th = 2 * Math.asin(r / 2), rr = Math.sqrt(px * px + py * py) || 1;
      d = [Math.sin(th) * px / rr, Math.sin(th) * py / rr, Math.cos(th)];
      o = mul(d, cam.pupil);
    } else {
      d = norm([px, py, cam.fpx]);
      o = mul(d, cam.pupil);
    }
    // the rig origin is the port glass; the pupil sits `pupil` behind it
    o = add(o, [0, 0, -cam.pupil]);
    return { o: o, d: d };
  }

  /** Apparent (virtual-image) distance from the pupil of an object `s` metres beyond the port. */
  function apparentDistance(cam, s, n) {
    if (cam.proj === 'flat') return cam.pupil + s / n;
    return domeImage(cam.domeR + s, cam.domeR, 0.008, 1.49, n);
  }
  /** Paraxial virtual image of a thick concentric dome (outer R, wall t), distance from the centre. */
  function domeImage(O, R, t, ng, nw) {
    var Ri = R - t;
    var so1 = O - R;
    var inv1 = (ng - nw) / R - nw / so1;
    var si1 = ng / inv1;
    var so2 = -(si1 - t);
    var inv2 = (1 - ng) / Ri - ng / so2;
    return -1 / inv2 + Ri;
  }

  /* ------------------------------------------------------------------ */
  /* Scene primitives                                                      */
  /* ------------------------------------------------------------------ */
  var T_SPHERE = 1, T_ELLIPSOID = 2, T_PLANE = 3, T_DISK = 4, T_BOX = 5, T_CYL = 6;
  var F_SHADOW = 1, F_SUBJECT = 2, F_RIG = 4, F_EMIT = 8;
  var MAT = {
    SAND: 0, ROCK: 1, BRAIN: 2, FAN: 3, SPONGE: 4, WRASSE: 5, FIN: 6, NUDI: 7, CERATA: 8, WALL: 9, GREY: 10,
    HOUSING: 11, ARM: 12, STROBE: 13, FACE: 14, EYE: 15, WHITE: 16, TABLE: 17, FAN2: 18, RUBBLE: 19, GLASS: 20, KELP: 21
  };
  /** Mean linear albedo of each material (used by the CPU metrics; the GPU adds texture). */
  var ALBEDO = [
    [0.58, 0.52, 0.41], [0.34, 0.30, 0.28], [0.55, 0.47, 0.28], [0.86, 0.36, 0.50], [0.86, 0.70, 0.17],
    [0.82, 0.32, 0.10], [0.90, 0.58, 0.24], [0.55, 0.25, 0.72], [0.75, 0.38, 0.30], [0.48, 0.38, 0.36],
    [0.18, 0.18, 0.18], [0.07, 0.07, 0.08], [0.22, 0.24, 0.27], [0.10, 0.10, 0.11], [1, 1, 1],
    [0.03, 0.03, 0.03], [0.85, 0.85, 0.85], [0.62, 0.56, 0.42], [0.55, 0.28, 0.62], [0.45, 0.42, 0.36],
    [0.02, 0.02, 0.03], [0.45, 0.38, 0.12]
  ];

  function prim(t, m, f, extra) { var p = { t: t, m: m, f: f, c: [0, 0, 0], r: 0, v: [0, 0, 0], w: 0, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], k: 0 }; for (var key in extra) p[key] = extra[key]; return p; }
  function sphere(m, f, c, r) { return prim(T_SPHERE, m, f, { c: c, r: r }); }
  function ellipsoid(m, f, c, radii, R) { return prim(T_ELLIPSOID, m, f, { c: c, v: radii, R: R || [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }); }
  function plane(m, f, normal, d) { return prim(T_PLANE, m, f, { v: norm(normal), w: d }); }
  function disk(m, f, c, r, normal, upHint) { return prim(T_DISK, m, f, { c: c, r: r, R: frameFromNormal(normal, upHint) }); }
  function box(m, f, c, half, R) { return prim(T_BOX, m, f, { c: c, v: half, R: R || [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }); }
  function cyl(m, f, a, b, r) { return prim(T_CYL, m, f, { c: a, v: b, r: r }); }

  /** Pink-sea-fan lattice: true where the fan is solid (branch or cross-link). uv on the disk, R radius. */
  function fract(x) { return x - Math.floor(x); }
  function fanSolid(u, v, R) {
    var qx = u, qy = v + R;
    var ang = Math.atan2(qx, Math.max(qy, 1e-4));
    var rad = Math.sqrt(qx * qx + qy * qy) / (2 * R);
    var nz = vnoise(qx / R * 2.25, qy / R * 2.25, 1.7), nz2 = vnoise(qx / R * 5.1, qy / R * 5.1, 4.3);
    if (Math.abs(ang) > 1.25 + 0.12 * nz2) return false;
    if (rad > 0.90 + 0.10 * nz) return false;
    if (rad < 0.05 && Math.abs(qx) < 0.025 * R) return true;
    var br = Math.abs(fract(ang * 7.0 + 2.2 * nz + 0.9 * nz2 * rad) - 0.5);
    var thick = 0.17 + (0.08 - 0.17) * rad;
    var lk = Math.abs(fract(rad * 24 + 2.6 * nz2 + 1.1 * nz + 0.8 * Math.sin(ang * 9)) - 0.5);
    return br > 0.5 - thick || lk > 0.5 - 0.05;
  }

  /*
   * Scene presets. Each builder receives the anchor point A (world) — the point
   * the camera is aimed at, at distance Z along the lens axis — and returns
   * primitives in world coordinates. Defaults: subject distance, camera tilt,
   * kit and lens that suit the scene.
   */
  var SCENES = [
    { id: 'wall', name: 'Pink sea fan in front of a jewel-anemone wall', Z: 1.0, tilt: -4, size: 0.55,
      note: 'Shadows: the fan casts its lattice on the wall; the ledge above shades the top.',
      build: function (A) {
        var P = [];
        P.push(plane(MAT.WALL, F_SHADOW, [0, 0, -1], -(A[2] + 0.30)));
        P.push(plane(MAT.RUBBLE, F_SHADOW, [0, 1, 0], A[1] - 0.85));
        P.push(box(MAT.ROCK, F_SHADOW, [A[0], A[1] + 0.43, A[2] + 0.17], [1.2, 0.05, 0.14]));
        P.push(sphere(MAT.ROCK, F_SHADOW, [A[0] + 0.04, A[1] - 0.56, A[2] + 0.06], 0.30));
        P.push(disk(MAT.FAN, F_SHADOW | F_SUBJECT, [A[0] + 0.04, A[1] + 0.0, A[2]], 0.26, [-0.17, 0, -0.985]));
        P.push(cyl(MAT.SPONGE, F_SHADOW, [A[0] - 0.48, A[1] - 0.86, A[2] + 0.18], [A[0] - 0.48, A[1] - 0.42, A[2] + 0.18], 0.07));
        P.push(sphere(MAT.ROCK, F_SHADOW, [A[0] + 0.58, A[1] - 0.80, A[2] + 0.08], 0.22));
        return P;
      } },
    { id: 'reef', name: 'Coral bommie on sand (wide angle)', Z: 1.3, tilt: -10, size: 0.8,
      note: 'Evenness across a wide frame; foreground sponge close to the port.',
      build: function (A) {
        var P = [], yb = A[1] - 0.45;
        P.push(plane(MAT.SAND, F_SHADOW, [0, 1, 0], yb));
        P.push(ellipsoid(MAT.BRAIN, F_SHADOW | F_SUBJECT, [A[0], A[1] - 0.20, A[2]], [0.60, 0.48, 0.52], frameYawPitchRoll(0.4, 0, 0)));
        P.push(ellipsoid(MAT.TABLE, F_SHADOW | F_SUBJECT, [A[0] - 0.72, A[1] + 0.02, A[2] + 0.35], [0.36, 0.045, 0.30]));
        P.push(cyl(MAT.ROCK, F_SHADOW, [A[0] - 0.72, yb, A[2] + 0.35], [A[0] - 0.72, A[1] - 0.01, A[2] + 0.35], 0.05));
        P.push(disk(MAT.FAN2, F_SHADOW | F_SUBJECT, [A[0] + 0.68, A[1] + 0.02, A[2] + 0.30], 0.42, [0.2, 0, -1]));
        P.push(cyl(MAT.SPONGE, F_SHADOW | F_SUBJECT, [A[0] + 0.30, yb, A[2] - 0.38], [A[0] + 0.30, yb + 0.30, A[2] - 0.38], 0.10));
        P.push(sphere(MAT.ROCK, F_SHADOW, [A[0] - 0.30, yb, A[2] - 0.35], 0.13));
        P.push(sphere(MAT.ROCK, F_SHADOW, [A[0] + 0.95, yb, A[2] - 0.10], 0.18));
        P.push(ellipsoid(MAT.WRASSE, F_SHADOW | F_SUBJECT, [A[0] + 0.12, A[1] + 0.55, A[2] - 0.08], [0.09, 0.032, 0.016], frameYawPitchRoll(-0.3, 0.05, 0)));
        return P;
      } },
    { id: 'fish', name: 'Cuckoo wrasse (30 cm) in open water', Z: 0.8, tilt: 0, size: 0.35,
      note: 'Blue-water backscatter: nothing behind the fish but water.',
      build: function (A) {
        var P = [];
        P.push(plane(MAT.SAND, F_SHADOW, [0, 1, 0], A[1] - 2.6));
        P.push(ellipsoid(MAT.WRASSE, F_SHADOW | F_SUBJECT, A.slice(), [0.15, 0.048, 0.026]));
        P.push(ellipsoid(MAT.FIN, F_SHADOW | F_SUBJECT, [A[0] - 0.165, A[1], A[2]], [0.045, 0.052, 0.005]));
        P.push(ellipsoid(MAT.FIN, F_SHADOW | F_SUBJECT, [A[0] - 0.01, A[1] + 0.05, A[2]], [0.11, 0.02, 0.004]));
        P.push(ellipsoid(MAT.FIN, F_SHADOW | F_SUBJECT, [A[0] + 0.0, A[1] - 0.045, A[2] + 0.004], [0.05, 0.016, 0.004]));
        P.push(sphere(MAT.EYE, F_SHADOW | F_SUBJECT, [A[0] + 0.118, A[1] + 0.012, A[2] - 0.022], 0.008));
        return P;
      } },
    { id: 'macro', name: 'Nudibranch (3 cm) on a rock (macro)', Z: 0.15, tilt: -25, size: 0.04,
      note: 'Macro: strobes close to the subject, angled in.',
      build: function (A) {
        var P = [];
        P.push(plane(MAT.RUBBLE, F_SHADOW, [0, 1, 0], A[1] - 0.35));
        P.push(sphere(MAT.ROCK, F_SHADOW, [A[0], A[1] - 0.2075, A[2] + 0.01], 0.20));
        var R = frameYawPitchRoll(0.26, 0, 0);
        P.push(ellipsoid(MAT.NUDI, F_SHADOW | F_SUBJECT, A.slice(), [0.022, 0.0050, 0.0068], R));
        for (var i = 0; i < 18; i++) {
          var row = i % 3, pair = (i / 3) | 0, side = (pair & 1) ? 1 : -1;
          var fx = -0.0150 + Math.floor(i / 6) * 0.0068 + row * 0.0016;
          var lean = side * (0.30 + 0.28 * row), back = 0.35 + 0.08 * row;
          var lp = toWorld(R, [fx, 0.0040, side * (0.0018 + 0.0014 * row)]);
          var Rc = frameYawPitchRoll(0.26, Math.PI / 2 - back, 0);
          Rc = [Rc[0], add(mul(Rc[1], Math.cos(lean)), mul(Rc[2], Math.sin(lean))), add(mul(Rc[2], Math.cos(lean)), mul(Rc[1], -Math.sin(lean)))];
          P.push(ellipsoid(MAT.CERATA, F_SHADOW | F_SUBJECT, add(A, lp), [0.0042 + 0.0009 * ((i * 7) % 3), 0.0015, 0.0015], Rc));
        }
        if (P.length > 0) {
          for (var t = -1; t <= 1; t += 2) {
            var o0 = add(A, toWorld(R, [0.020, 0.0005, t * 0.0025])), o1 = add(A, toWorld(R, [0.030, -0.0005, t * 0.0075]));
            P.push(cyl(MAT.NUDI, F_SHADOW | F_SUBJECT, o0, o1, 0.0007));
          }
        }
        for (var s = -1; s <= 1; s += 2) {
          var a0 = add(A, toWorld(R, [0.015, 0.003, s * 0.0028])), a1 = add(A, toWorld(R, [0.018, 0.0095, s * 0.0036]));
          P.push(cyl(MAT.NUDI, F_SHADOW | F_SUBJECT, a0, a1, 0.0010));
        }
        return P;
      } },
    { id: 'board', name: 'Coverage test: 18 % grey board with a white ball', Z: 1.0, tilt: 0, size: 0.6,
      note: 'Shows the strobes’ coverage, hot spots and shadow direction on a flat target.',
      build: function (A) {
        var P = [];
        P.push(plane(MAT.GREY, F_SHADOW | F_SUBJECT, [0, 0, -1], -A[2]));
        P.push(sphere(MAT.WHITE, F_SHADOW | F_SUBJECT, [A[0], A[1], A[2] - 0.22], 0.06));
        return P;
      } }
  ];

  /* ------------------------------------------------------------------ */
  /* Ray–primitive intersection (CPU reference)                            */
  /* ------------------------------------------------------------------ */
  var EPS = 1e-6;
  function intersect(p, o, d) {
    var t, h;
    switch (p.t) {
      case T_SPHERE: {
        var oc = sub(o, p.c), b = dot(oc, d), cc = dot(oc, oc) - p.r * p.r;
        h = b * b - cc; if (h < 0) return null; h = Math.sqrt(h);
        t = -b - h; if (t <= EPS) t = -b + h; if (t <= EPS) return null;
        return { t: t, n: mul(sub(add(o, mul(d, t)), p.c), 1 / p.r) };
      }
      case T_ELLIPSOID: {
        var ol = toLocal(p.R, sub(o, p.c)), dl = toLocal(p.R, d);
        var os = [ol[0] / p.v[0], ol[1] / p.v[1], ol[2] / p.v[2]], ds = [dl[0] / p.v[0], dl[1] / p.v[1], dl[2] / p.v[2]];
        var A2 = dot(ds, ds), B2 = dot(os, ds), C2 = dot(os, os) - 1;
        h = B2 * B2 - A2 * C2; if (h < 0) return null; h = Math.sqrt(h);
        t = (-B2 - h) / A2; if (t <= EPS) t = (-B2 + h) / A2; if (t <= EPS) return null;
        var pl = add(ol, mul(dl, t));
        var nl = [pl[0] / (p.v[0] * p.v[0]), pl[1] / (p.v[1] * p.v[1]), pl[2] / (p.v[2] * p.v[2])];
        return { t: t, n: norm(toWorld(p.R, nl)) };
      }
      case T_PLANE: {
        var den = dot(p.v, d); if (Math.abs(den) < 1e-9) return null;
        t = (p.w - dot(p.v, o)) / den; if (t <= EPS) return null;
        return { t: t, n: p.v.slice() };
      }
      case T_DISK: {
        var nn = p.R[2], dd = dot(nn, d); if (Math.abs(dd) < 1e-9) return null;
        t = dot(sub(p.c, o), nn) / dd; if (t <= EPS) return null;
        var q = sub(add(o, mul(d, t)), p.c), u = dot(q, p.R[0]), v = dot(q, p.R[1]);
        if (u * u + v * v > p.r * p.r) return null;
        if ((p.m === MAT.FAN || p.m === MAT.FAN2) && !fanSolid(u, v, p.r)) return null;
        return { t: t, n: nn.slice() };
      }
      case T_BOX: {
        var bo = toLocal(p.R, sub(o, p.c)), bd = toLocal(p.R, d), tmin = -Infinity, tmax = Infinity, ax = -1, sg = 1;
        for (var i = 0; i < 3; i++) {
          if (Math.abs(bd[i]) < 1e-12) { if (Math.abs(bo[i]) > p.v[i]) return null; continue; }
          var t1 = (-p.v[i] - bo[i]) / bd[i], t2 = (p.v[i] - bo[i]) / bd[i];
          var tn = Math.min(t1, t2), tf = Math.max(t1, t2);
          if (tn > tmin) { tmin = tn; ax = i; sg = t1 < t2 ? -1 : 1; }
          if (tf < tmax) tmax = tf;
        }
        if (tmax < Math.max(tmin, EPS)) return null;
        if (tmin <= EPS) return null;
        var nl2 = [0, 0, 0]; nl2[ax] = sg;
        return { t: tmin, n: toWorld(p.R, nl2) };
      }
      case T_CYL: {
        var a = p.c, bb = p.v, ba = sub(bb, a), oc2 = sub(o, a);
        var baba = dot(ba, ba), bard = dot(ba, d), baoc = dot(ba, oc2);
        var k2 = baba - bard * bard, k1 = baba * dot(oc2, d) - baoc * bard, k0 = baba * dot(oc2, oc2) - baoc * baoc - p.r * p.r * baba;
        h = k1 * k1 - k2 * k0; if (h < 0) return null; h = Math.sqrt(h);
        t = (-k1 - h) / k2;
        var y = baoc + t * bard;
        if (t > EPS && y > 0 && y < baba) return { t: t, n: mul(sub(add(oc2, mul(d, t)), mul(ba, y / baba)), 1 / p.r) };
        t = ((y < 0 ? 0 : baba) - baoc) / bard;
        if (t > EPS && Math.abs(k1 + k2 * t) < h) return { t: t, n: mul(ba, (y < 0 ? -1 : 1) / Math.sqrt(baba)) };
        return null;
      }
    }
    return null;
  }

  function trace(prims, o, d, tmax, includeRig) {
    var best = null;
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      if ((p.f & F_RIG) && !includeRig) continue;
      var hit = intersect(p, o, d);
      if (hit && hit.t < tmax && (!best || hit.t < best.t)) { best = hit; best.prim = p; best.index = i; }
    }
    return best;
  }
  function occluded(prims, o, d, tmax) {
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      if (!(p.f & F_SHADOW)) continue;
      var hit = intersect(p, o, d);
      if (hit && hit.t < tmax) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Rig geometry: arms, reach, aiming                                     */
  /* ------------------------------------------------------------------ */
  function kitById(id) { return findById(KITS, id); }
  function strobeModel(id) { return findById(STROBES, id); }
  function armBase(kit, side) { return [side * kit.tray.x, kit.tray.top, kit.tray.z]; }
  /** Point where the arm clamps onto the strobe (behind and below the head). */
  function mountPoint(model, pos, ax) {
    var fr = strobeFrame(ax);
    return sub(sub(pos, mul(ax, model.bodyL * 0.85)), mul(fr.up, model.bodyD * 0.55));
  }
  /** Two-segment arm from base to mount; returns the elbow (pole: outward and up). */
  function armElbow(base, mount, L1, L2, side) {
    var dv = sub(mount, base), d = Math.max(1e-6, len(dv)), dir = mul(dv, 1 / d);
    d = Math.min(d, L1 + L2 - 1e-6);
    var a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    var pole = norm([side * 1, 0.7, -0.25]);
    var perp = sub(pole, mul(dir, dot(pole, dir)));
    perp = len(perp) < 1e-6 ? [0, 1, 0] : norm(perp);
    return add(add(base, mul(dir, a)), mul(perp, h));
  }
  /**
   * Keep a strobe head within reach of its arm and outside the housing.
   * Returns a corrected position (rig frame).
   */
  function constrainStrobe(kit, model, pos, ax, side, arms) {
    var base = armBase(kit, side), L = (arms || kit.arms);
    var reach = L[0] + L[1] - 0.004, minReach = Math.abs(L[0] - L[1]) + 0.03;
    var m = mountPoint(model, pos, ax), off = sub(pos, m);
    var dv = sub(m, base), d = len(dv);
    if (d > reach) m = add(base, mul(dv, reach / d));
    else if (d < minReach) m = add(base, mul(d > 1e-6 ? mul(dv, 1 / d) : [side, 0.5, 0], minReach));
    var p = add(m, off);
    // keep the head out of the housing block and in front of the operator
    var hw = kit.housing.w / 2 + model.bodyD / 2 + 0.01, hh = kit.housing.h / 2 + model.bodyD / 2 + 0.01;
    var zf = kit.housing.front + 0.02, zb = kit.housing.front - kit.housing.d - 0.05;
    if (Math.abs(p[0]) < hw && Math.abs(p[1]) < hh && p[2] < zf && p[2] > zb) p[0] = (side || 1) * hw;
    if (kit.port.type === 'dome') {
      var dc = [0, 0, -kit.port.r], rr = kit.port.r + model.bodyD / 2 + 0.01, q = sub(p, dc), ql = len(q);
      if (ql < rr && p[2] > kit.housing.front - 0.02) p = add(dc, mul(q, rr / Math.max(ql, 1e-6)));
    }
    return p;
  }
  function aimAt(pos, target) {
    var d = norm(sub(target, pos));
    return { yaw: Math.atan2(d[0], d[2]) * RAD, pitch: Math.asin(clamp(d[1], -1, 1)) * RAD };
  }

  /** Primitives of the camera rig (housing, port, tray, arms, strobes) in world coordinates, for the observer view. */
  function rigPrimitives(world) {
    var kit = world.kit, tilt = world.tilt, P = [], st = world.state;
    function W(v) { return rigToWorld(tilt, v); }
    var R = [W([1, 0, 0]), W([0, 1, 0]), W([0, 0, 1])];
    var hs = kit.housing;
    P.push(box(MAT.HOUSING, F_RIG, W([0, 0, hs.front - hs.d / 2]), [hs.w / 2, hs.h / 2, hs.d / 2], R));
    if (kit.port.type === 'dome') P.push(sphere(MAT.GLASS, F_RIG, W([0, 0, -kit.port.r]), kit.port.r));
    else {
      P.push(cyl(MAT.HOUSING, F_RIG, W([0, 0, hs.front]), W([0, 0, -0.002]), kit.port.r));
      P.push(disk(MAT.GLASS, F_RIG, W([0, 0, -0.001]), kit.port.r * 0.85, W([0, 0, 1])));
    }
    P.push(box(MAT.ARM, F_RIG, W([0, -hs.h / 2 - 0.014, kit.tray.z]), [kit.tray.x + 0.02, 0.011, 0.035], R));
    for (var side = -1; side <= 1; side += 2) {
      P.push(cyl(MAT.ARM, F_RIG, W([side * kit.tray.x, kit.tray.bottom, kit.tray.z]), W([side * kit.tray.x, kit.tray.top - 0.02, kit.tray.z]), 0.017));
    }
    for (var k = 0; k < world.strobes.length; k++) {
      var s = world.strobes[k], m = s.model, sd = s.side;
      var pos = s.posRig, ax = s.axRig, base = armBase(kit, sd), mount = mountPoint(m, pos, ax);
      var arms = (st.strobes[s.index] && st.strobes[s.index].arms) || kit.arms;
      var elbow = armElbow(base, mount, arms[0], arms[1], sd);
      P.push(sphere(MAT.ARM, F_RIG, W(base), 0.019));
      P.push(cyl(MAT.ARM, F_RIG, W(base), W(elbow), 0.011));
      P.push(sphere(MAT.HOUSING, F_RIG, W(elbow), 0.021));
      P.push(cyl(MAT.ARM, F_RIG, W(elbow), W(mount), 0.011));
      P.push(cyl(MAT.STROBE, F_RIG, W(sub(pos, mul(ax, m.bodyL))), W(sub(pos, mul(ax, 0.004))), m.bodyD / 2));
      var face = disk(MAT.FACE, F_RIG | F_EMIT, W(sub(pos, mul(ax, 0.002))), m.faceR, W(ax));
      face.k = k;
      P.push(face);
    }
    return P;
  }

  /* ------------------------------------------------------------------ */
  /* Placement presets (rig frame), computed for a kit and a distance Z    */
  /* ------------------------------------------------------------------ */
  var PLACEMENTS = [
    { id: 'aimed', name: '10 and 2 o’clock, aimed at the subject' },
    { id: 'edge', name: 'Wide angle: out, back, angled out (edge lighting)' },
    { id: 'parallel', name: 'Far out and behind the port, beams parallel' },
    { id: 'close', name: 'Close to the port, aimed straight ahead (classic mistake)' },
    { id: 'macro', name: 'Macro: in close, angled in at the subject' },
    { id: 'top', name: 'Single strobe overhead (top lighting)' },
    { id: 'side', name: 'Single strobe from the side (texture)' }
  ];
  function placement(id, kit, Z, models) {
    var T = [0, 0, Z], hw = kit.housing.w / 2, out = [];
    function mk(side, pos, aim, deltaOut) {
      var m = models[side < 0 ? 0 : 1];
      var a = aim === 'target' ? aimAt(pos, T) : { yaw: 0, pitch: 0 };
      if (deltaOut) a.yaw += side * deltaOut;
      var ax = strobeAxis(a.yaw, a.pitch);
      var p = constrainStrobe(kit, m, pos, ax, side);
      if (aim === 'target') { a = aimAt(p, T); if (deltaOut) a.yaw += side * deltaOut; }
      return { pos: p, yaw: a.yaw, pitch: a.pitch, on: true };
    }
    var fe = function (side) { var m = models[side < 0 ? 0 : 1]; return 0.75 * m.beamH / 2; };
    switch (id) {
      case 'aimed': out = [mk(-1, [-(hw + 0.12), 0.13, -0.03], 'target'), mk(1, [hw + 0.12, 0.13, -0.03], 'target')]; break;
      case 'edge': out = [mk(-1, [-(hw + 0.30), 0.09, -0.12], 'target', fe(-1)), mk(1, [hw + 0.30, 0.09, -0.12], 'target', fe(1))]; break;
      case 'parallel': out = [mk(-1, [-(hw + 0.30), 0.08, -0.16], 'none'), mk(1, [hw + 0.30, 0.08, -0.16], 'none')]; break;
      case 'close': out = [mk(-1, [-(hw + 0.06), 0.0, 0.0], 'none'), mk(1, [hw + 0.06, 0.0, 0.0], 'none')]; break;
      case 'macro': out = [mk(-1, [-(hw * 0.4 + 0.05), 0.07, 0.03], 'target'), mk(1, [hw * 0.4 + 0.05, 0.07, 0.03], 'target')]; break;
      case 'top': out = [mk(-1, [-0.02, kit.housing.h / 2 + 0.22, -0.02], 'target'), mk(1, [hw + 0.12, 0.13, -0.03], 'target')]; out[1].on = false; break;
      case 'side': out = [mk(-1, [-(hw + 0.30), 0.04, 0.12], 'target'), mk(1, [hw + 0.12, 0.13, -0.03], 'target')]; out[1].on = false; break;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Ambient (sun) light                                                   */
  /* ------------------------------------------------------------------ */
  var SKY = [
    { id: 'sun', name: 'Bright sun', E: 60000 },
    { id: 'overcast', name: 'Overcast', E: 15000 },
    { id: 'dusk', name: 'Dusk', E: 1500 },
    { id: 'night', name: 'Night dive (no daylight)', E: 0 }
  ];
  function ambientLight(water, depth, skyId) {
    var sky = findById(SKY, skyId);
    var E0 = sky.E * 0.9;
    var Ed = water.Kd.map(function (k) { return E0 * Math.exp(-k * Math.max(0, depth)); });
    var Linf = Ed.map(function (e, i) { return e * 0.035 * (0.5 + water.omega[i]); });
    return { Ed: Ed, Linf: Linf, E0: E0, Kd: water.Kd.slice(), sky: sky };
  }
  function ambientIrradiance(amb, n, yRel) {
    // downwelling, with a diffuse floor; yRel = height above the camera (m)
    var k = 0.70 * Math.max(n[1], 0) + 0.30 * (0.5 + 0.5 * n[1]);
    return amb.Ed.map(function (e, i) { return e * k * Math.exp(amb.Kd[i] * yRel); });
  }
  function backgroundRadiance(amb, dirY) {
    var f = Math.exp(1.6 * clamp(dirY, -1, 1));
    return amb.Linf.map(function (l) { return l * f; });
  }

  /* ------------------------------------------------------------------ */
  /* World assembly                                                        */
  /* ------------------------------------------------------------------ */
  function rigToWorld(tilt, v) {
    var t = tilt * DEG, c = Math.cos(t), s = Math.sin(t);
    return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
  }
  function worldToRig(tilt, v) {
    var t = tilt * DEG, c = Math.cos(t), s = Math.sin(t);
    return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  }
  /** Exposure scale: pixel value (18 % grey = 0.18) per cd·s/m² of scene luminance in water. */
  function exposureScale(iso, N, n) { return 0.018 * 0.65 * iso / (N * N) / (n * n) * 0.92; }

  /**
   * Assemble everything the renderers need from the UI state.
   * state: { kit, lens, N, shutter, iso, focus ('auto'|metres), scene, Z, tilt,
   *          water, visibility, specks, depth, sky, strobes:[{on, model, power, pos, yaw, pitch}] }
   * W: render width in pixels.
   */
  function buildWorld(state, W) {
    var water = makeWater(state.water, { visibility: state.visibility, specks: state.specks });
    var n = water.n;
    var kit = kitById(state.kit);
    var cam = lensSetup(state.lens, n, W || 960);
    var tilt = state.tilt || 0;
    var Z = state.Z;
    var anchorRig = [0, 0, Z], anchor = rigToWorld(tilt, anchorRig);
    var scene = findById(SCENES, state.scene);
    var prims = scene.build(anchor);
    var strobes = [];
    for (var i = 0; i < state.strobes.length; i++) {
      var s = state.strobes[i];
      if (!s.on) continue;
      var m = strobeModel(s.model);
      var axR = strobeAxis(s.yaw, s.pitch), fr = strobeFrame(axR);
      var I0 = intensityFromGN(m.gn) * Math.pow(2, s.power || 0) * n * n;   // n² gain in water cancels the camera-side 1/n²
      var col = kelvinRGB(m.kelvin);
      strobes.push({
        index: i, model: m, side: i === 0 ? -1 : 1,
        pos: rigToWorld(tilt, s.pos), ax: rigToWorld(tilt, fr.ax), rt: rigToWorld(tilt, fr.rt), up: rigToWorld(tilt, fr.up),
        posRig: s.pos.slice(), axRig: fr.ax,
        thx: m.beamH / 2 * DEG, thy: m.beamV / 2 * DEG, p: m.p, cut: m.cut * DEG,
        I: [I0 * col[0], I0 * col[1], I0 * col[2]], I0: I0, faceR: m.faceR
      });
    }
    var amb = ambientLight(water, state.depth, state.sky);
    var focus = state.focus === 'auto' || state.focus == null ? Z : state.focus;
    var kexp = exposureScale(state.iso, state.N, n);
    return {
      state: state, water: water, n: n, kit: kit, cam: cam, tilt: tilt, Z: Z,
      anchor: anchor, anchorRig: anchorRig, scene: scene, prims: prims, strobes: strobes,
      amb: amb, shutter: state.shutter, kexp: kexp, focus: focus,
      focusApp: apparentDistance(cam, focus, n),
      Dep: cam.f / 1000 / state.N,
      rho: water.specks * 1000,
      rmax: Math.min(8, 6 / water.c[1] + 0.5)
    };
  }

  /** Camera ray in world coordinates. */
  function cameraRay(world, px, py) {
    var r = cameraRayRig(world.cam, px, py, world.n);
    if (!r) return null;
    return { o: rigToWorld(world.tilt, r.o), d: rigToWorld(world.tilt, r.d) };
  }

  /* ------------------------------------------------------------------ */
  /* CPU reference shading                                                 */
  /* ------------------------------------------------------------------ */
  /** Irradiance-time (lux·s, per channel) from strobe s at point x, without occlusion. */
  function strobeIrradiance(world, s, x, c) {
    var w = sub(x, s.pos), D2 = Math.max(dot(w, w), s.faceR * s.faceR), D = Math.sqrt(D2);
    w = mul(w, 1 / D);
    var B = beam(s, w);
    if (B <= 0) return { E: [0, 0, 0], w: w, D: D, B: 0 };
    var att = expAtt(c, D);
    return { E: [s.I[0] * B * att[0] / D2, s.I[1] * B * att[1] / D2, s.I[2] * B * att[2] / D2], w: w, D: D, B: B };
  }
  var VOGEL = (function () { var a = []; for (var k = 0; k < 16; k++) a.push(k * 2.39996323); return a; })();
  function softVisibility(world, s, p, n, samples) {
    if (!samples || samples <= 1) {
      var dv = sub(s.pos, p), L = len(dv);
      return occluded(world.prims, add(p, mul(n, 2e-4)), mul(dv, 1 / L), L - 1e-3) ? 0 : 1;
    }
    var vis = 0;
    for (var k = 0; k < samples; k++) {
      var r = Math.sqrt((k + 0.5) / samples) * s.faceR, a = VOGEL[k];
      var q = add(add(s.pos, mul(s.rt, r * Math.cos(a))), mul(s.up, r * Math.sin(a)));
      var dv2 = sub(q, p), L2 = len(dv2);
      if (!occluded(world.prims, add(p, mul(n, 2e-4)), mul(dv2, 1 / L2), L2 - 1e-3)) vis++;
    }
    return vis / samples;
  }

  /**
   * Single-scattering backscatter along a camera ray (luminance-time, per channel)
   * plus the distance within which half of it originates.
   */
  function volumeCPU(world, o, d, tEnd, steps, opts) {
    opts = opts || {};
    var c = world.water.c, b = world.water.b, sum = [0, 0, 0], T = Math.min(tEnd, world.rmax), cum = [], N = steps || 48;
    for (var i = 0; i < N; i++) {
      var u0 = i / N, u1 = (i + 1) / N, u = (i + 0.5) / N;
      var t = T * u * u, dt = T * (u1 * u1 - u0 * u0);
      var x = add(o, mul(d, t));
      var acc = [0, 0, 0];
      for (var si = 0; si < world.strobes.length; si++) {
        var s = world.strobes[si];
        var ir = strobeIrradiance(world, s, x, c);
        if (ir.B <= 0) continue;
        if (opts.shadows) { var dv = sub(s.pos, x), L = len(dv); if (occluded(world.prims, x, mul(dv, 1 / L), L - 1e-3)) continue; }
        var ph = phaseFast(dot(ir.w, mul(d, -1)));
        acc = add(acc, mul(ir.E, ph));
      }
      var att = expAtt(c, t);
      var inc = [b[0] * acc[0] * att[0] * dt, b[1] * acc[1] * att[1] * dt, b[2] * acc[2] * att[2] * dt];
      sum = add(sum, inc);
      cum.push([t + dt / 2, sum[1]]);
    }
    var half = 0;
    for (var j = 0; j < cum.length; j++) if (cum[j][1] >= 0.5 * sum[1]) { half = cum[j][0]; break; }
    return { L: sum, half: half, T: T };
  }

  /**
   * Shade one camera pixel (CPU). Returns the separate light components in
   * luminance-time units (strobe) and luminance (ambient), plus diagnostics.
   */
  function shadePixel(world, px, py, opts) {
    opts = opts || {};
    var ray = cameraRay(world, px, py);
    if (!ray) return null;
    var c = world.water.c;
    var hit = trace(world.prims, ray.o, ray.d, 1e4, false);
    var res = { hit: !!hit, t: hit ? hit.t : Infinity, prim: hit ? hit.prim : null, Ls: [0, 0, 0], La: [0, 0, 0], Lbs: [0, 0, 0], per: [], ray: ray };
    if (hit) {
      var p = add(ray.o, mul(ray.d, hit.t)), nrm = hit.n;
      if (dot(nrm, ray.d) > 0) nrm = mul(nrm, -1);
      var alb = ALBEDO[hit.prim.m];
      var attCam = expAtt(c, hit.t);
      for (var si = 0; si < world.strobes.length; si++) {
        var s = world.strobes[si];
        var ir = strobeIrradiance(world, s, p, c);
        var ndl = Math.max(0, -dot(nrm, ir.w));
        var vis = ndl > 0 && ir.B > 0 ? softVisibility(world, s, p, nrm, opts.soft || 4) : 0;
        var Lun = [alb[0] / PI * ir.E[0] * ndl * attCam[0], alb[1] / PI * ir.E[1] * ndl * attCam[1], alb[2] / PI * ir.E[2] * ndl * attCam[2]];
        res.per.push({ unocc: Lun, vis: vis, B: ir.B, D: ir.D, ndl: ndl });
        res.Ls = add(res.Ls, mul(Lun, vis));
      }
      var Ea = ambientIrradiance(world.amb, nrm, p[1]);
      var Lobj = [alb[0] / PI * Ea[0] * attCam[0], alb[1] / PI * Ea[1] * attCam[1], alb[2] / PI * Ea[2] * attCam[2]];
      var Lbg = backgroundRadiance(world.amb, ray.d[1]);
      res.La = [Lobj[0] + Lbg[0] * (1 - attCam[0]), Lobj[1] + Lbg[1] * (1 - attCam[1]), Lobj[2] + Lbg[2] * (1 - attCam[2])];
      res.p = p; res.n = nrm;
    } else {
      res.La = backgroundRadiance(world.amb, ray.d[1]);
    }
    var vol = volumeCPU(world, ray.o, ray.d, res.t, opts.steps || 40, { shadows: opts.volShadows });
    res.Lbs = vol.L; res.half = vol.half;
    return res;
  }

  /** Pixel value (linear, 0.18 = mid grey) of the components. */
  function pixelValue(world, r) {
    var k = world.kexp, sh = world.shutter;
    return [0, 1, 2].map(function (i) { return k * (r.Ls[i] + r.Lbs[i] + sh * r.La[i]); });
  }

  /* ------------------------------------------------------------------ */
  /* Particles: how many bright specks the frame would show               */
  /* ------------------------------------------------------------------ */
  /*
   * Speck statistics: particles are counted as they would appear on a picture
   * viewed 1200 pixels wide. A particle smaller than a pixel spreads its light
   * over that pixel, so its apparent brightness depends on the viewing size.
   */
  var SPECK_VIEW_W = 1200, A_MIN = 0.25e-3, A_MAX = 2.5e-3;
  // Marine-snow aggregates are porous and barely denser than water, so they backscatter weakly:
  // scattering cross-section 0.6·πa² with the particle phase function gives a backscatter efficiency of ≈ 0.01.
  var SNOW_SIGMA = 0.6 * PI;
  function speckStats(world, refValue, samples) {
    var cam = world.cam, N = samples || 1500, n = world.n, rng = 1234567, kpx = SPECK_VIEW_W / cam.W;
    function rnd() { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; }
    var sMax = Math.min(world.Z * 1.5 + 0.5, 4), sMin = 0.01;
    // frustum solid angle (water side) from the image corners
    var Om = 0, nx = 24, ny = 16;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var px = (i + 0.5 - nx / 2) * cam.W / nx, py = (j + 0.5 - ny / 2) * cam.H / ny;
      var a = cameraRayRig(cam, px, py, n), b2 = cameraRayRig(cam, px + cam.W / nx, py, n), c2 = cameraRayRig(cam, px, py + cam.H / ny, n);
      if (a && b2 && c2) Om += len(cross(sub(b2.d, a.d), sub(c2.d, a.d)));
    }
    var vol = Om * (Math.pow(sMax, 3) - Math.pow(sMin, 3)) / 3;
    var expected = world.rho * vol;
    var bright = 0, visible = 0;
    var ia = 1 / (A_MIN * A_MIN), ib = 1 / (A_MAX * A_MAX);
    for (var k = 0; k < N; k++) {
      var px2 = (rnd() - 0.5) * cam.W, py2 = (rnd() - 0.5) * cam.H;
      var ray = cameraRay(world, px2, py2); if (!ray) continue;
      var s = Math.cbrt(sMin * sMin * sMin + rnd() * (sMax * sMax * sMax - sMin * sMin * sMin));
      var hit = trace(world.prims, ray.o, ray.d, s, false);
      if (hit) continue;
      var x = add(ray.o, mul(ray.d, s));
      var aa = 1 / Math.sqrt(ia - rnd() * (ia - ib)), sigma = SNOW_SIGMA * aa * aa;
      var J = 0;
      for (var si = 0; si < world.strobes.length; si++) {
        var st = world.strobes[si], ir = strobeIrradiance(world, st, x, world.water.c);
        if (ir.B > 0) J += ir.E[1] * phaseFast(dot(ir.w, mul(ray.d, -1)));
      }
      J *= sigma;
      var app = apparentDistance(cam, s, n), blur = Math.max(0.6, 0.5 * world.Dep * Math.abs(1 / app - 1 / world.focusApp) * cam.fpxAir * kpx);
      var pa = cam.pixAngW / kpx, omegaDisk = PI * blur * blur * pa * pa;
      var sp = s + cam.pupil;
      var v = world.kexp * J * Math.exp(-world.water.c[1] * s) / (sp * sp * omegaDisk);
      if (v > 0.5 * refValue) bright++;
      if (v > 0.12 * refValue) visible++;
    }
    return { expected: expected, bright: expected * bright / N, visible: expected * visible / N, volume: vol };
  }

  /* ------------------------------------------------------------------ */
  /* Metrics for the results panel                                         */
  /* ------------------------------------------------------------------ */
  function percentile(arr, q) { if (!arr.length) return NaN; var a = arr.slice().sort(function (x, y) { return x - y; }); var i = clamp(Math.round(q * (a.length - 1)), 0, a.length - 1); return a[i]; }

  function computeMetrics(world, opts) {
    opts = opts || {};
    var cam = world.cam, nx = opts.nx || 36, ny = Math.round(nx * cam.H / cam.W);
    var subjEV = [], frameEV = [], veilRatio = [], veilFrame = [], bgEV = [], deep = 0, part = 0, solid = 0, subjN = 0;
    var subjStrobe = [0, 0, 0], subjNoWater = [0, 0, 0], perStrobeSubj = world.strobes.map(function () { return 0; });
    var halfs = [], bsLum = 0, cnt = 0, centreVeil = null, sumS = 0, sumA = 0, sumB = 0, cwS = 0, cwA = 0, cwB = 0, cwW = 0;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var px = (i + 0.5 - nx / 2) * cam.W / nx, py = (j + 0.5 - ny / 2) * cam.H / ny;
      var r = shadePixel(world, px, py, { soft: opts.soft || 4, steps: opts.steps || 32 });
      if (!r) continue;
      var v = pixelValue(world, r), Y = lum(v);
      var Ybs = world.kexp * lum(r.Lbs), Ys = world.kexp * lum(r.Ls), Ya = world.kexp * world.shutter * lum(r.La);
      bsLum += Ybs; cnt++;
      if (r.half) halfs.push(r.half);
      if (!r.hit) bgEV.push(Math.log2(Math.max(Y, 1e-6) / 0.18));
      if (r.hit) {
        solid++;
        var Ysig = Math.max(1e-9, Ys + Ya);
        veilFrame.push(Ybs / Ysig);
        var rho = Math.max(0.02, lum(ALBEDO[r.prim.m]));
        frameEV.push(Math.log2(Math.max(Y, 1e-6) / rho));
        var wcw = Math.exp(-(px * px) / (0.18 * cam.W * cam.W) - (py * py) / (0.18 * cam.H * cam.H));
        cwS += wcw * Ys / rho; cwA += wcw * Ya / rho; cwB += wcw * Ybs / rho; cwW += wcw;
        var tot = 0, got = 0;
        r.per.forEach(function (q) { tot += lum(q.unocc); got += lum(q.unocc) * q.vis; });
        if (tot > 0) { var fr = got / tot; if (fr < 0.25) deep++; else if (fr < 0.75) part++; }
        if (r.prim && (r.prim.f & F_SUBJECT)) {
          subjN++;
          subjEV.push(Math.log2(Math.max(Y, 1e-6) / rho));
          veilRatio.push(Ybs / Ysig);
          sumS += Ys / rho; sumA += Ya / rho; sumB += Ybs / rho;
          subjStrobe = add(subjStrobe, r.Ls);
          r.per.forEach(function (q, k) { perStrobeSubj[k] += lum(q.unocc) * q.vis; });
          var noW = r.per.reduce(function (acc, q, k) {
            var s = world.strobes[k], att = expAtt(world.water.c, q.D + r.t);
            return add(acc, [q.unocc[0] / att[0] * q.vis, q.unocc[1] / att[1] * q.vis, q.unocc[2] / att[2] * q.vis]);
          }, [0, 0, 0]);
          subjNoWater = add(subjNoWater, noW);
        }
      }
      if (Math.abs(px) < cam.W / nx && Math.abs(py) < cam.H / ny && centreVeil == null) centreVeil = r;
    }
    // finer sampling of the frame centre, where the subject sits: small subjects (macro, fish) would otherwise be missed
    var nc = opts.centreN || 12;
    for (var jc = 0; jc < Math.round(nc * 2 / 3); jc++) for (var ic = 0; ic < nc; ic++) {
      var pxc = (ic + 0.5 - nc / 2) * cam.W * 0.32 / nc, pyc = (jc + 0.5 - nc / 3) * cam.H * 0.32 / Math.round(nc * 2 / 3);
      var rc = shadePixel(world, pxc, pyc, { soft: opts.soft || 4, steps: opts.steps || 32 });
      if (!rc || !rc.hit || !(rc.prim.f & F_SUBJECT)) continue;
      var vc = pixelValue(world, rc), Yc = lum(vc), rhoc = Math.max(0.02, lum(ALBEDO[rc.prim.m]));
      var Ysc = world.kexp * lum(rc.Ls), Yac = world.kexp * world.shutter * lum(rc.La), Ybc = world.kexp * lum(rc.Lbs);
      subjN++; subjEV.push(Math.log2(Math.max(Yc, 1e-6) / rhoc)); veilRatio.push(Ybc / Math.max(1e-9, Ysc + Yac));
      sumS += Ysc / rhoc; sumA += Yac / rhoc; sumB += Ybc / rhoc;
      subjStrobe = add(subjStrobe, rc.Ls);
      rc.per.forEach(function (q, k) { perStrobeSubj[k] += lum(q.unocc) * q.vis; });
      subjNoWater = add(subjNoWater, rc.per.reduce(function (acc, q) {
        var att = expAtt(world.water.c, q.D + rc.t);
        return add(acc, [q.unocc[0] / att[0] * q.vis, q.unocc[1] / att[1] * q.vis, q.unocc[2] / att[2] * q.vis]);
      }, [0, 0, 0]));
    }
    // value of a correctly exposed 50 % grey subject at the current settings, as reference for speck brightness
    var subjectValue = 0.5 * (subjN ? Math.pow(2, percentile(subjEV, 0.5)) : 1);
    var specks = opts.speckSamples === 0 ? null : speckStats(world, subjectValue, opts.speckSamples || 1200);
    // TTL-like power: factor k on all strobe light so that the mean subject exposure is correct
    var autoK = subjN >= 4 && (sumS + sumB) > 0 ? (subjN - sumA) / (sumS + sumB)
      : (cwW > 0 && (cwS + cwB) > 0 ? (cwW - cwA) / (cwS + cwB) : NaN);
    var redLoss = (subjStrobe[1] > 0 && subjNoWater[1] > 0) ? Math.log2((subjStrobe[0] / subjNoWater[0]) / (subjStrobe[1] / subjNoWater[1])) : NaN;
    var blueShift = (subjStrobe[1] > 0 && subjNoWater[1] > 0) ? Math.log2((subjStrobe[2] / subjNoWater[2]) / (subjStrobe[1] / subjNoWater[1])) : NaN;
    // per-strobe geometry relative to the subject anchor
    var strobeInfo = world.strobes.map(function (s, k) {
      var toA = sub(world.anchor, s.pos), D = len(toA), w = mul(toA, 1 / D);
      var off = Math.acos(clamp(dot(w, s.ax), -1, 1)) * RAD;
      var sumAll = perStrobeSubj.reduce(function (a, b) { return a + b; }, 0) || 1;
      return {
        index: s.index, name: s.model.name, distance: D, offAxis: off, relB: beam(s, w),
        penumbra: 2 * Math.atan(s.faceR / D) * RAD, share: perStrobeSubj[k] / sumAll,
        camAngle: Math.acos(clamp(dot(norm(sub(world.anchor, s.pos)), norm(sub(world.anchor, [0, 0, 0]))), -1, 1)) * RAD
      };
    });
    return {
      subjectEV: subjN ? percentile(subjEV, 0.5) : NaN,
      subjectRange: subjN ? [percentile(subjEV, 0.1), percentile(subjEV, 0.9)] : [NaN, NaN],
      frameRange: frameEV.length ? [percentile(frameEV, 0.1), percentile(frameEV, 0.9)] : [NaN, NaN],
      backgroundEV: bgEV.length ? percentile(bgEV, 0.5) : NaN, waterFraction: cnt ? bgEV.length / cnt : 0,
      veil: veilRatio.length ? percentile(veilRatio, 0.5) : (veilFrame.length ? percentile(veilFrame, 0.5) : NaN),
      veilMax: veilFrame.length ? percentile(veilFrame, 0.95) : NaN,
      autoK: autoK, ambientShare: subjN ? sumA / Math.max(1e-9, sumS + sumA + sumB) : 0,
      backscatterMean: cnt ? bsLum / cnt : 0,
      halfDistance: halfs.length ? percentile(halfs, 0.5) : NaN,
      shadowDeep: solid ? deep / solid : 0, shadowPartial: solid ? part / solid : 0,
      redLoss: redLoss, blueShift: blueShift,
      specks: specks, strobes: strobeInfo, subjectPixels: subjN, samples: nx * ny
    };
  }

  /* ------------------------------------------------------------------ */
  /* 2-D diagnostic field: where the backscatter in the picture comes from */
  /* ------------------------------------------------------------------ */
  /**
   * Backscatter source strength b·Σ p(ψ)·E(x)·exp(−c r) (green channel,
   * luminance-time per metre of ray) on a plane of the rig frame, only where the
   * point is inside the field of view and not hidden behind the scene.
   * view: 'top' (x–z plane, y = 0) or 'side' (y–z plane, x = 0).
   */
  function backscatterField(world, view, bounds, nx, ny) {
    var out = new Float32Array(nx * ny), cam = world.cam, n = world.n, c = world.water.c, b = world.water.b;
    var hx = Math.tan(cam.hfov / 2 * DEG), hy = Math.tan(cam.vfov / 2 * DEG);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var u = bounds.u0 + (i + 0.5) / nx * (bounds.u1 - bounds.u0);
      var v = bounds.v0 + (j + 0.5) / ny * (bounds.v1 - bounds.v0);
      var pr = view === 'top' ? [u, 0, v] : [0, v, u];       // rig frame (x, y, z)
      var zf = pr[2]; if (zf <= 0.005) continue;
      var ang = view === 'top' ? Math.abs(pr[0]) / (zf + cam.pupil) : Math.abs(pr[1]) / (zf + cam.pupil);
      var lim = view === 'top' ? hx : hy;
      if (cam.proj === 'fisheye') { if (Math.atan(ang) > (view === 'top' ? cam.hfov : cam.vfov) / 2 * DEG) continue; }
      else if (ang > lim) continue;
      var x = rigToWorld(world.tilt, pr);
      var eye = rigToWorld(world.tilt, [0, 0, 0]);
      var dv = sub(x, eye), r = len(dv), dcam = mul(dv, 1 / r);
      var hit = trace(world.prims, eye, dcam, r, false);
      if (hit) continue;
      var S = 0;
      for (var k = 0; k < world.strobes.length; k++) {
        var s = world.strobes[k], ir = strobeIrradiance(world, s, x, c);
        if (ir.B <= 0) continue;
        var dl = sub(s.pos, x), L = len(dl);
        if (occluded(world.prims, x, mul(dl, 1 / L), L - 1e-3)) continue;
        S += ir.E[1] * phaseFast(dot(ir.w, mul(dcam, -1)));
      }
      out[j * nx + i] = b[1] * S * Math.exp(-c[1] * r);
    }
    return out;
  }

  return {
    DEG: DEG, RAD: RAD,
    add: add, sub: sub, mul: mul, dot: dot, cross: cross, len: len, norm: norm, clamp: clamp, lum: lum,
    pcg: pcg, h3: h3, hf: hf, vnoise: vnoise, fanSolid: fanSolid,
    refractiveIndex: refractiveIndex, WATER: WATER, makeWater: makeWater, VIS_K: VIS_K, BB_RATIO: BB_RATIO,
    ffPhase: ffPhase, ffBackFraction: ffBackFraction, phaseFast: phaseFast, PHASE_LUT: PHASE_LUT, PHASE_LUT_N: PHASE_LUT_N, FF_N: FF_N, FF_MU: FF_MU,
    STROBES: STROBES, strobeModel: strobeModel, intensityFromGN: intensityFromGN, kelvinRGB: kelvinRGB,
    strobeAxis: strobeAxis, strobeFrame: strobeFrame, beam: beam, beamAngleAt: beamAngleAt,
    LENSES: LENSES, KITS: KITS, kitById: kitById, lensSetup: lensSetup, cameraRayRig: cameraRayRig, cameraRay: cameraRay,
    apparentDistance: apparentDistance, domeImage: domeImage,
    T: { SPHERE: T_SPHERE, ELLIPSOID: T_ELLIPSOID, PLANE: T_PLANE, DISK: T_DISK, BOX: T_BOX, CYL: T_CYL },
    F: { SHADOW: F_SHADOW, SUBJECT: F_SUBJECT, RIG: F_RIG, EMIT: F_EMIT }, MAT: MAT, ALBEDO: ALBEDO,
    sphere: sphere, ellipsoid: ellipsoid, plane: plane, disk: disk, box: box, cyl: cyl, frameFromNormal: frameFromNormal,
    SCENES: SCENES, findById: findById, intersect: intersect, trace: trace, occluded: occluded,
    armBase: armBase, mountPoint: mountPoint, armElbow: armElbow, constrainStrobe: constrainStrobe, aimAt: aimAt, rigPrimitives: rigPrimitives,
    PLACEMENTS: PLACEMENTS, placement: placement,
    SKY: SKY, ambientLight: ambientLight, ambientIrradiance: ambientIrradiance, backgroundRadiance: backgroundRadiance,
    rigToWorld: rigToWorld, worldToRig: worldToRig, exposureScale: exposureScale, buildWorld: buildWorld,
    strobeIrradiance: strobeIrradiance, softVisibility: softVisibility, volumeCPU: volumeCPU, shadePixel: shadePixel,
    pixelValue: pixelValue, speckStats: speckStats, computeMetrics: computeMetrics, backscatterField: backscatterField
  };
});
