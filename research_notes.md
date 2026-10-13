# Underwater stereo photogrammetry with action cameras: optics, geometry and camera data

Research notes behind the *Underwater Stereo Rig Planner* (`index.html`, maths in `physics.js`, camera database in `cameras.js`). Compiled 13 October 2026 from manufacturer documents and peer-reviewed sources; every number in the planner traces back to a section here.

## 1. Summary of the design rules

1. **Behind a flat port the field of view (FOV) shrinks by Snell's law**: a lens with in-air half angle θ sees only `asin(sin θ / n)` in water. No flat-port camera can see more than `2·asin(1/n) ≈ 97°` under water, so the 155° DJI lens and the 156° GoPro "Wide" lens both end up at about 93–95° diagonal, and a 92° GoPro Linear lens at about 70°.
2. **The focal length is multiplied by n ≈ 1.34 on axis**; the image scale, disparity and ground sampling distance all change accordingly, and the fixed-focus distance moves out by the same factor (GoPro ≈ 0.40 m, DJI ≈ 0.47 m under water).
3. **Overlap is governed by three distances**: Z_near where the fields start to overlap, Z_full where the two footprints coincide (only with convergence), and Z_cross where the axes cross. Beyond Z_full the overlap fraction decreases again; without convergence it only tends to 100 % at infinity.
4. **Depth precision follows σ_Z = Z² σ_d / (f b)**: it degrades with the square of the distance and improves linearly with baseline and focal length. The ray-intersection angle γ = 2·atan(b/2Z) is the single best design number: 10–40° balances precision and automatic matching; below 5° the geometry is weak; above about 45° feature matching suffers.
5. **Published rigs sit in a narrow band**: 0.7 m baseline converged 7° for the stereo-BRUV standard; 0.5 m / 5° for compact rigs; 1.4 m / 8.5° for the original Harvey & Shortis system at 5 m range; 0.25 m parallel GoPro pairs for close-range mapping. Baselines of 150 mm give poor precision beyond 6 m (Boutros et al. 2015).
6. **Visibility limits range harder than optics**: contrast decays as e^(−cZ) with c ≈ 3.9/visibility; reef photogrammetry is flown at 1–3 m even in clear water, with 60–80 % overlap.
7. **Calibrate in water, at the working distance, with the port and lens cover that will be used**; the flat port adds pincushion distortion and lateral colour that no in-air calibration captures. Switch stabilisation off.
8. **A dome port keeps the in-air field but moves focus to 3–4 R in front of the dome**: with the fixed-focus action cameras only domes of roughly 80–90 mm radius or more keep distant subjects sharp, and close subjects need a dioptre. The planner traces rays through the dome and reports the virtual-image distances so the two ports can be compared side by side.

## 2. Flat-port optics

### 2.1 Refraction and the FOV limit

At a plane water–glass–air interface the glass is a parallel plate and drops out of the angle calculation, so `n_w · sin θ_w = sin θ_a`. A lens whose in-air field is `2θ_a` therefore covers, under water,

```
FOV_water = 2 · asin( sin(FOV_air / 2) / n_w )
```

With n_w = 1.34: 90° → 64°, 122° → 81°, 155° → 93°, and the asymptote is `2·asin(1/1.34) = 96.5°` (97.2° for fresh water at 1.333). Menna et al. (2016) give the same 96° limit and note that rays steeper than ~48° in water are totally reflected. The planner refracts every boundary ray of the image individually (polar angle from the optical axis), which is why the in-water frustum of a fisheye-type mode has rounded corners.

### 2.2 Scale, apparent distance and focus

Near the axis `dθ_a/dθ_w = n_w`, so the port behaves like a 1.34× teleconverter: Shortis (2015) measured an in-water principal distance 1.34× the in-air value for two GoPro HERO4 cameras; Shortis & Harvey (1998) report 7.5 mm in air → 10 mm in water. An object at distance Z appears at Z/n_w (Mertens 1970), so a lens that focuses down to d in air focuses down to n_w·d in water, and depth of field shrinks.

