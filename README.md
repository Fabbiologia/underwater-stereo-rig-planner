# Underwater Stereo Rig Planner

Interactive 3-D planning tool for stereo photogrammetry with flat-port action cameras (GoPro HERO13 Black, DJI Osmo Action 5 Pro, or any custom camera) under water. Change the baseline, convergence angle, working distance, lens mode and water properties and the model recomputes:

- the refraction-corrected field of view of each camera, behind a flat port (Snell's law through the lens cover or housing window) or a dome port (exact ray trace through the spherical shell, with the pupil optionally off-centre), with a side-by-side flat-versus-dome comparison including the dome's virtual-image focus limits,
- the footprint of each frame and the stereo overlap polygon on the subject plane,
- the distances at which overlap begins, becomes complete, and where the optical axes cross,
- the ray intersection angle, depth and lateral precision, ground sampling distance and disparity,
- contrast transmittance for the chosen visibility,
- advisories against published design rules, and charts of overlap and depth precision against distance.

The 3-D view is deliberately plain: the two cameras on their bar, the refracted frustums, the footprints and overlap on a gridded subject plane, and one selectable reference object of known size (diver 1.8 m, 1 × 1 m or 0.5 × 0.5 m quadrat, 2 m transect tape, 1 m scale bar, Ø 0.5 m coral colony, 30 cm fish, 25 cm calibration cube, A3 target board) so the frame size can be judged against something familiar. Colours follow the page's light or dark theme.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app. Open it directly in a browser (it loads three.js from cdnjs and the two scripts below, which must stay in the same folder). |
| `physics.js` | All optics and stereo geometry as pure functions (also loadable in Node for testing). |
| `cameras.js` | Camera and lens-mode database with sources. Edit this to add cameras or correct a field angle. |
| `research_notes.md` | The physics, the derivations, the camera data with provenance, and the reference list. |

## Running it

Double-click `index.html`, or serve the folder (for example `python3 -m http.server 8765` and open `http://127.0.0.1:8765/`; `.claude/launch.json` has this configured for the Claude desktop app's preview). The page needs internet access to fetch three.js and the fonts. A published copy also exists as the claude.ai artifact "Underwater Stereo Rig Planner".

## Model in one paragraph

Both cameras sit behind flat windows, so a ray at angle θ from the axis in water reaches the lens at `asin(n·sin θ)` in air; the in-water field of a lens with in-air half angle α is `2·asin(sin α / n)`, capped at `2·asin(1/n) ≈ 97°`. Near the axis the port multiplies the focal length by n ≈ 1.34. With in-water half angle h in the plane of the baseline, baseline b and total convergence θ, the overlap begins at `b / (2 tan(h + θ/2))`, the two footprints coincide at `b / (tan(h + θ/2) − tan(h − θ/2))`, and the axes cross at `b / (2 tan(θ/2))`. A point whose rays meet at angle γ is located with `σ_depth = R·σ_α / (√2 sin(γ/2))`, σ_α = σ_px / (n·f_px), which reduces to `σ_Z = Z²·σ_d / (f·b)` for parallel cameras. Water is characterised by the Quan & Fry (1995) refractive index. Full details, assumptions and references are in `research_notes.md`.

## Conventions

- All field angles in `cameras.js` are in-air values with stabilisation off; `proj` selects the projection used for frustum corners and centre focal length (`rectilinear`, `equidistant`, `equisolid`, `stereographic`).
- Rig frame: x along the baseline, z toward the subject, y along the sensor's vertical axis. Camera A is at −b/2, camera B at +b/2; convergence is the total toe-in (each camera turns by half of it).
- "Mounting" only changes where the rig is drawn in the scene (looking down at the seafloor, obliquely, or forward); the geometry on the subject plane is identical.
- Precision values are 1-σ for a single stereo pair; a bundle adjustment over many images does better, but the trends with distance and baseline hold.

## Testing the maths

```bash
node -e "const P=require('./physics.js'); console.log(P.refractiveIndex(35,20,550), P.maxFlatPortFov(1.34))"
```

Expected: `1.3408…` and `96.5…`.
