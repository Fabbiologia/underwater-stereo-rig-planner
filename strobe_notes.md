# Strobe Lighting Lab: physics, data and calibration notes

Notes behind `strobes.html` (the "Strobe lighting lab" tab). The page renders the photograph a camera would take with one or two underwater strobes, for a chosen kit, scene and water, and reports exposure, evenness, backscatter haze, bright specks, shadows and colour loss. Written for the MRes advanced underwater photography practical (University of Plymouth). Compiled 23 October 2026.

## 1. What is modelled

| Light path | Model | Where |
|---|---|---|
| Strobe → subject → lens | beam profile × inverse square × e^(−c·D) × Lambert (+ weak specular) × e^(−c·R); soft shadows from 8–16 rays to the strobe's emitting window | `strobeLight()` in the shader, `shadePixel()` on the CPU |
| Strobe → water → lens (haze) | single scattering: L_bs = ∫ b·p(ψ)·E(x)·e^(−c·r) dr, 40 steps packed near the port, optional in-water shadows | `volume()`, `volumeCPU()` |
| Strobe → particle → lens (specks) | marine-snow particles in 16 log-spaced depth slices, lit like the haze, drawn as defocus discs | `particles()`, `speckStats()` |
| Sun → water → subject / background | E_d(z) = E₀·e^(−K_d·z) with Kirk's K_d; Koschmieder blend toward an approximate horizontal background radiance | `ambientAt()`, `background()` |

Not modelled: multiple scattering and forward-scatter blur (important beyond 2–3 attenuation lengths), lens vignetting, measured strobe beam profiles, spectral detail beyond three bands, depth of field of the scene (only the particles are defocused).

## 2. Equations and constants

**Camera and port.** Rays start at the entrance pupil. Flat port: in-air pinhole ray refracted at the glass, sin θ_w = sin θ_a / n. Dome centred on the pupil: undeviated. Fisheye: equisolid r = 2f·sin(θ/2). Wet wide lens: rectilinear with the quoted in-water field.

**Strobe beam.** B(θ, φ) = exp(−ln2·(θ/θ_h(φ))^p), θ_h = half the quoted beam angle on an ellipse between horizontal and vertical, p = 2 for diffused heads and 2.6 for a bare reflector, with a smooth cut-off reaching zero at 92–100°. INON does not publish the threshold behind its beam angles or any intensity curve; independent tests describe the Z-330 beam as a bright centre with a gentle, smooth roll-off, which this shape follows.

**Output from the guide number.** I = 10π·GN² / (0.18 · 0.65 · 100) cd·s, so that f-number = GN / distance gives a correct exposure on an 18 % grey card in air at ISO 100 (checked in the unit tests). In water the beam is concentrated by n² and the port costs the camera 1/n² (radiance is conserved as L/n²); both are applied and cancel for strobe light.

**Exposure.** pixel value = 0.018 · q · ISO / N² · L · t with q = 0.65, so mid grey = 0.18 (ISO 12232 standard output sensitivity); strobe light uses luminance-time, daylight luminance × shutter time. Film-like tone curve (ACES fit) and sRGB output. Auto power mimics TTL: one EV shift applied to all strobes so the mean subject value equals its reflectance (centre-weighted when the subject is tiny). In S-TTL the shift may go 2.5 EV below the lowest manual step (assumption: INON does not publish the S-TTL minimum).

**Water.** Three bands (≈ 600, 540, 465 nm), c = a + b. Pure-water absorption from Pope & Fry (1997): 450 nm 0.0092, 500 nm 0.0204, 550 nm 0.0565, 600 nm 0.2224, 650 nm 0.340 m⁻¹, weighted over broad camera bands and topped up with phytoplankton and CDOM absorption for coastal water. Particle scattering ∝ λ^−0.5. Horizontal visibility V = 4.8 / c (Zaneveld & Pegau 2003); the visibility slider sets c and so b. Refractive index from Quan & Fry (1995). K_d = √(a² + 0.264·a·b) / 0.85 (Kirk 1984).