### 2.3 Distortion and colour

Because `θ_a = asin(n sin θ_w)` grows faster than linearly, the port adds a **pincushion-type radial distortion** on top of the lens's own barrel distortion, plus **lateral chromatic aberration** from the dispersion of water (up to a few pixels for GoPro, Helmholz & Lichti 2019). The entrance pupil is not a single point for refracted rays (Treibitz et al. 2012), so a pinhole model absorbs the port into the distortion terms and is only valid near the distance it was calibrated at (Shortis 2015). The Pinax model (Łuczyński et al. 2017) exploits the small lens-to-port distance to keep a pinhole-like model that is corrected explicitly for salinity-dependent n.

### 2.4 Dome ports

A dome port centred on the entrance pupil leaves the field of view unchanged, but acts as a negative lens: an object at infinity is imaged at ≈4R from the dome centre, so for an 8 cm dome the 1 m–∞ range collapses to 17–23 cm in front of the glass and the lens must focus close (Menna et al. 2016). Menna, Nocerino & Remondino (2017) found flat ports gave higher image residuals and lower object-space precision than domes. Neither action camera uses a dome natively; both their lens covers and their 60 m housings are flat windows, but third-party dome accessories exist for both.

The planner models the dome as a concentric shell of outer radius R, wall t and index n_g. Every image boundary ray is traced exactly from the entrance pupil (optionally displaced from the centre of curvature) through both spherical surfaces with vector Snell refraction, which gives the in-water frustum; with the pupil at the centre the field is identical to the in-air field, and with an offset pupil a mild field change and radial distortion appear. Focus is handled paraxially with two spherical refracting surfaces:

```
n_w/(O − R) + n_g/s₁ = (n_g − n_w)/R           (water → glass, outer surface)
n_g/s₂ + 1/s₃ = (1 − n_g)/(R − t),  s₂ = −(s₁ − t)   (glass → air, inner surface)
virtual image distance from the dome centre = −s₃ + (R − t)
```

Worked values (acrylic, n_g = 1.49, t = 4 mm, seawater n_w = 1.34): a 6-inch dome (R = 76 mm) images infinity at 279 mm and a 1 m subject at about 250 mm from the centre; the GoPro's ≈ 300 mm near focus therefore needs R ≥ 81 mm just for infinity to be sharp, and even an 8-inch dome (R = 100 mm) only renders subjects beyond ≈ 1.1 m sharply. For close-range photogrammetry with a fixed-focus action camera a dome therefore needs a close-up (dioptre) lens; otherwise the flat port, despite its 1.34× field loss, is the workable choice. The dome's other trade-offs: no port-induced pincushion or lateral colour, but the 1.34× focal gain of the flat port is lost (coarser GSD and depth precision at the same distance), and at f/2.5–2.8 the strongly curved virtual image leaves frame corners soft.

## 3. Refractive index of water

Quan & Fry (1995), *Applied Optics* 34:3477, valid for 0–35 ‰, 0–30 °C, 400–700 nm (±1.5·10⁻⁵):

```
n(S,T,λ) = n0 + (n1 + n2·T + n3·T²)·S + n4·T² + (n5 + n6·S + n7·T)/λ + n8/λ² + n9/λ³
n0 = 1.31405   n1 = 1.779e-4   n2 = -1.05e-6   n3 = 1.6e-8   n4 = -2.02e-6
n5 = 15.868    n6 = 0.01155    n7 = -0.00423   n8 = -4382    n9 = 1.1455e6
(S in ‰ ≈ PSU, T in °C, λ in nm)
```

| Water | n (550 nm) |
|---|---|
| Fresh, 20 °C | 1.3343 |
| Seawater 35 PSU, 20 °C | 1.3408 |
| Seawater 35 PSU, 20 °C, 450 nm / 650 nm | 1.3459 / 1.3377 |

