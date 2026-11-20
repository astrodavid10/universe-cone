"""cmb_disc.py - draw the cone's CMB disc from the Planck SMICA map.

    python -I pipeline/cmb_disc.py <COM_CMB_IQU-smica_1024_R2.01_full.fits> <out.jpg> [--preview mollweide.jpg]

The map is the Planck 2015 SMICA CMB temperature map (Planck Legacy Archive; mirrored at NASA/IPAC IRSA,
https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/). The disc is one
hemisphere seen face-on (orthographic), centred on the north Galactic pole so the Galactic plane, where the map
is inpainted, falls at the rim. It fills 94 % of the square, as the app's CMB shader expects, on black.

Colour: a Planck-style diverging scale, blue (cold) through cream to red (hot), +-350 microkelvin.

HEALPix pixel lookup is done here in numpy (ang2pix for RING and NESTED ordering), so the only dependencies
are numpy, astropy and Pillow.
"""
import sys

import numpy as np
from astropy.io import fits
from PIL import Image

SIZE = 1024
DISC = 0.94          # fraction of the square the disc fills
RANGE_UK = 350.0     # colour scale limits, microkelvin
SUPER = 3            # supersampling per output pixel (anti-aliasing)

# Planck-style diverging colour scale: value in [-1, 1] -> RGB.
STOPS = np.array([-1.0, -0.6, -0.25, 0.0, 0.25, 0.6, 1.0])
COLORS = np.array([
    [12, 24, 130], [30, 110, 230], [120, 200, 250], [250, 240, 212],
    [255, 198, 92], [238, 108, 22], [150, 22, 0],
], dtype=np.float64)


def ang2pix_ring(nside, z, phi):
    za = np.abs(z)
    tt = np.mod(phi, 2 * np.pi) / (np.pi / 2)
    pix = np.zeros(z.shape, dtype=np.int64)
    eq = za <= 2.0 / 3.0
    # equatorial belt
    t1 = nside * (0.5 + tt[eq])
    t2 = nside * z[eq] * 0.75
    jp = np.floor(t1 - t2).astype(np.int64)
    jm = np.floor(t1 + t2).astype(np.int64)
    ir = nside + 1 + jp - jm
    kshift = 1 - (ir & 1)
    ip = (jp + jm - nside + kshift + 1) // 2
    ip = np.mod(ip, 4 * nside)
    pix[eq] = 2 * nside * (nside - 1) + (ir - 1) * 4 * nside + ip
    # polar caps
    po = ~eq
    tp = tt[po] - np.floor(tt[po])
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.floor(tp * tmp).astype(np.int64)
    jm = np.floor((1 - tp) * tmp).astype(np.int64)
    ir = jp + jm + 1
    ip = np.floor(tt[po] * ir).astype(np.int64)
    ip = np.mod(ip, 4 * ir)
    north = z[po] > 0
    pix[po] = np.where(north, 2 * ir * (ir - 1) + ip, 12 * nside * nside - 2 * ir * (ir + 1) + ip)
    return pix


def spread_bits(v):
    out = np.zeros_like(v)
    for b in range(30):
        out |= ((v >> b) & 1) << (2 * b)
    return out


def ang2pix_nest(nside, z, phi):
    za = np.abs(z)
    tt = np.mod(phi, 2 * np.pi) * 2 / np.pi
    face = np.zeros(z.shape, dtype=np.int64)
    ix = np.zeros(z.shape, dtype=np.int64)
    iy = np.zeros(z.shape, dtype=np.int64)
    eq = za <= 2.0 / 3.0
    t1 = nside * (0.5 + tt[eq])
    t2 = nside * (z[eq] * 0.75)
    jp = np.floor(t1 - t2).astype(np.int64)
    jm = np.floor(t1 + t2).astype(np.int64)
    ifp = jp // nside
    ifm = jm // nside
    face[eq] = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix[eq] = jm & (nside - 1)
    iy[eq] = nside - (jp & (nside - 1)) - 1
    po = ~eq
    ntt = np.minimum(np.floor(tt[po]).astype(np.int64), 3)
    tp = tt[po] - ntt
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum(np.floor(tp * tmp).astype(np.int64), nside - 1)
    jm = np.minimum(np.floor((1 - tp) * tmp).astype(np.int64), nside - 1)
    north = z[po] >= 0
    face[po] = np.where(north, ntt, ntt + 8)
    ix[po] = np.where(north, nside - jm - 1, jp)
    iy[po] = np.where(north, nside - jp - 1, jm)
    return face * nside * nside + spread_bits(ix) + (spread_bits(iy) << 1)