| Preset | a (R/G/B, m⁻¹) | b (m⁻¹) | c green | Visibility | Specks per L |
|---|---|---|---|---|---|
| Clear tropical reef | 0.32 / 0.065 / 0.022 | 0.08 | 0.145 | 33 m | 0.2 |
| Temperate shelf, good day | 0.36 / 0.09 / 0.10 | 0.30 | 0.39 | 12 m | 1 |
| Plymouth Sound, typical | 0.42 / 0.14 / 0.22 | 0.82 | 0.96 | 5 m | 5 |
| Plymouth Sound, murky day (default) | 0.45 / 0.16 / 0.26 | 1.44 | 1.60 | 3 m | 10 |
| Turbid estuary or harbour | 0.65 / 0.38 / 0.65 | 2.8 | 3.18 | 1.5 m | 20 |

For comparison, Petzold (1972) measured c(530 nm) = 0.151 (clear, Bahamas), 0.398 (coastal) and 2.19 m⁻¹ (San Diego Harbor). Near station L4 suspended matter is usually under 0.5 mg/L, rising to 1–5 mg/L after rain or dredging; the lower Tamar carries 20 mg/L and up to 150–200 mg/L on spring tides. With about 0.5 m²/g of particle attenuation, that is c ≈ 0.3–0.8 m⁻¹ (6–16 m visibility) at L4 and c ≈ 2.7 m⁻¹ (about 2 m) near the Tamar mouth.

**Phase function.** Fournier–Forand with n = 1.10, μ = 3.5835:

```
β̃(ψ) = 1/[4π(1−δ)²δ^ν] · { ν(1−δ) − (1−δ^ν) + [δ(1−δ^ν) − ν(1−δ)] / sin²(ψ/2) }
       + (1 − δ₁₈₀^ν) / [16π(δ₁₈₀ − 1)δ₁₈₀^ν] · (3cos²ψ − 1)
ν = (3 − μ)/2,  δ = 4 sin²(ψ/2) / [3(n − 1)²]
```

It integrates to 1.0000, gives b_b/b = 0.0183 (the Petzold average), has its minimum near 130° and rises 12 % toward 180°. It is tabulated in 512 steps of √(ψ/π) and shared by the CPU and GPU code.

**Particles.** Marine-snow aggregates of 0.5–5 mm diameter, n(a) ∝ a⁻³, at the chosen number per litre (published abundances: 0.1–1 per L in the open North Atlantic, 1–60 per L in coastal waters; Simon et al. 2002). Scattering cross-section 0.6·πa² with the particle phase function, giving a backscatter efficiency of about 0.01, appropriate for porous aggregates barely denser than water. Defocus blur diameter = D_pupil · |1/s_app − 1/s_focus,app| with apparent (virtual-image) distances behind the flat or dome port. Speck counts are computed for a picture viewed 1200 px wide, because a sub-pixel speck's apparent brightness depends on the viewing size.

## 3. Strobe and camera data

| | INON Z-330 | INON S-2000 bare | S-2000 + −0.5 white diffuser |
|---|---|---|---|
| GN (air, ISO 100, m, full power) | 33 | 20 | 17 |
| Beam | 110° × 110° circular, underwater nominal | 105° × 95° | 110° × 110° circular |
| Colour temperature | 5500 K (5400 K with SOFT filter) | 5500 K | 5400 K |
| Manual power | 13 steps of ½ EV, down to −6 EV (GN 4.1) | 12 steps of ½ EV, down to −5.5 EV (GN 3.0) | same |
| Size, weight | Ø102 × 131 × 125 mm, 637 g | Ø64 × 83 × 107 mm, 295 g | |
| Emitting window radius used | 36 mm (estimate) | 22 mm (estimate) | 26 mm (estimate) |

Sources: INON specification pages and manuals (links in `strobe-content.js`). The Z-330's bundled SOFT dome filter costs about 0.3 EV and does not widen the beam.