Sensitivities: +2·10⁻⁴ per PSU, −2·10⁻³ from 10 °C to 30 °C, +1.5·10⁻³ per 100 bar (Millard & Seaver 1990, not in the equation and ignored in the planner). For FOV planning these are all negligible; the planner exposes them because they also set the calibration-transfer error between pool and sea.

## 4. Stereo geometry

### 4.1 Overlap distances

Rig frame: cameras at x = ∓b/2, both pointing along +z, each toed in by θ/2 toward the centre; in-water half angle in the plane of the baseline h = FOV_water,H / 2. On a plane at distance Z each camera covers `[∓b/2 − Z·tan(h ∓ θ/2), ∓b/2 + Z·tan(h ± θ/2)]`. Writing A = tan(h + θ/2), B = tan(h − θ/2):

| Quantity | Formula | Meaning |
|---|---|---|
| Z_near | b / (2A) | inner edges cross; overlap begins |
| Z_full | b / (A − B) | the two footprints coincide (100 % overlap); ∞ if θ = 0 |
| Z_cross | b / (2·tan(θ/2)) | optical axes cross; ∞ if θ = 0 |
| Z_far | b / (2·tan(θ/2 − h)) | overlap ends again, only if θ/2 > h |
| overlap fraction, Z_near < Z < Z_full | (2ZA − b) / (Z(A + B)) | rising |
| overlap fraction, Z > Z_full | (b + 2ZB) / (Z(A + B)) | falling toward 2B/(A + B) |

Z_full is nearer than Z_cross because a toed-in camera's footprint is asymmetric about its axis. The 3-D view intersects the refracted frustums with the plane and clips the two polygons (Sutherland–Hodgman), so its area fraction includes the keystone of toe-in; the chart uses the centreline width fraction above.

### 4.2 Depth precision

For two rays meeting at angle γ, each with angular uncertainty σ_α = σ_px / f_px,water:

```
σ_depth   = R·σ_α / (√2·sin(γ/2))        along the bisector
σ_lateral = R·σ_α / (√2·cos(γ/2))        across, in the plane of the rays
γ = 2·atan(b / 2Z) for a point on the rig axis
```

For small γ this is the textbook `σ_Z = Z²·σ_d / (f·b)` with disparity precision σ_d = √2·σ_px (Dall'Asta et al. 2015 Eq. 1; Luhmann's `σ_Z = (h/b)(h/c)σ_x′`). Convergence does not change γ for a given point; it changes which points both cameras see. Values are single-pair, 1-σ; bundle adjustment over many images does better, but the Z² and 1/b trends hold.

Image precision σ_px: Shortis (2015) reports 0.1–0.3 px underwater after calibration; GoPro video frames give larger residuals than DSLRs (Nocerino et al. 2019). The planner defaults to 0.5 px; 1 px reproduces the few-millimetre check-point errors published for GoPro rigs at 2 m (Nocerino et al. 2019: RMSE 3.6 mm at 2 m with GSD 1.2 mm).

### 4.3 Intersection angle and matching

Precision is isotropic near γ = 90°, but matching performance drops for large intersection angles and surfaces tilted more than ~20° to the view (Wenzel et al. 2013; 3–7° angles gave noisy surfaces). SIFT-type features are reliable within ~30° of viewpoint change (Lowe 2004). Shortis & Harvey (1998): "a more acute convergence would improve the measurement precision, but will decrease the useable field of view and increase the apparent perspective distortion." Hence the planner's 10–40° window.

### 4.4 Published rig configurations

