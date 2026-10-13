/*
 * physics.js — optical and stereo-geometry model for underwater stereo
 * photogrammetry planning with flat-port action cameras.
 *
 * Pure functions, no DOM. Works as a classic browser script (window.UWStereo)
 * and as a Node module (module.exports) so the maths can be unit-tested.
 *
 * Conventions
 *   Rig frame: origin at the midpoint of the baseline, +x along the baseline
 *   (camera A at -b/2, camera B at +b/2), +z = rig forward (toward the subject),
 *   +y = rig "up" (the sensor's vertical axis). All angles in degrees in the
 *   public API, metres for lengths, pixels for image quantities.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UWStereo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  /* ------------------------------------------------------------------ */
  /* Water                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Refractive index of (sea)water, Quan & Fry (1995) Appl. Opt. 34:3477.
   * S salinity in PSU (‰), T temperature in °C, lambda wavelength in nm.
   * Valid for 0–35 PSU, 0–30 °C, 400–700 nm. Pressure neglected
   * (≈ +1.4e-5 per bar, i.e. +0.0014 at 100 m: irrelevant for FOV).
   */
  function refractiveIndex(S, T, lambda) {
    var n0 = 1.31405, n1 = 1.779e-4, n2 = -1.05e-6, n3 = 1.6e-8, n4 = -2.02e-6,
        n5 = 15.868, n6 = 0.01155, n7 = -0.00423, n8 = -4382, n9 = 1.1455e6;
    return n0 + (n1 + n2 * T + n3 * T * T) * S + n4 * T * T +
           (n5 + n6 * S + n7 * T) / lambda + n8 / (lambda * lambda) +
           n9 / (lambda * lambda * lambda);
  }

  /* ------------------------------------------------------------------ */
  /* Flat-port refraction                                                 */
  /* ------------------------------------------------------------------ */

  /** In-air half field angle (deg, from the optical axis) -> in-water half angle (deg). */
  function refractHalfAngle(thetaAirDeg, n) {
    var s = Math.sin(thetaAirDeg * DEG) / n;
    if (s >= 1) return 90;
    return Math.asin(s) * RAD;
  }

  /** In-water half angle -> in-air half angle (deg); null beyond the critical angle. */
  function unrefractHalfAngle(thetaWaterDeg, n) {
    var s = n * Math.sin(thetaWaterDeg * DEG);
    if (s >= 1) return null;
    return Math.asin(s) * RAD;
  }

  /** Widest full field of view (deg) any flat-port camera can have under water. */
  function maxFlatPortFov(n) { return 2 * Math.asin(1 / n) * RAD; }

  /* ------------------------------------------------------------------ */
  /* Dome port: exact ray trace through a concentric spherical shell       */
  /* ------------------------------------------------------------------ */

  /** Vector Snell refraction. i: unit incident direction, nrm: unit normal pointing
   *  against i (toward the incident medium), eta = n1/n2. Returns null on total
   *  internal reflection. */
  function refractVec(i, nrm, eta) {
    var cosi = -(nrm[0] * i[0] + nrm[1] * i[1] + nrm[2] * i[2]);
    var k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) return null;
    var s = eta * cosi - Math.sqrt(k);
    return [eta * i[0] + s * nrm[0], eta * i[1] + s * nrm[1], eta * i[2] + s * nrm[2]];
  }
  /** Exit point of the ray p + t·u (t > 0) from inside a sphere of radius R centred at the origin. */
  function sphereExit(p, u, R) {
    var b = p[0] * u[0] + p[1] * u[1] + p[2] * u[2], c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - R * R;
    var disc = b * b - c; if (disc < 0) return null;
    var t = -b + Math.sqrt(disc); if (t <= 0) return null;
    return [p[0] + t * u[0], p[1] + t * u[1], p[2] + t * u[2]];
  }
  /**
   * Trace a ray leaving the entrance pupil (direction u, camera frame, z forward)
   * through a dome port into water. The dome centre is on the optical axis,
   * `port.offset` metres in front of the pupil (0 = pupil at the centre of
   * curvature, the ideal case). port = { R (outer radius), t (wall), ng (glass index), offset }.
   * Returns { dir, origin } with origin relative to the pupil, or null if the
   * ray is totally reflected.
   */
  function traceDome(u, port, nw) {
    var off = port.offset || 0;
    var p = [0, 0, -off];                       // pupil position relative to the dome centre
    var Ro = port.R, Ri = port.R - port.t;
    var q1 = sphereExit(p, u, Ri); if (!q1) return null;
    var v1 = refractVec(u, [-q1[0] / Ri, -q1[1] / Ri, -q1[2] / Ri], 1 / port.ng); if (!v1) return null;
    var q2 = sphereExit(q1, v1, Ro); if (!q2) return null;
    var v2 = refractVec(v1, [-q2[0] / Ro, -q2[1] / Ro, -q2[2] / Ro], port.ng / nw); if (!v2) return null;
    return { dir: v2, origin: [q2[0] - p[0], q2[1] - p[1], q2[2] - p[2]] };
  }
  /**
   * Paraxial virtual image formed by a dome port of an object at distance O
   * (metres from the dome centre; Infinity allowed). Returns the image distance
   * from the dome centre (positive = in front of the camera). The dome acts as a
   * negative lens: the whole water scene collapses to roughly 3–4 R.
   */
  function domeVirtualImage(O, port, nw) {
    var Ro = port.R, Ri = port.R - port.t, ng = port.ng;
    var so1 = isFinite(O) ? O - Ro : Infinity;
    var inv1 = (ng - nw) / Ro - (isFinite(so1) ? nw / so1 : 0);     // = ng / si1
    var si1 = Math.abs(inv1) < 1e-12 ? Infinity : ng / inv1;
    var so2 = isFinite(si1) ? -(si1 - port.t) : -Infinity;           // virtual object for the inner surface
    var inv2 = (1 - ng) / Ri - (isFinite(so2) ? ng / so2 : 0);        // = 1 / si2
    var si2 = 1 / inv2;
    return -si2 + Ri;
  }
  /** Object distance (from the dome centre) whose virtual image lies at `imageDist`; null if unreachable. */
  function domeObjectForImage(imageDist, port, nw) {
    if (domeVirtualImage(Infinity, port, nw) < imageDist) return null;
    var lo = port.R + 1e-4, hi = 1e4;
    if (domeVirtualImage(lo, port, nw) > imageDist) return lo;
    for (var i = 0; i < 80; i++) { var mid = Math.sqrt(lo * hi); if (domeVirtualImage(mid, port, nw) < imageDist) lo = mid; else hi = mid; }
    return hi;
  }

  /** Smallest outer dome radius (same wall and glass) whose image of infinity lies at least `dist` from the centre. */
  function minDomeRadius(dist, port, nw) {
    var lo = 0.005, hi = 2;
    for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; var img = domeVirtualImage(Infinity, { R: mid, t: Math.min(port.t, mid * 0.5), ng: port.ng }, nw); if (img < dist) lo = mid; else hi = mid; }
    return hi;
  }

  /* ------------------------------------------------------------------ */
  /* Lens projection models (r = f * g(theta))                            */
  /* ------------------------------------------------------------------ */

  var PROJ = {
    rectilinear:   { g: function (t) { return Math.tan(t); },
                     ginv: function (r) { return Math.atan(r); } },
    equidistant:   { g: function (t) { return t; },
                     ginv: function (r) { return r; } },
    stereographic: { g: function (t) { return 2 * Math.tan(t / 2); },
                     ginv: function (r) { return 2 * Math.atan(r / 2); } },
    equisolid:     { g: function (t) { return 2 * Math.sin(t / 2); },
                     ginv: function (r) { return 2 * Math.asin(Math.min(1, r / 2)); } }
  };

  /**
   * Describe a lens mode. hfov/vfov are the full in-air field angles (deg)
   * measured through the centres of the image sides; w/h the image size in px.
   * Returns the centre focal length in pixels and the corner (diagonal) angle
   * implied by the projection model.
   */
  function lensModel(mode) {
    var proj = PROJ[mode.proj || 'rectilinear'];
    var ah = mode.hfov / 2 * DEG, av = mode.vfov / 2 * DEG;
    var gx = proj.g(ah), gy = proj.g(av);
    // centre focal length (px) — from the horizontal extent
    var fpx = (mode.w / 2) / gx;
    var fpxV = (mode.h / 2) / gy;
    var cornerAngle = proj.ginv(Math.sqrt(gx * gx + gy * gy)) * RAD;
    return { fpx: fpx, fpxV: fpxV, cornerAngleAir: 2 * cornerAngle, gx: gx, gy: gy, proj: proj };
  }

  /**
   * Sample the boundary of the image (a rectangle in the projection plane)
   * and return unit ray directions in the *camera* frame (z forward, x right,
   * y up), both in air and refracted into water through a flat port.
   * nPerSide samples per side, going around the rectangle.
   */
  /** Clamp a unit direction to a maximum polar angle from +z, keeping its azimuth. */
  function capDirection(d, capRad) {
    var theta = Math.acos(Math.max(-1, Math.min(1, d[2])));
    if (theta <= capRad) return { dir: d, capped: false };
    var phi = Math.atan2(d[1], d[0]);
    return { dir: dirFromPolar(capRad, phi), capped: true };
  }

  /** Ray for normalised image coordinates (u, v in -1..1) through the chosen port.
   *  capDeg limits the usable off-axis angle: frame corners beyond it are folded
   *  back onto the cap (fisheye edges are at grazing incidence and normally masked). */
  function traceImageRay(lm, u, v, n, port, capDeg) {
    var rx = u * lm.gx, ry = v * lm.gy;
    var r = Math.sqrt(rx * rx + ry * ry);
    var thetaAir = lm.proj.ginv(r);
    var phi = Math.atan2(ry, rx);
    var air = dirFromPolar(thetaAir, phi), water, origin = [0, 0, 0];
    if (port && port.type === 'dome') {
      var tr = traceDome(air, port, n);
      if (tr) { water = tr.dir; origin = tr.origin; } else { water = dirFromPolar(Math.asin(1 / n) - 1e-4, phi); }
    } else {
      water = dirFromPolar(Math.asin(Math.min(1, Math.sin(thetaAir) / n)), phi);
    }
    var thetaWater = Math.acos(Math.max(-1, Math.min(1, water[2])));
    var cappedW = false, cappedA = false;
    if (capDeg != null && capDeg < 90) {
      var cw = capDirection(water, capDeg * DEG), ca = capDirection(air, capDeg * DEG);
      water = cw.dir; air = ca.dir; cappedW = cw.capped; cappedA = ca.capped;
    }
    return { u: u, v: v, air: air, water: water, origin: origin, cappedWater: cappedW, cappedAir: cappedA,
             thetaAir: thetaAir * RAD, thetaWater: thetaWater * RAD };
  }

  function boundaryRays(mode, n, nPerSide, port, capDeg) {
    var lm = lensModel(mode);
    var pts = [];
    var N = nPerSide || 12;
    // corners of the normalised projection-plane rectangle
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (var s = 0; s < 4; s++) {
      var a = corners[s], b = corners[(s + 1) % 4];
      for (var i = 0; i < N; i++) {
        var t = i / N;
        var u = a[0] + (b[0] - a[0]) * t;   // -1..1 across width
        var v = a[1] + (b[1] - a[1]) * t;   // -1..1 across height
        pts.push(traceImageRay(lm, u, v, n, port, capDeg));
      }
    }
    return pts;
  }

  function dirFromPolar(theta, phi) {
    return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
  }

  /* ------------------------------------------------------------------ */
  /* Small vector helpers                                                  */
  /* ------------------------------------------------------------------ */

  function rotY(v, angDeg) { // rotate about the rig's up axis (+y); positive turns +z toward +x
    var a = angDeg * DEG, c = Math.cos(a), s = Math.sin(a);
    return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  }
  function rotZ(v, angDeg) { // roll about the optical axis
    var a = angDeg * DEG, c = Math.cos(a), s = Math.sin(a);
    return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* ------------------------------------------------------------------ */
  /* Rig geometry                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * rig = { baseline, convergence (total toe-in angle, deg), roll (deg; 90 = portrait) }
   * Returns the two camera poses in the rig frame.
   */
  function cameraPoses(rig) {
    var half = rig.convergence / 2;
    return [
      { id: 'A', center: [-rig.baseline / 2, 0, 0], yaw: +half, roll: rig.roll || 0 },
      { id: 'B', center: [ rig.baseline / 2, 0, 0], yaw: -half, roll: rig.roll || 0 }
    ];
  }

  /** Transform a camera-frame direction into the rig frame. */
  function toRig(dir, pose) {
    return rotY(rotZ(dir, pose.roll), pose.yaw);
  }

  /**
   * Intersect the ray C + t d with the plane z = Z. Returns [x, y] on the plane
   * or null if the ray does not reach the plane (t <= 0 or parallel).
   */
  function hitPlane(C, d, Z) {
    if (d[2] <= 1e-9) return null;
    var t = (Z - C[2]) / d[2];
    if (t <= 0) return null;
    return [C[0] + t * d[0], C[1] + t * d[1]];
  }

  /**
   * Footprint polygon of one camera on the plane z = Z (rig frame), in water.
   * Rays missing the plane are clamped to a far distance so the polygon stays
   * closed (flagged with `clipped: true`).
   */
  function footprint(mode, pose, n, Z, nPerSide, medium, port, capDeg) {
    var rays = boundaryRays(mode, n, nPerSide, port, capDeg);
    var poly = [], clipped = false, capped = false;
    var far = Z * 50 + 1000;
    for (var i = 0; i < rays.length; i++) {
      var inAir = medium === 'air';
      if (inAir ? rays[i].cappedAir : rays[i].cappedWater) capped = true;
      var d = toRig(inAir ? rays[i].air : rays[i].water, pose);
      var o = inAir ? [0, 0, 0] : toRig(rays[i].origin, pose);
      var C = [pose.center[0] + o[0], pose.center[1] + o[1], pose.center[2] + o[2]];
      var p = hitPlane(C, d, Z);
      if (!p) {
        clipped = true;
        // push the point out along the ray's horizontal direction
        var hx = d[0], hy = d[1], hl = Math.hypot(hx, hy) || 1;
        p = [C[0] + far * hx / hl, C[1] + far * hy / hl];
      }
      poly.push(p);
    }
    var axis = hitPlane(pose.center, toRig([0, 0, 1], pose), Z) || [pose.center[0], pose.center[1]];
    return { poly: poly, clipped: clipped, capped: capped, rays: rays, axis: axis };
  }

  /* ------------------------------------------------------------------ */
  /* Polygon utilities                                                     */
  /* ------------------------------------------------------------------ */

  function polyArea(poly) {
    var a = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j][0] * poly[i][1]) - (poly[i][0] * poly[j][1]);
    }
    return Math.abs(a) / 2;
  }

  function polyBounds(poly) {
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
    return { minx: minx, maxx: maxx, miny: miny, maxy: maxy, w: maxx - minx, h: maxy - miny };
  }

  function polyCentroid(poly) {
    var cx = 0, cy = 0, a = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
    }
    if (Math.abs(a) < 1e-12) return [0, 0];
    return [cx / (3 * a), cy / (3 * a)];
  }

  /** Ensure counter-clockwise winding (positive signed area). */
  function ccw(poly) {
    var a = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j][0] * poly[i][1]) - (poly[i][0] * poly[j][1]);
    }
    return a >= 0 ? poly : poly.slice().reverse();
  }

  /** Sutherland–Hodgman: clip `subject` by the convex polygon `clip` (both CCW). */
  function clipPolygon(subject, clip) {
    var out = ccw(subject.slice());
    clip = ccw(clip);
    for (var i = 0; i < clip.length && out.length; i++) {
      var A = clip[i], B = clip[(i + 1) % clip.length];
      var input = out; out = [];
      for (var j = 0; j < input.length; j++) {
        var P = input[j], Q = input[(j + 1) % input.length];
        var pin = side(A, B, P) >= 0, qin = side(A, B, Q) >= 0;
        if (pin) out.push(P);
        if (pin !== qin) out.push(intersect(A, B, P, Q));
      }
    }
    return out;
  }
  function side(A, B, P) { return (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]); }
  function intersect(A, B, P, Q) {
    var a1 = B[1] - A[1], b1 = A[0] - B[0], c1 = a1 * A[0] + b1 * A[1];
    var a2 = Q[1] - P[1], b2 = P[0] - Q[0], c2 = a2 * P[0] + b2 * P[1];
    var det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) return P;
    return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
  }

  function isConvex(poly) {
    var sign = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      var cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-12) continue;
      if (sign === 0) sign = cr > 0 ? 1 : -1; else if ((cr > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }

  /**
   * Intersection of two camera footprints. Fisheye footprints on a plane are
   * star-shaped (around the point where the optical axis meets the plane) but
   * not convex, so B is fanned into triangles from its axis point and A is
   * clipped by each triangle; the pieces tile A ∩ B exactly. When both are
   * convex a single polygon is returned.
   */
  function intersectFootprints(A, B, axisB) {
    if (isConvex(A) && isConvex(B)) {
      var one = clipPolygon(A, B), a1 = one.length >= 3 ? polyArea(one) : 0;
      return finishOverlap(a1 > 1e-12 ? [one] : [], a1, true);
    }
    var pieces = [], area = 0;
    for (var i = 0; i < B.length; i++) {
      var tri = [axisB, B[i], B[(i + 1) % B.length]];
      if (polyArea(tri) < 1e-12) continue;
      var piece = clipPolygon(A, tri);
      if (piece.length < 3) continue;
      var a = polyArea(piece);
      if (a > 1e-12) { pieces.push(piece); area += a; }
    }
    return finishOverlap(pieces, area, false);
  }
  function pointInPoly(poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  /** Boundary of A ∩ B as a list of short segments: the parts of each boundary that lie inside the other polygon. */
  function overlapOutline(A, B, sub) {
    var segs = [], k = sub || 6;
    [[A, B], [B, A]].forEach(function (pair) {
      var P1 = pair[0], P2 = pair[1], prev = null, prevIn = false;
      for (var i = 0; i <= P1.length; i++) {
        var a = P1[i % P1.length], b = P1[(i + 1) % P1.length];
        for (var t = 0; t < k; t++) {
          var f = t / k, pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          var inside = pointInPoly(P2, pt[0], pt[1]);
          if (prev && prevIn && inside) segs.push([prev, pt]);
          prev = pt; prevIn = inside;
        }
      }
    });
    return segs;
  }
  function finishOverlap(pieces, area, convex) {
    var all = [];
    pieces.forEach(function (p) { all = all.concat(p); });
    var bounds = all.length ? polyBounds(all) : { minx: 0, maxx: 0, miny: 0, maxy: 0, w: 0, h: 0 };
    var cx = 0, cy = 0;
    pieces.forEach(function (p) { var a = polyArea(p), c = polyCentroid(p); cx += c[0] * a; cy += c[1] * a; });
    return { polys: pieces, area: area, convex: convex, bounds: bounds, centroid: area > 0 ? [cx / area, cy / area] : [0, 0] };
  }

  /* ------------------------------------------------------------------ */
  /* Analytic 1-D overlap along the baseline axis                          */
  /* ------------------------------------------------------------------ */

  /**
   * Horizontal overlap between two identical cameras with in-water half
   * field angle h (deg, in the plane containing the baseline), baseline b and
   * total convergence theta (deg), on a plane at distance Z.
   * Returns characteristic distances (m):
   *   zNear  — overlap begins (inner edge rays cross)
   *   zFull  — the two footprints coincide exactly (100 % overlap); Infinity if parallel
   *   zCross — the optical axes cross; Infinity if parallel
   *   zFar   — overlap ends (only if theta/2 > h); otherwise Infinity
   */
  function overlapDistances(h, b, theta) {
    var A = Math.tan((h + theta / 2) * DEG);
    var B = Math.tan((h - theta / 2) * DEG);
    var out = {};
    out.zNear = (h + theta / 2 >= 90) ? 0 : b / (2 * A);
    out.zCross = theta > 0 ? (b / 2) / Math.tan(theta / 2 * DEG) : Infinity;
    out.zFull = (A - B) > 1e-12 ? b / (A - B) : Infinity;
    out.zFar = B < 0 ? -b / (2 * B) : Infinity;
    out.A = A; out.B = B;
    return out;
  }

  /** Overlap width (m) and fraction of a single footprint width at distance Z. */
  function overlapAt(h, b, theta, Z) {
    var A = Math.tan((h + theta / 2) * DEG);
    var B = Math.tan((h - theta / 2) * DEG);
    var lo = Math.max(-b / 2 - Z * B, b / 2 - Z * A);
    var hi = Math.min(-b / 2 + Z * A, b / 2 + Z * B);
    var width = Math.max(0, hi - lo);
    var single = Z * (A + B);
    return { width: width, fraction: single > 0 ? width / single : 0, single: single };
  }

  /* ------------------------------------------------------------------ */
  /* Measurement precision                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Precision of a point triangulated from two cameras.
   *   P        point in the rig frame [x, y, z]
   *   centers  the two camera centres
   *   sigmaPx  image measurement precision (px, per image, 1-sigma)
   *   fpxWater centre focal length in pixels in water (≈ n × f_air)
   * Uses the per-ray angular error sigma_alpha = sigmaPx / f and the ray
   * intersection angle gamma:
   *   sigma_depth   = R·sigma_alpha / (sqrt(2)·sin(gamma/2))   (along the bisector)
   *   sigma_lateral = R·sigma_alpha / (sqrt(2)·cos(gamma/2))   (across, in the ray plane)
   * which reduces to sigma_Z = Z²·sigma_d/(f·b) with sigma_d = sqrt(2)·sigmaPx for
   * the parallel (normal) case.
   */
  function pointPrecision(P, centers, sigmaPx, fpxWater) {
    var r1 = sub(P, centers[0]), r2 = sub(P, centers[1]);
    var R1 = Math.hypot(r1[0], r1[1], r1[2]), R2 = Math.hypot(r2[0], r2[1], r2[2]);
    var R = (R1 + R2) / 2;
    var cosg = dot(r1, r2) / (R1 * R2);
    var gamma = Math.acos(Math.max(-1, Math.min(1, cosg)));
    var sa = sigmaPx / fpxWater;
    var sDepth = R * sa / (Math.SQRT2 * Math.sin(gamma / 2));
    var sLat = R * sa / (Math.SQRT2 * Math.cos(gamma / 2));
    var sVert = R * sa; // perpendicular to the ray plane: a single-ray lateral error
    return { gammaDeg: gamma * RAD, R: R, sigmaDepth: sDepth, sigmaLateral: sLat,
             sigmaVertical: sVert, sigmaAlpha: sa };
  }

  /* ------------------------------------------------------------------ */
  /* Visibility                                                            */
  /* ------------------------------------------------------------------ */

  /** Beam attenuation coefficient (1/m) from horizontal visibility (m); Duntley: V ≈ 3.9/c. */
  function attenuationFromVisibility(vis) { return 3.9 / Math.max(0.1, vis); }
  function contrastTransmittance(c, R) { return Math.exp(-c * R); }

  /* ------------------------------------------------------------------ */
  /* Full evaluation of a configuration                                    */
  /* ------------------------------------------------------------------ */

  /**
   * cfg = {
   *   mode:   { w, h, hfov, vfov, proj }          (in-air lens mode)
   *   rig:    { baseline, convergence, roll }
   *   water:  { S, T, lambda }  or { n }
   *   Z:      subject-plane distance (m)
   *   sigmaPx: image measurement precision (px)
   *   visibility: horizontal visibility (m)
   *   port:   { type: 'flat' } or { type: 'dome', R, t, ng, offset }   (metres)
   *   nearFocusAir: the lens's closest sharp distance in air (m), optional
   *   capDeg: usable off-axis angle (deg, default 65); frame corners beyond it are ignored
   * }
   */
  function evaluate(cfg) {
    var n = cfg.water.n != null ? cfg.water.n : refractiveIndex(cfg.water.S, cfg.water.T, cfg.water.lambda);
    var mode = cfg.mode, rig = cfg.rig, Z = cfg.Z;
    var port = cfg.port && cfg.port.type === 'dome' ? cfg.port : { type: 'flat' };
    var dome = port.type === 'dome';
    var capDeg = cfg.capDeg != null ? cfg.capDeg : 65;
    var lm = lensModel(mode);
    var portrait = Math.abs(((rig.roll || 0) % 180)) === 90;
    // field angles in the baseline plane (horizontal) and across it
    var hAir = portrait ? mode.vfov : mode.hfov;
    var vAir = portrait ? mode.hfov : mode.vfov;
    var hWater, vWater, dWater;
    if (dome) {
      var rh = traceImageRay(lm, 1, 0, n, port), rv = traceImageRay(lm, 0, 1, n, port), rc = traceImageRay(lm, 1, 1, n, port);
      var hw = 2 * rh.thetaWater, vw = 2 * rv.thetaWater;
      hWater = portrait ? vw : hw; vWater = portrait ? hw : vw; dWater = 2 * rc.thetaWater;
    } else {
      hWater = 2 * refractHalfAngle(hAir / 2, n);
      vWater = 2 * refractHalfAngle(vAir / 2, n);
      dWater = 2 * refractHalfAngle(lm.cornerAngleAir / 2, n);
    }

    var poses = cameraPoses(rig);
    var fpA = footprint(mode, poses[0], n, Z, 12, 'water', port, capDeg);
    var fpB = footprint(mode, poses[1], n, Z, 12, 'water', port, capDeg);
    var fpAair = footprint(mode, poses[0], n, Z, 12, 'air', null, capDeg);
    var fpBair = footprint(mode, poses[1], n, Z, 12, 'air', null, capDeg);
    var ov = intersectFootprints(fpA.poly, fpB.poly, fpB.axis);
    var areaA = polyArea(fpA.poly), areaOv = ov.area;
    var bA = polyBounds(fpA.poly), bOv = ov.bounds;

    var hUse = Math.min(hWater / 2, capDeg);   // usable half angle in the baseline plane
    var od = overlapDistances(hUse, rig.baseline, rig.convergence);
    var o1 = overlapAt(hUse, rig.baseline, rig.convergence, Z);

    // a flat port multiplies the focal length by n; a centred dome leaves it unchanged
    var fpxWater = dome ? lm.fpx : lm.fpx * n;
    var focus = { nearFocusAir: cfg.nearFocusAir || null };
    if (dome) {
      focus.imageOfPlane = domeVirtualImage(Z, port, n);
      focus.imageOfInfinity = domeVirtualImage(Infinity, port, n);
      focus.minDomeRadiusForInfinity = cfg.nearFocusAir ? minDomeRadius(cfg.nearFocusAir, port, n) : null;
      focus.nearestSharp = cfg.nearFocusAir ? domeObjectForImage(cfg.nearFocusAir, port, n) : null;
    } else {
      focus.imageOfPlane = Z / n;
      focus.imageOfInfinity = Infinity;
      focus.nearestSharp = cfg.nearFocusAir ? cfg.nearFocusAir * n : null;
    }
    var prec = pointPrecision([0, 0, Z], [poses[0].center, poses[1].center], cfg.sigmaPx, fpxWater);
    var gsd = Z / fpxWater; // m per pixel at the plane centre (paraxial)
    var disparity = fpxWater * rig.baseline / Z;

    var c = attenuationFromVisibility(cfg.visibility);

    return {
      n: n, lens: lm, fpxWater: fpxWater, port: port, focus: focus,
      fov: { hAir: hAir, vAir: vAir, dAir: lm.cornerAngleAir, hWater: hWater, vWater: vWater, dWater: dWater,
             maxFlatPort: maxFlatPortFov(n), capDeg: capDeg, hUsable: 2 * hUse, vUsable: 2 * Math.min(vWater / 2, capDeg) },
      capped: fpA.capped,
      poses: poses,
      footprints: { A: fpA, B: fpB, Aair: fpAair, Bair: fpBair, overlap: ov },
      areas: { single: areaA, overlap: areaOv, fraction: areaA > 0 ? areaOv / areaA : 0 },
      size: { single: bA, overlap: bOv },
      distances: od,
      overlap1d: o1,
      precision: prec,
      gsd: gsd,
      disparity: disparity,
      ratioBZ: rig.baseline / Z,
      attenuation: c,
      contrast: contrastTransmittance(c, Z)
    };
  }

  return {
    DEG: DEG, RAD: RAD,
    refractiveIndex: refractiveIndex,
    refractHalfAngle: refractHalfAngle,
    unrefractHalfAngle: unrefractHalfAngle,
    maxFlatPortFov: maxFlatPortFov,
    PROJ: PROJ,
    lensModel: lensModel,
    refractVec: refractVec,
    traceDome: traceDome,
    domeVirtualImage: domeVirtualImage,
    domeObjectForImage: domeObjectForImage,
    minDomeRadius: minDomeRadius,
    traceImageRay: traceImageRay,
    capDirection: capDirection,
    boundaryRays: boundaryRays,
    cameraPoses: cameraPoses,
    toRig: toRig,
    footprint: footprint,
    polyArea: polyArea,
    polyBounds: polyBounds,
    polyCentroid: polyCentroid,
    clipPolygon: clipPolygon,
    isConvex: isConvex,
    pointInPoly: pointInPoly,
    overlapOutline: overlapOutline,
    intersectFootprints: intersectFootprints,
    overlapDistances: overlapDistances,
    overlapAt: overlapAt,
    pointPrecision: pointPrecision,
    attenuationFromVisibility: attenuationFromVisibility,
    contrastTransmittance: contrastTransmittance,
    evaluate: evaluate
  };
});
