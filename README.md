# Universe in a Cone

**Live:** https://astrodavid10.github.io/universe-cone/

The whole history of the universe as a cone lying on its side: the Big Bang at the tip, today at the wide
mouth, and the cone's width at each moment the size of the universe. A companion to the INTUITIVE®
Planetarium dome show, it builds the cone in six steps and then morphs to the true scale of time.

1. The Big Bang
2. First light (the cosmic microwave background)
3. The dark ages
4. First stars and reionization
5. Galaxies grow
6. Looking back in time (light stretched from ultraviolet to infrared on its way to JWST)
7. The true scale of time

Visitors can play it through, step through it, scrub time in both directions, flip between the story scale and
the true scale at any point, turn and zoom the cone, and tap a galaxy, the CMB or the telescope to learn more.
On portrait phones the cone stands upright, with time running up the screen.

## Evidence tiers

- **MEASURED:** the CMB map (Planck) and the galaxy images. The galaxies are nearby ones standing in for every
  era, so their places in the cone are schematic.
- **MODELED:** the true-scale width (the expansion of space, a(t), in flat ΛCDM with Planck 2018 parameters), the
  billion-year rings, the ray's (1 + z) stretch, and the era boundaries.
- **SCHEMATIC:** the story-scale width, the hydrogen fog, the reionization bubbles and the particles.

## How it is built

- Vue 3 + TypeScript + three.js (no WorldWide Telescope: the cone is a diagram in its own frame).
- `src/cone/timeline.ts`: one clock, from which the whole scene state follows. Tested against the dome build's
  finished state for every step (`yarn test:app`).
- `src/cone/layers.ts`: every layer morphs story ↔ true and reveals along the cone in its shaders.
- `src/cone/ConeScene.ts`: renderer, staged loading, camera rig, label projection and picking.
- `pipeline/web_pack.py`: repacks the dome build's export for the web (58 MB down to 11 MB).
- `pipeline/cmb_disc.py`: draws the CMB disc from the Planck SMICA map (numpy + astropy, no healpy needed).

```bash
corepack yarn install
corepack yarn serve
corepack yarn lint && corepack yarn typecheck && corepack yarn test:app && corepack yarn build
```

The packed data is committed in `public/data/cone/`. To rebuild it you need the dome build's export (not in
this repository) and Python with numpy, astropy and Pillow. `--glb` also needs `npx` for gltf-transform, and
`--cmb` takes the Planck map `COM_CMB_IQU-smica_1024_R2.01_full.fits` from the
[Planck Legacy Archive](https://pla.esac.esa.int/) (also at
[IRSA](https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/)):

```bash
python -I pipeline/web_pack.py <dome export> public/data/cone --glb --cmb COM_CMB_IQU-smica_1024_R2.01_full.fits
```

Deep links:

- `?step=0..7`
- `?scale=true`
- `?view=orbit|lookback|bigbang`
- `?t=<seconds into Play All>`
- `?tier=lite`
- `?kiosk=1` (add `&attract=1` to start the loop)
- `?debug=1` exposes `window.cone`

## Credits

- Concept, design and dome build: A. David Weigel, INTUITIVE® Planetarium, U.S. Space & Rocket Center.
- Cosmology: flat ΛCDM, Planck 2018 VI (H₀ 67.4, Ωₘ 0.315).
- CMB: the Planck 2015 SMICA map, ESA and the Planck Collaboration (Planck Legacy Archive). The disc is drawn
  from the map by `pipeline/cmb_disc.py`.
- Galaxy images, nearby galaxies used as stand-ins:
  - DESI Legacy Imaging Surveys DR10;
  - Pan-STARRS1 Surveys (Chambers et al. 2016);
  - Digitized Sky Survey 2 (STScI; Palomar and UK Schmidt), via CDS hips2fits and the Legacy Surveys viewer.
- A Cosmic Data Stories interactive.