| Source | Baseline | Convergence | Range | Result |
|---|---|---|---|---|
| Shortis & Harvey 1998 | 1.4 m | 8.5° inward | 5 m | a-priori 3 mm lateral / 22 mm depth (95 %); measured ±4 mm; 2–4 % of length |
| Langlois et al. 2020 (stereo-BRUV standard) | 0.70 m (two GoPro HERO5) | 7° | 2–8 m | 0.5 m / 5° "also common" |
| Boutros, Shortis & Harvey 2015 | 0.15 / 0.40 / 0.80 m | — | ≤ 8 m | 0.8 m most accurate; 0.15 m poor beyond 6 m; precision ∝ 1/baseline |
| Harvey et al. 2010 | HD stereo | — | ≤ 5 m | ~1 % length error; < 50 mm targets unmeasurable beyond 5 m |
| Del Pizzo et al. 2024 | 0.249 m (two GoPro 11, parallel) | 0° | close range | baseline identical in air and pool; 0.34 mm scale-bar error over 43 cm |

Reef SfM practice (single moving camera, so the "baseline" is the distance swum between exposures): Burns et al. 2015 (≈3 m altitude, 70–80 % overlap, 1.09 mm/px); Bayley & Mogg 2020 (1–2 m, 50–75 % sequential overlap, spiral better than lawn-mower in low visibility); NOAA SOP (Suka et al. 2019: 60 % side, 80 % forward overlap); Raoult et al. 2016 (GoPro HERO3 stills at 2 Hz, > 60 % overlap, 1.2 mm/px); Young et al. 2017 (GoPro at 0.5–1 m, 60–80 % overlap, RMSE ≈ 1.4 cm). The planner's "single moving camera" helper converts swim speed × interval into the equivalent baseline.

## 5. Visibility

Horizontal visibility V of a dark target relates to the beam attenuation coefficient c by V ≈ 3.9/c (Duntley), and contrast decays as e^(−cZ). Jerlov oceanic types I–III have K_d(490) ≈ 0.035–0.14 m⁻¹ and visibilities of tens of metres; coastal types 1–9 drop below 2 m. No peer-reviewed "fraction of visibility" rule exists; practitioners keep the subject within a quarter to a third of the visibility, and Capra (1992) noted that average visibility does not permit adequate illumination and resolution beyond 3–4 m. The planner shows the contrast transmittance at Z and warns below 25 %.

## 6. Camera data

### 6.1 GoPro HERO13 Black

| Item | Value | Source |
|---|---|---|
| Sensor | 1/1.9" CMOS, native 8:7, 27.6 MP (5599 × 4927 active) | GoPro tech specs |
| Physical size / pitch | ≈ 6.3 × 5.5 mm (DPReview); pitch ≈ 1.12 µm (derived) | DPReview HERO12 review |
| Lens | f/2.5, ≈ 2.7 mm, 12–39 mm equivalent across digital lenses | GoPro; DPReview |
| Lens cover | flat, replaceable hydrophobic Gorilla Glass | GoPro |
| Waterproof | 10 m bare; 60 m in Protective Housing (flat glass port) | GoPro |
| Focus | fixed; soft closer than ≈ 30 cm (Backscatter) | Backscatter guide |
| Lens mods | Ultra Wide (177°), Macro, Anamorphic: not intended for underwater use | GoPro |
| Photo | 27 MP 5568 × 4872 (8:7), Wide or Linear | GoPro |
| Video | 5.3K 8:7 5312 × 4648 (≤ 30 fps); 5.3K 16:9 5312 × 2988 (≤ 60); 4K 8:7 3840 × 3360 (≤ 60); 4K 16:9 3840 × 2160 (≤ 120); 2.7K 4:3 2704 × 2028 (≤ 120) | GoPro |

GoPro's published digital-lens angles (H / V / D, HyperSmooth off; the HERO13 table equals the HERO12 and HERO11 tables, same sensor and lens):

