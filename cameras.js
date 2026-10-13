/*
 * cameras.js — camera and lens-mode database for the Underwater Stereo Rig Planner.
 *
 * Every number is an IN-AIR value. hfov / vfov are the full field angles (deg)
 * through the centres of the long and short image sides; `proj` is the
 * projection model used to build the frustum corners and to derive the centre
 * focal length in pixels:
 *   rectilinear  r = f·tan(θ)       distortion-corrected modes (GoPro Linear, DJI Standard/Dewarp)
 *   equidistant  r = f·θ            GoPro "Wide" (fits GoPro's published H/V/D table)
 *   equisolid    r = 2f·sin(θ/2)    DJI Ultra-Wide/Wide (fits the only measured DJI fisheye HFOV)
 *   stereographic r = 2f·tan(θ/2)
 * `src` flags how each angle was obtained: 'published' (manufacturer figure) or
 * 'derived' (computed from a published diagonal or from a published horizontal
 * angle and the aspect ratio). Stabilisation (HyperSmooth / RockSteady) is
 * assumed OFF: it crops and warps the frame variably and should be off for
 * photogrammetry. Sources are listed per camera; details in research_notes.md.
 */
(function (root) {
  var CAMERAS = [
    {
      id: 'gopro13',
      name: 'GoPro HERO13 Black',
      body: { w: 0.0718, h: 0.0508, d: 0.0336 },
      sensor: { type: '1/1.9"', mp: 27.6, pitch_um: 1.12, native: '8:7', note: 'active 5599 × 4927 px; ≈6.3 × 5.5 mm (DPReview), pitch derived' },
      lens: { fnumber: 2.5, f_mm: 2.7, eq35: '12–39 mm (GoPro, across digital lenses)' },
      nearFocusAir: 0.30,
      waterproof: { native: 10, housing: 60 },
      notes: 'Flat hydrophobic lens cover; the Protective Housing (60 m) also has a flat glass port. Field angles are GoPro\'s published digital-lens figures with HyperSmooth off (HERO13 table = HERO12 = HERO11, same sensor and lens). Photo-mode angles are not published; 8:7 Wide uses the 8:7 video figure and 8:7 Linear is derived from the 92° Linear horizontal angle. HB-series lens mods are not for underwater use.',
      sources: [
        ['GoPro HERO13 Black tech specs', 'https://gopro.com/en/us/shop/cameras/buy/hero13black/CHDHX-131-master.html?tab=tech-specs'],
        ['GoPro: HERO13 Black digital lenses (FOV) information', 'https://community.gopro.com/s/article/HERO13-Black-Digital-Lenses-FOV-Information?language=en_US'],
        ['GoPro: HERO13 Black video settings and resolutions', 'https://community.gopro.com/s/article/HERO13-Black-Video-Settings-And-Resolutions?language=en_US'],
        ['GoPro: HERO13 Black photo settings and resolutions', 'https://community.gopro.com/s/article/HERO13-Black-Photo-Settings-And-Resolutions?language=en_US'],
        ['GoPro Protective Housing (60 m, flat glass port)', 'https://gopro.com/en/us/shop/mounts-accessories/protective-housing-plus-waterproof-case/ADDIV-001.html'],
        ['DPReview HERO12 review (sensor size, 2.7 mm lens)', 'https://www.dpreview.com/reviews/gopro-hero12-black-review-this-tiny-action-provides-a-plethora-of-creative-features'],
        ['Backscatter HERO13 underwater guide (fixed focus ≈ 30 cm)', 'https://www.backscatter.com/reviews/post/Complete-Guide-For-GoPro-HERO13-Best-Underwater-Video-Photo-Settings']
      ],
      modes: [
        { id: 'p27-wide',     label: 'Photo 27 MP 8:7 · Wide',            w: 5568, h: 4872, hfov: 122, vfov: 108, dfov: 156, proj: 'equidistant', src: 'published (8:7 video figure)' },
        { id: 'p27-linear',   label: 'Photo 27 MP 8:7 · Linear',          w: 5568, h: 4872, hfov: 92,  vfov: 84,  dfov: 108, proj: 'rectilinear', src: 'derived from Linear 92° H' },
        { id: 'v53-87-wide',  label: 'Video 5.3K 8:7 (5312×4648) · Wide', w: 5312, h: 4648, hfov: 122, vfov: 108, dfov: 156, proj: 'equidistant', src: 'published' },
        { id: 'v53-169-wide', label: 'Video 5.3K 16:9 · Wide',            w: 5312, h: 2988, hfov: 118, vfov: 69,  dfov: 133, proj: 'equidistant', src: 'published' },
        { id: 'v53-169-lin',  label: 'Video 5.3K 16:9 · Linear',          w: 5312, h: 2988, hfov: 92,  vfov: 61,  dfov: 100, proj: 'rectilinear', src: 'published' },
        { id: 'v4k-87-wide',  label: 'Video 4K 8:7 (3840×3360) · Wide',   w: 3840, h: 3360, hfov: 122, vfov: 108, dfov: 156, proj: 'equidistant', src: 'published' },
        { id: 'v4k-169-wide', label: 'Video 4K 16:9 · Wide',              w: 3840, h: 2160, hfov: 118, vfov: 69,  dfov: 133, proj: 'equidistant', src: 'published' },
        { id: 'v4k-169-lin',  label: 'Video 4K 16:9 · Linear',            w: 3840, h: 2160, hfov: 92,  vfov: 61,  dfov: 100, proj: 'rectilinear', src: 'published' },
        { id: 'v27-43-wide',  label: 'Video 2.7K 4:3 (120 fps) · Wide',   w: 2704, h: 2028, hfov: 120, vfov: 92,  dfov: 146, proj: 'equidistant', src: 'published' },
        { id: 'v27-43-lin',   label: 'Video 2.7K 4:3 (120 fps) · Linear', w: 2704, h: 2028, hfov: 92,  vfov: 76,  dfov: 105, proj: 'rectilinear', src: 'published (HERO12 table)' }
      ]
    },
    {
      id: 'dji5pro',
      name: 'DJI Osmo Action 5 Pro',
      body: { w: 0.0705, h: 0.0442, d: 0.0328 },
      sensor: { type: '1/1.3"', mp: 40, pitch_um: 1.2, native: '4:3', note: '7296 × 5472 px; DJI quotes 2.4 µm "equivalent" (binned), native ≈ 1.2 µm derived; ≈8.8 × 6.6 mm' },
      lens: { fnumber: 2.8, f_mm: null, eq35: 'Ultra-Wide ≈ 9 mm, Wide ≈ 10 mm, Standard ≈ 14 mm (DJI forum admin, Action 4)' },
      nearFocusAir: 0.35,
      waterproof: { native: 20, housing: 60 },
      notes: 'Flat screw-on glass lens cover (≈32 × 32 × 4.5 mm); the 60 m waterproof case also has a flat window. DJI publishes only diagonal angles: 155° for Ultra-Wide/Wide and 126° for Standard (Dewarp), both with RockSteady off. Horizontal and vertical angles here are derived from those diagonals (equisolid fisheye model for Ultra-Wide, rectilinear for Dewarp) and carry roughly ±5° uncertainty. Only Standard (Dewarp) is distortion-corrected. Whether Ultra-Wide applies to 40 MP stills is unconfirmed.',
      sources: [
        ['DJI Osmo Action 5 Pro specs', 'https://www.dji.com/global/osmo-action-5-pro/specs'],
        ['DJI Osmo Action 5 Pro FAQ (focus 0.35 m, lens cover, waterproofing)', 'https://dji.com/osmo-action-5-pro/faq'],
        ['DJI forum: Action 5 Pro FOV by setting (DFOV 155° / 126°)', 'https://forum.dji.com/thread-322326-1-1.html'],
        ['DJI forum: Action 4 FOV and equivalent focal lengths by setting', 'https://forum.dji.com/thread-295310-1-1.html'],
        ['DJI forum: original Osmo Action, diagonal FOV confirmed, measured HFOV 112°', 'https://forum.dji.com/thread-216036-1-1.html'],
        ['DJI Osmo Action 5 Pro user manual (mirror)', 'https://www.adorama.com/col/productManuals/DJICPOS3780K.pdf']
      ],
      modes: [
        { id: 'p40-uw',      label: 'Photo 40 MP 4:3 · Ultra-Wide (155° diag.)',  w: 7296, h: 5472, hfov: 120, vfov: 88,  dfov: 155, proj: 'equisolid',   src: 'derived from 155° diagonal' },
        { id: 'p40-std',     label: 'Photo 40 MP 4:3 · Standard (Dewarp)',        w: 7296, h: 5472, hfov: 115, vfov: 99,  dfov: 126, proj: 'rectilinear', src: 'derived from 126° diagonal' },
        { id: 'v4k-43-uw',   label: 'Video 4K 4:3 (3840×2880) · Ultra-Wide',      w: 3840, h: 2880, hfov: 120, vfov: 88,  dfov: 155, proj: 'equisolid',   src: 'derived from 155° diagonal' },
        { id: 'v4k-43-std',  label: 'Video 4K 4:3 (3840×2880) · Standard (Dewarp)', w: 3840, h: 2880, hfov: 115, vfov: 99, dfov: 126, proj: 'rectilinear', src: 'derived from 126° diagonal' },
        { id: 'v4k-169-uw',  label: 'Video 4K 16:9 · Ultra-Wide',                  w: 3840, h: 2160, hfov: 120, vfov: 65,  dfov: 140, proj: 'equisolid',   src: 'derived (16:9 crop of 4:3)' },
        { id: 'v4k-169-std', label: 'Video 4K 16:9 · Standard (Dewarp)',          w: 3840, h: 2160, hfov: 115, vfov: 83,  dfov: 122, proj: 'rectilinear', src: 'derived (16:9 crop of 4:3)' },
        { id: 'v27-43-uw',   label: 'Video 2.7K 4:3 (120 fps) · Ultra-Wide',      w: 2688, h: 2016, hfov: 120, vfov: 88,  dfov: 155, proj: 'equisolid',   src: 'derived from 155° diagonal' }
      ]
    },
    {
      id: 'custom',
      name: 'Custom camera',
      body: { w: 0.07, h: 0.05, d: 0.035 },
      sensor: { type: '—', mp: 0, pitch_um: 0, native: '' },
      lens: {},
      nearFocusAir: 0.3,
      waterproof: { native: 0, housing: 0 },
      notes: 'Enter the in-air field angles, image size and projection of any flat-port camera.',
      sources: [],
      modes: [
        { id: 'custom', label: 'Custom mode', w: 4000, h: 3000, hfov: 90, vfov: 70, proj: 'rectilinear', src: 'user' }
      ]
    }
  ];
  root.UWCameras = CAMERAS;
  if (typeof module === 'object' && module.exports) module.exports = CAMERAS;
})(typeof self !== 'undefined' ? self : this);