def load_map(path):
    with fits.open(path, memmap=True) as hd:
        h = hd[1].header
        nside = int(h['NSIDE'])
        order = h['ORDERING'].strip().upper()
        temp = np.asarray(hd[1].data['I_STOKES'], dtype=np.float64).ravel()
    assert temp.size == 12 * nside * nside, 'unexpected map size'
    lookup = ang2pix_nest if order.startswith('NEST') else ang2pix_ring
    print('map: nside %d, %s ordering, %d pixels' % (nside, order, temp.size))
    return temp, nside, lookup


def colorize(t_k):
    v = np.clip(t_k * 1e6 / RANGE_UK, -1, 1)
    rgb = np.stack([np.interp(v, STOPS, COLORS[:, k]) for k in range(3)], axis=-1)
    return rgb


def render_disc(temp, nside, lookup):
    n = SIZE * SUPER
    c = (np.arange(n) + 0.5) / n * 2 - 1
    u, v = np.meshgrid(c, -c)                  # v up
    x, y = u / DISC, v / DISC
    r2 = x * x + y * y
    inside = r2 < 1
    # Orthographic view of the northern Galactic hemisphere from above the pole: the line of sight is z.
    zz = np.sqrt(np.clip(1 - r2, 0, 1))
    phi = np.arctan2(y, x)                      # Galactic longitude, l = 0 toward +x
    pix = lookup(nside, zz[inside], phi[inside])
    rgb = np.zeros((n, n, 3))
    rgb[inside] = colorize(temp[pix])
    # Box-filter the supersamples down.
    rgb = rgb.reshape(SIZE, SUPER, SIZE, SUPER, 3).mean(axis=(1, 3))
    # Soft limb, so the disc edge doesn't alias against black.
    rr = np.sqrt((np.meshgrid(np.linspace(-1, 1, SIZE), np.linspace(-1, 1, SIZE))[0]) ** 2
                 + (np.meshgrid(np.linspace(-1, 1, SIZE), np.linspace(-1, 1, SIZE))[1]) ** 2) / DISC
    rgb *= np.clip((1 - rr) * SIZE * DISC / 2, 0, 1)[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def render_mollweide(temp, nside, lookup, w=1600):
    """Whole-sky check image (Mollweide), to confirm the pixel lookup has no seams."""
    h = w // 2
    xs = (np.arange(w) + 0.5) / w * 4 - 2
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    X, Y = np.meshgrid(xs * np.sqrt(2), ys * np.sqrt(2))
    inside = (X / (2 * np.sqrt(2))) ** 2 + (Y / np.sqrt(2)) ** 2 < 1
    th = np.arcsin(np.clip(Y / np.sqrt(2), -1, 1))
    lat = np.arcsin(np.clip((2 * th + np.sin(2 * th)) / np.pi, -1, 1))
    lon = -np.pi * X / (2 * np.sqrt(2) * np.cos(th))   # longitude increases to the left (astronomical)
    pix = lookup(nside, np.sin(lat[inside]), lon[inside])
    rgb = np.zeros((h, w, 3))
    rgb[inside] = colorize(temp[pix])
    return Image.fromarray(rgb.astype(np.uint8))


def main():
    src, out = sys.argv[1], sys.argv[2]
    temp, nside, lookup = load_map(src)
    print('temperature: median %.1f uK, 1-99%% %.0f..%.0f uK' % (
        np.median(temp) * 1e6, *(np.percentile(temp, [1, 99]) * 1e6)))
    render_disc(temp, nside, lookup).save(out, quality=88)
    print('disc ->', out)
    if '--preview' in sys.argv:
        p = sys.argv[sys.argv.index('--preview') + 1]
        render_mollweide(temp, nside, lookup).save(p, quality=85)
        print('mollweide check ->', p)


if __name__ == '__main__':
    main()