| Digital lens | 16:9 | 4:3 | 8:7 |
|---|---|---|---|
| Wide | 118 / 69 / 133 | 120 / 92 / 146 | 122 / 108 / 156 |
| Linear | 92 / 61 / 100 | 92 / 76 / 105 | — (derived 92 / 84 / 108) |
| SuperView, HyperView | 121 / 93 / 148, 122 / 108 / 151 | stretched, not rectilinear: unsuitable for measurement | |

Model fit: Linear is exactly rectilinear with a 92° horizontal field (the published V and D for 16:9 and 4:3 follow from the aspect ratio to within 1°). Wide fits an equidistant fisheye (r = f·θ): the published V/H ratios match the aspect ratios, while the published diagonals are 4–7° narrower than the model predicts, probably corner vignetting in GoPro's estimates; under water the difference is < 1.5°. Photo-mode angles are not published; the planner uses the 8:7 video values (the 27 MP frame is ~5 % wider than the 5.3K 8:7 frame, so the true photo field is marginally wider).

Underwater: GoPro publishes nothing. INON states the HERO11 narrows from ≈ 156° to ≈ 94° in the dive housing, matching the Snell-law value (95°). Menna, Nocerino & Remondino (2017) make the same point for GoPro fisheye lenses behind flat ports.

### 6.2 DJI Osmo Action 5 Pro

