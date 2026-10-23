/*
 * strobe-content.js — teaching text for the Strobe Lighting Lab.
 * Plain HTML strings; edit freely. Sources are listed in `references`.
 */
(function (root) {
  'use strict';
  var C = {};

  C.why = [
    '<p>Light from a strobe reaches the camera along three kinds of path:</p>',
    '<ul>',
    '<li><b>Direct light</b>: strobe → subject → lens. This is the picture you want. It weakens with the square of the strobe-to-subject distance and exponentially, as e<sup>−c·path</sup>, along the whole strobe → subject → lens path.</li>',
    '<li><b>Backscatter</b>: strobe → water → lens. Every millilitre of water lit by a beam scatters a little light, and the water that is both lit and in front of the lens sends some of it straight back into the lens. Fine particles make a smooth veil that flattens contrast; larger particles (marine snow, plankton, silt flocs) make the bright specks.</li>',
    '<li><b>Forward scatter</b>: light from the subject nudged slightly off course on its way to the lens. It softens detail at long range; this lab does not model it.</li>',
    '</ul>',
    '<p>Three facts explain almost every rule of strobe placement:</p>',
    '<ol>',
    '<li><b>Backscatter is made close to the camera.</b> A strobe beside the housing lights the water just in front of the port far more strongly than the water near the subject (inverse square), and that light has only a short way back to the lens. In most set-ups half of the haze comes from the first 15–40 cm in front of the port; the lab reports this distance.</li>',
    '<li><b>Water scatters mostly forwards.</b> Only about 2 % of the scattered light goes backwards, and the backward part is weakest around 120–130° and rises again towards 180°. A light right next to the lens sends its backscatter straight back into it; a light well off to the side sees the same water at a less favourable angle and, more importantly, lights less of the water the lens can see.</li>',
    '<li><b>Everything is exponential in turbid water.</b> The subject’s light falls as e<sup>−c·path</sup> while the backscatter from the first half metre barely changes, so contrast collapses once the subject is more than a fraction of the visibility away. Imaging studies with artificial light found that lights next to the camera work to about one attenuation length (1/c), and well-separated lights to two or three.</li>',
    '</ol>',
    '<p>In the diagrams, the amber cloud is the backscatter source: water that is lit by a beam, seen by the lens and not hidden behind the subject. Moving and angling the strobes to shrink that cloud is the whole game.</p>'
  ].join('');

  C.rules = [
    '<h3>1. Get close</h3>',
    '<p>Halving the camera-to-subject distance halves the light path for the subject (less loss, more red) but removes very little backscatter, so the subject-to-haze ratio improves fast. Practical guides keep the subject within about a quarter to a third of the visibility, and under a metre for wide angle in green water. Contrast and colour start to drop “even at five feet away” (Backscatter.com).</p>',
    '<h3>2. Keep the beams out of the water in front of the port</h3>',
    '<p>Put the strobes out to the sides and no further forward than the handles; for wide angle, behind the port. Underwater Photography Guide suggests 20–30 cm from the housing at 9 and 3 o’clock for wide angle, with the strobes about as far apart as the subject is from the camera. Physically this shrinks the “common volume” where the beams and the field of view overlap, which is what produces backscatter (Jaffe 1990).</p>',
    '<h3>3. Angle the strobes outward and light with the beam edge</h3>',
    '<p>Turn each strobe outward so the subject sits near the inner edge of its beam (“edge lighting” or feathering). The brightest part of the beam then passes beside the subject instead of through the water in front of the lens. It costs power (the lab shows how far off-axis the subject is and how much of the beam reaches it) and a too-narrow beam leaves the centre dark.</p>',
    '<h3>4. Distance between strobes controls evenness</h3>',
    '<p>Strobes too far apart and angled out light the edges of the frame and leave the middle dim; too close together they light the water in front of the lens. A good starting point for wide angle is a strobe spacing about equal to the subject distance, then fine-tune on the exposure map.</p>',
    '<h3>5. Close-focus wide angle</h3>',
    '<p>For subjects under about 60 cm, Alex Mustard keeps the strobes within about 20 cm of the dome and behind it, angled slightly inward for subjects under 30 cm, at 10 and 2 o’clock over a flat seabed. In vertical shots he turns the lower strobe down by two stops or more.</p>',
    '<h3>6. Macro</h3>',
    '<p>The water column is short, so backscatter matters less and shadows matter more. Bring the strobes close to the subject and angle them in; use a single strobe from above for texture, or a snoot for a black background in poor visibility. A closer or larger light (diffuser) gives softer shadows.</p>',
    '<h3>7. Shadows: size and distance of the light</h3>',
    '<p>The width of a soft shadow edge is roughly the light’s diameter times the distance from the object to its shadow, divided by the distance from the light to the object. The lab shows each strobe’s apparent size from the subject in degrees: bigger means softer. Two strobes at equal power cast two shadows; set one as the main light and the other a stop or two lower as fill.</p>',
    '<h3>8. Turn the power down</h3>',
    '<p>Backscatter scales with strobe output just like the subject does, but a closer subject needs less output, and specks in the near field drop out first when the power falls. In turbid water, low power with the strobes far out and the subject close beats full power from the port.</p>',
    '<h3>9. In turbid water</h3>',
    '<p>Get closer and change to a wider lens, move the strobes further out and back, reduce power, consider a single strobe from above or the side, or work with ambient light only.</p>'
  ].join('');

  C.strobes = [
    '<p>Numbers from INON’s specification pages and manuals. Guide numbers are in air at ISO 100 in metres; beam angles are INON’s nominal underwater values.</p>',
    '<div class="tablewrap"><table class="tv"><thead><tr><th></th><th>Z-330</th><th>S-2000 bare</th><th>S-2000 + −0.5 diffuser</th></tr></thead><tbody>',
    '<tr><td>Guide number (full power)</td><td>33</td><td>20</td><td>17</td></tr>',
    '<tr><td>Beam (under water)</td><td>110° × 110° circular</td><td>105° × 95°</td><td>110° × 110° circular</td></tr>',
    '<tr><td>Colour temperature</td><td>5500 K (5400 K with SOFT filter)</td><td>5500 K</td><td>5400 K</td></tr>',
    '<tr><td>Manual power</td><td>13 steps of ½ EV, to −6 EV (GN 4.1)</td><td colspan="2">12 steps of ½ EV, to −5.5 EV (GN 3.0)</td></tr>',
    '<tr><td>Auto modes</td><td>S-TTL, TTL</td><td colspan="2">S-TTL (TTL only as a slave)</td></tr>',
    '<tr><td>Recycle at full power</td><td>1.6–1.8 s (eneloop)</td><td colspan="2">1.5 s (eneloop)</td></tr>',
    '<tr><td>Size, weight in air</td><td>Ø102 × 131 × 125 mm, 637 g</td><td colspan="2">Ø64 × 83 × 107 mm, 295 g</td></tr>',
    '<tr><td>Depth rating</td><td>100 m</td><td colspan="2">100 m</td></tr>',
    '</tbody></table></div>',
    '<h3>What the numbers mean in the water</h3>',
    '<ul>',
    '<li><b>Guide number.</b> In air, f-number = GN ÷ distance. Under water the light also loses e<sup>−c·path</sup> over the strobe → subject → lens path, so in 5 m visibility a subject 1 m away gets about 1.5 stops less than the guide number predicts. Practical guides quote “GN 20 in air is about 10 under water”.</li>',
    '<li><b>Beam angle.</b> INON does not state the threshold behind its beam angles. The lab assumes the usual −1 EV (half-intensity) edge and a smooth, centre-weighted fall-off, which matches independent tests that describe the Z-330 beam as a bright centre with a gentle roll-off rather than a flat top.</li>',
    '<li><b>Diffusers.</b> The S-2000’s −0.5 white diffuser trades half a stop for a wider, rounder, softer beam and a slightly warmer colour. The Z-330’s bundled SOFT dome filter costs about 0.3 EV and does not widen the beam.</li>',
    '<li><b>Low power matters for macro.</b> At 15 cm even the lowest manual step can over-expose at f/8 and ISO 100; the lab flags this. Close the aperture, lower ISO or move the strobe back.</li>',
    '<li><b>Size of the light.</b> INON does not publish the emitting window size. The lab estimates about 7 cm for the Z-330 dome and 4.5–5 cm for the S-2000, which sets how soft the shadows are.</li>',
    '</ul>',
    '<p>Sources: <a href="https://www.inon.jp/customer/discontinued/strobe/strobe/z330/spec.html">Z-330 specification</a>, <a href="https://www.inon.jp/pdf-dl/_userdata/manual/00_strobe/0001_manual_z-330_en.pdf">Z-330 manual</a>, <a href="https://www.inon.jp/customer/discontinued/strobe/strobe/s2000/spec.html">S-2000 specification</a>, <a href="https://www.inon.jp/pdf-dl/_userdata/manual/00_strobe/0003_manual_s-2000_en.pdf">S-2000 manual</a>, <a href="https://www.inon.jp/products/strobe/diffuser/s2000.html">S-2000 diffusers</a>.</p>'
  ].join('');

  C.model = [
    '<p>The photograph is computed, not painted. For every pixel the graphics card traces a ray from the camera’s entrance pupil, through the port, into the water and onto the scene, and adds up four physical contributions in light units (candela-seconds per square metre). The same model runs on the CPU in <code>strobe-physics.js</code> to produce the numbers in the results panel; both are open source in the GitHub repository.</p>',
    '<h3>Camera and port</h3>',
    '<p>Behind a flat port each ray bends at the glass (Snell’s law), which narrows the field of view and adds the typical pincushion shape; behind a dome centred on the lens the rays pass straight through. A fisheye uses the equisolid projection.</p>',
    '<h3>Strobe beam</h3>',
    '<div class="eq">B(θ) = exp(−ln2 · (θ / θh)^p)          θh = half the quoted beam angle (taken as the −1 EV point)\np = 2 for diffused heads, 2.6 for a bare reflector; elliptical for the bare S-2000 (105° × 95°)</div>',
    '<p>The on-axis output comes from the guide number: I = 10π·GN² / (0.18 · 0.65 · 100) candela-seconds, which makes f-number = GN / distance give a correct exposure in air at ISO 100. In water the beam is concentrated by n² while the port costs the camera 1/n² (radiance is conserved as L/n²); the two cancel.</p>',
    '<h3>Light on the subject</h3>',
    '<div class="eq">E = I · B(θ) · e^(−c·D) / D²      (D = strobe-to-surface distance)\nL = albedo/π · E · cos(incidence) · visibility · e^(−c·R)      (R = surface-to-lens distance)</div>',
    '<p>Shadows are soft because the strobe has a window of real size: eight to sixteen shadow rays per strobe are sent to points spread over it.</p>',
    '<h3>Backscatter haze</h3>',
    '<div class="eq">L_bs = ∫₀^R  b · p(ψ) · E(x) · e^(−c·r) dr      summed over the strobes</div>',
    '<p>The integral runs along each pixel’s ray from the port to the subject, in 40 steps packed near the port, where most of the haze is made. p(ψ) is the Fournier–Forand phase function with n = 1.10 and μ = 3.5835, which reproduces the Petzold average backscattering ratio b<sub>b</sub>/b = 0.0183. With “Shadows inside the water” on, each step also checks whether the scene blocks the strobe, which draws light shafts behind objects.</p>',
    '<h3>Backscatter specks</h3>',
    '<p>Marine-snow particles (0.5–5 mm, more small ones than large, n(a) ∝ a<sup>−3</sup>) are scattered at the chosen number per litre through 16 depth slices in front of the lens. Each is lit by the strobes like the haze and drawn as a disc as wide as the lens’s defocus blur at that distance: sharp near the focus distance, a soft orb close to the port. Their count on screen depends on the picture size; the lab counts them as on a picture viewed 1200 pixels wide.</p>',
    '<h3>Water</h3>',
    '<p>Three colour bands (red ≈ 600 nm, green ≈ 540 nm, blue ≈ 465 nm) each have their own absorption a, scattering b and attenuation c = a + b. Pure-water absorption follows Pope &amp; Fry (1997); coastal presets add phytoplankton and dissolved organic matter, which absorb blue and make the water green. Horizontal visibility is V ≈ 4.8/c (Zaneveld &amp; Pegau 2003); the visibility slider sets c and therefore b.</p>',
    '<h3>Daylight and exposure</h3>',
    '<p>Sunlight at depth is E<sub>d</sub> = E<sub>0</sub>·e<sup>−K<sub>d</sub>·z</sup> with Kirk’s K<sub>d</sub> = √(a² + 0.264·a·b)/0.85. The background water is an approximate model calibrated to look about two stops darker than sand lit by the sun. The camera turns light into pixel values with the standard exposure equation: value = 0.018 · 0.65 · ISO / N² · L · t, so an 18 % grey card correctly exposed gives 0.18, then applies a film-like tone curve.</p>',
    '<h3>What it leaves out</h3>',
    '<ul>',
    '<li>Multiple scattering and forward-scatter blur, which matter when the light path exceeds about two or three attenuation lengths.</li>',
    '<li>Measured beam profiles: INON publishes beam angles, not intensity curves, so the profile shape is a smooth model fitted to the quoted angle.</li>',
    '<li>Strobe colour shifts with diffusers, lens vignetting, and the full spectrum (three bands only).</li>',
    '<li>Daylight is approximate; strobe light, backscatter and colour loss are the parts to trust quantitatively.</li>',
    '</ul>'
  ].join('');

  C.exercises = [
    '<ol>',
    '<li><b>The classic mistake.</b> Full-frame kit, Plymouth Sound water, sea-fan scene. Choose “Close to the port, aimed straight ahead”, note the haze, the specks and where half the haze comes from. Switch the photograph to “Backscatter only”. Now choose “Wide angle: out, back, angled out”. By how much did each number change, and why?</li>',
    '<li><b>Drag it yourself.</b> Start from “10 and 2 o’clock”. Without using the presets, drag the strobes in the top view until the haze over the subject is below 8 % while the subject stays evenly lit (under 1 EV). Save a snapshot and compare it with the preset.</li>',
    '<li><b>Visibility ladder.</b> With your best placement, set visibility to 15, 8, 5, 3 and 1.5 m. Record haze and specks. At what visibility does even good placement fail? Compare with the rule of keeping the subject within a quarter to a third of the visibility.</li>',
    '<li><b>Get closer.</b> In 5 m visibility, compare the subject at 2 m with the subject at 0.6 m. What happens to the haze, the red loss and the strobe power TTL chooses?</li>',
    '<li><b>Shadows.</b> Use the coverage test scene. Spread the strobes far apart and look at the white ball’s two shadows. Turn auto power off and set strobe B two stops lower: one shadow fades. Then try a single strobe overhead. Which light gives the softest shadow edge, and why (look at the “light size” column)?</li>',
    '<li><b>Macro with the students’ kit.</b> Canon G9 X II with one S-2000 and the nudibranch. Compare the S-2000 bare and with the −0.5 diffuser for shadow softness and evenness. Try top lighting.</li>',
    '<li><b>Colour.</b> Fish scene: compare the red loss at 0.5 m and 1.5 m in tropical water and in Plymouth Sound. Which costs more red, distance from the strobe or distance from the camera?</li>',
    '<li><b>Beam shape.</b> In the observer view with “Show the beam shape”, walk around the rig. Where do the beams overlap the camera’s field of view? Switch to “True to physics” and explain why a diver looking towards a strobe sees glare.</li>',
    '</ol>'
  ].join('');

  C.references = [
    '<ul>',
    '<li>Jaffe J.S. 1990. Computer modeling and the design of optimal underwater imaging systems. <i>IEEE J. Oceanic Eng.</i> 15:101–111. <a href="https://doi.org/10.1109/48.50695">doi:10.1109/48.50695</a></li>',
    '<li>Jaffe J.S. 2015. Underwater optical imaging: the past, the present, and the prospects. <i>IEEE J. Oceanic Eng.</i> 40:683–700. <a href="https://doi.org/10.1109/JOE.2014.2350751">doi:10.1109/JOE.2014.2350751</a></li>',
    '<li>Jaffe J.S., Moore K.D., McLean J., Strand M.P. 2001. Underwater optical imaging: status and prospects. <i>Oceanography</i> 14(3):66–76. <a href="https://doi.org/10.5670/oceanog.2001.24">doi:10.5670/oceanog.2001.24</a></li>',
    '<li>McGlamery B.L. 1980. A computer model for underwater camera systems. <i>Proc. SPIE</i> 208:221–231. <a href="https://doi.org/10.1117/12.958279">doi:10.1117/12.958279</a></li>',
    '<li>Treibitz T., Schechner Y.Y. 2009. Active polarization descattering. <i>IEEE TPAMI</i> 31:385–399. <a href="https://doi.org/10.1109/TPAMI.2008.85">doi:10.1109/TPAMI.2008.85</a></li>',
    '<li>Petzold T.J. 1972. Volume scattering functions for selected ocean waters. Scripps Institution of Oceanography, SIO Ref. 72-78. <a href="https://misclab.umeoce.maine.edu/education/VisibilityLab/reports/SIO_72-78.pdf">PDF</a></li>',
    '<li>Fournier G.R., Forand J.L. 1994. Analytic phase function for ocean water. <i>Proc. SPIE</i> 2258. <a href="https://doi.org/10.1117/12.190063">doi:10.1117/12.190063</a>; Mobley C.D. et al., Ocean Optics Web Book: <a href="https://www.oceanopticsbook.info/view/scattering/the-fournier-forand-phase-function">The Fournier–Forand phase function</a></li>',
    '<li>Pope R.M., Fry E.S. 1997. Absorption spectrum (380–700 nm) of pure water. <i>Appl. Opt.</i> 36:8710–8723. <a href="https://doi.org/10.1364/AO.36.008710">doi:10.1364/AO.36.008710</a></li>',
    '<li>Quan X., Fry E.S. 1995. Empirical equation for the index of refraction of seawater. <i>Appl. Opt.</i> 34:3477–3480. <a href="https://doi.org/10.1364/AO.34.003477">doi:10.1364/AO.34.003477</a></li>',
    '<li>Zaneveld J.R.V., Pegau W.S. 2003. Robust underwater visibility parameter. <i>Opt. Express</i> 11:2997–3009. <a href="https://doi.org/10.1364/OE.11.002997">doi:10.1364/OE.11.002997</a></li>',
    '<li>Kirk J.T.O. 1984. Dependence of relationship between inherent and apparent optical properties of water on solar altitude. <i>Limnol. Oceanogr.</i> 29:350–356. <a href="https://doi.org/10.4319/lo.1984.29.2.0350">doi:10.4319/lo.1984.29.2.0350</a></li>',
    '<li>Simon M., Grossart H.-P., Schweitzer B., Ploug H. 2002. Microbial ecology of organic aggregates in aquatic ecosystems. <i>Aquat. Microb. Ecol.</i> 28:175–211. <a href="https://doi.org/10.3354/ame028175">doi:10.3354/ame028175</a></li>',
    '<li>Peterson B. 2017. Strobe positioning for wide-angle underwater photography. Underwater Photography Guide. <a href="https://www.uwphotographyguide.com/strobe-positioning-wide-angle-underwater">link</a></li>',
    '<li>Mustard A. The underwater photographer’s guide to close-focus wide-angle. DivePhotoGuide. <a href="https://www.divephotoguide.com/underwater-photography-techniques/article/underwater-photographer-s-guide-close-focus-wide-angle/">link</a></li>',
    '<li>Backscatter Underwater Video &amp; Photo. Strobe placement and 8 easy tips for lighting with your subjects. <a href="https://backscatter.com/reviews/post/Strobe-Placement-and-8-Easy-Tips-for-Lighting-with-Your-Subjects">link</a></li>',
    '<li>Edge M. <i>The Underwater Photographer</i> (4th ed., Focal Press, 2010) and Mustard A. <i>Underwater Photography Masterclass</i> (Ilex, 2016): the standard texts behind the positioning rules.</li>',
    '</ul>'
  ].join('');

  root.StrobeContent = C;
})(typeof self !== 'undefined' ? self : this);