Canon PowerShot G9 X Mark II: 1.0-type sensor 13.2 × 8.8 mm, 10.2–30.6 mm (28–84 mm equivalent), f/2.0–f/11 at wide, close focus 5 cm. Housings: Fantasea FG9X or Ikelite 6245.09 (flat port, M67 thread). INON UWL-H100 28LD wet lens: 100.8° maximum field in water.

## 4. Validation (unit tests in Node, all passing)

- Phase function: integral above 0.05° = 0.9544 (the raw function integrates to 1.0000; 4.6 % of the mass is the extreme forward peak); backward fraction 0.0183 by numerical integration and by the closed form.
- Exposure calibration: GN 33 at 2 m and f/16.5, ISO 100, gives exactly 0.18 on an 18 % card in air.
- Beam: relative intensity 0.5 at 55° (Z-330, both axes) and at 52.5° H / 47.5° V (S-2000 bare).
- Lens fields under water: G9 X II wide 47.8° × 34.4° behind a flat port; 16 mm behind a dome 96.7° × 73.7°; 15 mm fisheye 147.5° × 94.3°.
- In the browser (sea-fan scene, full-frame kit with two Z-330s, 5 m visibility, subject at 1 m):

| Placement | Haze over subject | Bright specks | Half the haze made within | TTL power |
|---|---|---|---|---|
| Beside the port, aimed straight ahead | 24 % | 66 | 20 cm | −3.0 EV |
| 10 and 2 o'clock, aimed at the subject | 21 % | 33 | 19 cm | −2.8 EV |
| Far out and behind the port, beams parallel | 11 % | 33 | 27 cm | −1.8 EV |
| Out, back and angled out (edge lighting) | 8 % | 17 | 35 cm | −1.5 EV |

In the default murky-day water the same comparison is much starker: haze over the subject is about 110 % (brighter than the subject itself) with the strobes beside the port, 90 % at 10 and 2 o'clock and 30 % with edge lighting. The photograph's optional "backscatter shown 3× or 10× stronger" setting multiplies only the scattered light (haze and specks) in the rendered image, for demonstrations in clearer water; the photo is labelled when it is on, and all numbers stay unscaled.

## 5. Practical rules used for the advice

- Keep the beams out of the water in front of the port: strobes out to the side and no further forward than the handles; for wide angle behind the port (Peterson, Underwater Photography Guide).
- Strobe spacing about equal to the subject distance (same source).
- Edge lighting: light the subject with the inner edge of the beam.
- Close-focus wide angle under 60 cm: strobes within about 20 cm of the dome and behind it, slightly inward for subjects under 30 cm; lower strobe two stops down in vertical shots (Mustard).
- Lights next to the camera work to about one attenuation length; well-separated lights to two or three (Jaffe 1988, 1990; Jaffe et al. 2001).
- The rule of keeping the subject within a quarter to a third of the visibility is a widely used rule of thumb; no peer-reviewed source was found.

## 6. References

Jaffe 1990 (doi:10.1109/48.50695); Jaffe 2015 (doi:10.1109/JOE.2014.2350751); Jaffe et al. 2001 (doi:10.5670/oceanog.2001.24); McGlamery 1980 (doi:10.1117/12.958279); Treibitz & Schechner 2009 (doi:10.1109/TPAMI.2008.85); Petzold 1972 (SIO Ref. 72-78); Fournier & Forand 1994 (doi:10.1117/12.190063); Pope & Fry 1997 (doi:10.1364/AO.36.008710); Quan & Fry 1995 (doi:10.1364/AO.34.003477); Zaneveld & Pegau 2003 (doi:10.1364/OE.11.002997); Kirk 1984 (doi:10.4319/lo.1984.29.2.0350); Simon et al. 2002 (doi:10.3354/ame028175); Peterson 2017 (Underwater Photography Guide); Mustard, close-focus wide-angle guide (DivePhotoGuide); Backscatter.com strobe placement guide; INON Z-330 and S-2000 specifications and manuals.