| Item | Value | Source |
|---|---|---|
| Sensor | 1/1.3" CMOS, native 4:3, stills 7296 × 5472 (≈ 40 MP) | DJI specs |
| Pitch | DJI quotes "2.4 µm equivalent" (2 × 2 binned); native ≈ 1.2 µm, active area ≈ 8.8 × 6.6 mm (derived; the Action 4's 3648 × 2736 is exactly the binned frame) | DJI store; derivation |
| Lens | FOV 155° (diagonal, DJI forum admin), f/2.8, focus 0.35 m–∞ (Action 4: 0.4 m) | DJI specs, FAQ, forum |
| Equivalent focal length | Ultra-Wide ≈ 9 mm, Wide ≈ 10 mm, Standard ≈ 14 mm (DJI admin, Action 4, EIS off) | DJI forum |
| Lens cover | flat screw-on glass, ≈ 32 × 32 × 4.5 mm, user-replaceable | DJI FAQ, manual |
| Waterproof | 20 m bare (IP68), 60 m in the Waterproof Case (flat window) | DJI |
| Video | 4K 4:3 3840 × 2880 (≤ 120 fps); 4K 16:9 3840 × 2160 (≤ 120); 2.7K 4:3 2688 × 2016 (≤ 120); 1080p (≤ 240) | DJI specs |
| FOV settings | Ultra Wide 155°, Wide 155°, Standard (Dewarp) 126° diagonal with RockSteady off; only Standard is distortion-corrected; stabilised values (A4: 146° / 140° / 116°) crop further | DJI forum admin replies |

DJI publishes only diagonals, so the planner derives horizontal and vertical angles. For the only DJI fisheye with an independent measurement (original Osmo Action, 145° diagonal spec, 112.1° measured horizontal) an equisolid projection (r = 2f·sin(θ/2)) predicts 113°, equidistant 116°, stereographic 122°; equisolid is therefore used for Ultra-Wide/Wide: 155° diagonal → ≈ 120° × 88° (4:3), 120° × 65° (16:9 crop). Standard (Dewarp) is treated as rectilinear: 126° diagonal → 115° × 99° (4:3), 115° × 83° (16:9). Treat these as ±5° until measured. Two further caveats: DJI's "Standard ≈ 14 mm equivalent" would imply a 114° diagonal rather than 126°, so the two DJI statements disagree by ~10°; and whether Ultra-Wide applies to 40 MP stills (menus show "Standard (Dewarp)" in photo mode) is unconfirmed. No underwater FOV measurements exist for the Action 4/5 Pro; divers report Ultra-Wide/Wide "too wide to avoid distortion behind a flat port" and prefer Standard (Dewarp). The camera has a colour-temperature sensor used for underwater white balance and auto-records below 1 m depth.

### 6.3 Modelled in-water fields (seawater 35 PSU, 22 °C, 550 nm, n = 1.3406)

| Camera / mode | Pixels | In air H × V (diag) | In water H × V (diag) | f_px (air) | Frame at 2 m | GSD at 2 m |
|---|---|---|---|---|---|---|
| GoPro Photo 8:7 Wide | 5568 × 4872 | 122 × 108 (156) | 81 × 74 (95) | 2615 | 3.45 × 3.05 m | 0.57 mm |
| GoPro Photo 8:7 Linear | 5568 × 4872 | 92 × 84 (108) | 65 × 60 (74) | 2688 | 2.54 × 2.30 m | 0.55 mm |
| GoPro 5.3K 8:7 Wide | 5312 × 4648 | 122 × 108 (156) | 81 × 74 (95) | 2495 | 3.45 × 3.05 m | 0.60 mm |
| GoPro 5.3K 16:9 Wide | 5312 × 2988 | 118 × 69 (133) | 79 × 50 (88) | 2579 | 3.33 × 1.95 m | 0.58 mm |
| GoPro 5.3K 16:9 Linear | 5312 × 2988 | 92 × 61 (100) | 65 × 44 (70) | 2565 | 2.54 × 1.64 m | 0.58 mm |
| GoPro 4K 8:7 Wide | 3840 × 3360 | 122 × 108 (156) | 81 × 74 (95) | 1803 | 3.45 × 3.05 m | 0.83 mm |
| GoPro 4K 16:9 Linear | 3840 × 2160 | 92 × 61 (100) | 65 × 44 (70) | 1854 | 2.54 × 1.64 m | 0.80 mm |
| GoPro 2.7K 4:3 Wide (120 fps) | 2704 × 2028 | 120 × 92 (146) | 80 × 65 (93) | 1291 | 3.39 × 2.60 m | 1.16 mm |
| DJI Photo 4:3 Ultra-Wide | 7296 × 5472 | 120 × 88 (155) | 80 × 62 (93) | 3648 | 3.42 × 2.57 m | 0.41 mm |
| DJI Photo 4:3 Standard (Dewarp) | 7296 × 5472 | 115 × 99 (126) | 78 × 69 (83) | 2324 | 3.24 × 2.75 m | 0.64 mm |
| DJI 4K 4:3 Ultra-Wide | 3840 × 2880 | 120 × 88 (155) | 80 × 62 (93) | 1920 | 3.42 × 2.57 m | 0.78 mm |
| DJI 4K 4:3 Standard (Dewarp) | 3840 × 2880 | 115 × 99 (126) | 78 × 69 (83) | 1223 | 3.24 × 2.75 m | 1.22 mm |
| DJI 4K 16:9 Ultra-Wide | 3840 × 2160 | 120 × 65 (140) | 80 × 47 (89) | 1920 | 3.43 × 1.92 m | 0.78 mm |

GSD values assume the centre pixel scale implied by the projection model; a dewarped (rectilinear) mode stretches the frame edges and therefore has fewer pixels per degree at the centre than the fisheye mode it is derived from, which is why DJI Standard shows a coarser GSD than Ultra-Wide for the same pixel count.

### 6.4 What this means for choosing between the two cameras

- Under water the two cameras cover almost the same field (≈ 80° × 60–75°) whatever lens mode is chosen; the flat port erases the headline 155° vs 156° difference. The usable differences are pixel count (40 MP vs 27 MP stills; 4K 4:3 at 120 fps vs 60 fps), sensor size (1/1.3" vs 1/1.9", roughly one stop of light) and the native depth rating (20 m vs 10 m without a housing).
- For measurement, prefer the modes whose angles are published or distortion-corrected: GoPro Linear (rectilinear, 92° → 65° under water) and GoPro Wide 8:7 (published angles, fisheye model), DJI Standard (Dewarp) if a rectilinear workflow is required. Keep HyperSmooth / RockSteady off and lock exposure and white balance.
- Fisheye-type modes keep more pixels in the centre and more coverage, but need a fisheye calibration model and calibration in water; the outer ring of a 155° lens behind a flat port is strongly distorted and colour-fringed and is best masked.
- A single in-air calibration does not transfer; calibrate in water at the working distance with a 3-D target (Boutros et al. 2015 found 3-D calibration cubes far better than planar boards for stereo rigs), and recalibrate when the port, lens cover, salinity or depth changes appreciably.

## 7. Worked example (planner defaults)

GoPro HERO13 Black, 27 MP 8:7 Wide, b = 0.50 m, θ = 8°, Z = 2 m, seawater 22 °C, σ_px = 0.5 px, visibility 12 m:
in-water field 81° × 74° (95° diagonal); one frame 3.47 × 3.18 m (10.5 m²); Z_near 0.25 m, Z_full 2.05 m, Z_cross 3.58 m; overlap at 2 m 97 % (10.1 m²); γ = 14.3°, b/Z = 0.25; σ_Z = 1.6 mm (1-σ), lateral 0.2 mm; GSD 0.57 mm/px; disparity 876 px; contrast transmittance 52 %.

## 8. References

- Bayley D.T.I. & Mogg A.O.M. 2020. A protocol for the large-scale analysis of reefs using Structure from Motion photogrammetry. *Methods Ecol. Evol.* 11:1410–1420. https://doi.org/10.1111/2041-210X.13476
- Boutros N., Shortis M.R. & Harvey E.S. 2015. A comparison of calibration methods and system configurations of underwater stereo-video systems for applications in marine ecology. *Limnol. Oceanogr. Methods* 13:224–236. https://doi.org/10.1002/lom3.10020
- Burns J.H.R., Delparte D., Gates R.D. & Takabayashi M. 2015. Integrating structure-from-motion photogrammetry with geospatial software as a novel technique for quantifying 3D ecological characteristics of coral reefs. *PeerJ* 3:e1077. https://doi.org/10.7717/peerj.1077
- Dall'Asta E., Thoeni K., Santise M., Forlani G., Giacomini A. & Roncella R. 2015. Network design and quality checks in automatic orientation of close-range photogrammetric blocks. *Sensors* 15:7985–8008. https://doi.org/10.3390/s150407985
- Del Pizzo S., et al. 2024. Stereo GoPro 11 rig: in-air vs in-water baseline. IEEE MetroSea 2024 (DOI not verified).
- Harvey E.S. & Shortis M.R. 1995. A system for stereo-video measurement of sub-tidal organisms. *Mar. Technol. Soc. J.* 29(4):10–22.
- Harvey E.S., Goetze J., McLaren B., Langlois T. & Shortis M.R. 2010. Influence of range, angle of view, image resolution and image compression on underwater stereo-video measurements. *Mar. Technol. Soc. J.* 44(1):75–85. https://doi.org/10.4031/MTSJ.44.1.3
- Helmholz P. & Lichti D.D. 2019. Investigation of chromatic aberration and its influence on the processing of underwater imagery. *ISPRS Ann.* IV-2/W5:575–581. https://doi.org/10.5194/isprs-annals-IV-2-W5-575-2019
- Langlois T., et al. 2020. A field and video annotation guide for baited remote underwater stereo-video surveys of demersal fish assemblages. *Methods Ecol. Evol.* 11:1401–1409. https://doi.org/10.1111/2041-210X.13470
- Lowe D.G. 2004. Distinctive image features from scale-invariant keypoints. *IJCV* 60:91–110. https://doi.org/10.1023/B:VISI.0000029664.99615.94
- Luhmann T., Robson S., Kyle S. & Boehm J. 2019/2023. *Close-Range Photogrammetry and 3D Imaging*. De Gruyter. https://doi.org/10.1515/9783110607253
- Łuczyński T., Pfingsthorn M. & Birk A. 2017. The Pinax-model for accurate and efficient refraction correction of underwater cameras in flat-pane housings. *Ocean Eng.* 133:9–22. https://doi.org/10.1016/j.oceaneng.2017.01.029
- Menna F., Nocerino E., Fassi F. & Remondino F. 2016. Geometric and optic characterization of a hemispherical dome port for underwater photogrammetry. *Sensors* 16:48. https://doi.org/10.3390/s16010048
- Menna F., Nocerino E. & Remondino F. 2017. Flat versus hemispherical dome ports in underwater photogrammetry. *ISPRS Arch.* XLII-2/W3:481–487. https://doi.org/10.5194/isprs-archives-XLII-2-W3-481-2017
- Millard R.C. & Seaver G. 1990. An index of refraction algorithm for seawater over temperature, pressure, salinity, density, and wavelength. *Deep-Sea Res.* 37:1909–1926. https://doi.org/10.1016/0198-0149(90)90086-B
- Nocerino E., Menna F., Gruen A., et al. 2019. Comparison of diver-operated underwater photogrammetric systems for coral reef monitoring. *ISPRS Arch.* XLII-2/W10:143–150. https://doi.org/10.5194/isprs-archives-XLII-2-W10-143-2019
- Quan X. & Fry E.S. 1995. Empirical equation for the index of refraction of seawater. *Appl. Opt.* 34:3477–3480. https://doi.org/10.1364/AO.34.003477
- Raoult V., David P.A., Dupont S.F., Mathewson C.P., O'Neill S.J., Powell N.N. & Williamson J.E. 2016. GoPros as an underwater photogrammetry tool for citizen science. *PeerJ* 4:e1960. https://doi.org/10.7717/peerj.1960
- Shortis M.R. 2015. Calibration techniques for accurate measurements by underwater camera systems. *Sensors* 15:30810–30826. https://doi.org/10.3390/s151229831
- Shortis M.R. & Harvey E.S. 1998. Design and calibration of an underwater stereo-video system for the monitoring of marine fauna populations. *ISPRS Arch.* XXXII/5:792–799. https://www.isprs.org/proceedings/XXXII/part5/792_XXXII-part5.pdf
- Shortis M.R., Harvey E.S. & Abdo D. 2009. A review of underwater stereo-image measurement for marine biology and ecology applications. *Oceanogr. Mar. Biol. Annu. Rev.* 47:257–292.
- Suka R., et al. 2019. Processing photomosaic imagery of coral reefs using structure-from-motion standard operating procedures. NOAA Tech. Memo. https://doi.org/10.25923/h2q8-jv47
- Treibitz T., Schechner Y.Y., Kunz C. & Singh H. 2012. Flat refractive geometry. *IEEE TPAMI* 34:51–65. https://doi.org/10.1109/TPAMI.2011.105
- Wenzel K., Rothermel M., Fritsch D. & Haala N. 2013. Image acquisition and model selection for multi-view stereo. *ISPRS Arch.* XL-5/W1:251–258. https://doi.org/10.5194/isprsarchives-XL-5-W1-251-2013
- Young G.C., Dey S., Rogers A.D. & Exton D. 2017. Cost and time-effective method for multi-scale measures of rugosity, fractal dimension, and vector dispersion from coral reef 3D models. *PLoS ONE* 12:e0175341. https://doi.org/10.1371/journal.pone.0175341

Manufacturer and trade sources: GoPro HERO13 Black tech specs and support articles (digital lenses/FOV, video and photo settings, Protective Housing), DPReview HERO11/HERO12 coverage, Backscatter HERO13 underwater guide, INON UFL-G140 SD product page; DJI Osmo Action 5 Pro specs, FAQ and user manual, DJI forum administrator replies on FOV (threads 322326, 295310, 216036). Links are in `cameras.js`.
