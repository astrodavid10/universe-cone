"""web_pack.py - turn the dome kit's web export into what the browser app ships.

    python -I pipeline/web_pack.py <ConeWebKit dir> <out dir> [--glb] [--cmb <SMICA .fits>]

Reads <kit>/public/data/cone/ through cone.json alone, runs the kit's own checker first (fails closed), then
writes <out>/ with these changes, everything else copied byte for byte:

  grid      every 8th rib vertex (4001 -> 501 per rib): the app reveals by s in the shader.
  fog       RGBA8 (7.1 MB) -> R8 (1.8 MB). The kit's RGB is only violet x density and A = 0.55 x density, so A
            carries everything; the app multiplies by the violet as a uniform.
  CMB disc  drawn from the Planck SMICA map by pipeline/cmb_disc.py (`--cmb <fits>`). Without --cmb an existing
            images/cone_cmb_disc.jpg in <out> is kept.
  atlas     the kit's 4096 px JPEG, plus a 2048 px copy for the lite tier. The 10.6 MB PNG is not shipped.
  labels    the baked PNG cards are not shipped; the app sets the text in HTML from cone_labels.json.
  telescope models/jwst.glb: textures re-encoded (<= 1024 px JPEG), names and asset metadata neutralised, then
            with `--glb` simplified and meshopt-compressed by gltf-transform (npx).
  credits   the manifest's credits are replaced by WEB_CREDITS, and per-object working notes are dropped.

The manifest's file names are rewritten to match, and a `web` block records what was done.
"""
import io
import json
import os
import shutil
import struct
import subprocess
import sys

import numpy as np
from PIL import Image

KIT, OUT = sys.argv[1], sys.argv[2]
SRC = os.path.join(KIT, 'public', 'data', 'cone')
HERE = os.path.dirname(os.path.abspath(__file__))

WEB_CREDITS = [
    'Concept, design and dome build: A. David Weigel, INTUITIVE Planetarium, U.S. Space & Rocket Center.',
    'Cosmology: flat LCDM, Planck 2018 VI (H0 67.4, Omega_m 0.315).',
    'CMB: Planck 2015 SMICA map, ESA and the Planck Collaboration (Planck Legacy Archive).',
    'Galaxy images (nearby galaxies standing in for every epoch): DESI Legacy Imaging Surveys DR10, Pan-STARRS1 '
    'Surveys (Chambers et al. 2016), Digitized Sky Survey 2 (STScI; Palomar and UK Schmidt), via CDS hips2fits '
    '(Fernique et al. 2015) and the Legacy Surveys viewer.',
    'Reionization bubbles, fog and particles: schematic.',
]


def mb(path):
    return os.path.getsize(path) / 1e6


def align4(n):
    return (n + 3) & ~3


def thin_grid(layer, table):
    """Keep every 8th rib vertex (4001 -> 501). The dome needed 4001 so a vertex-count reveal grew every frame;
    the app reveals by s in the fragment shader, so the rib only has to be smooth. Rib vertex i sits at
    s = i / (count - 1) (checked here against the cosmology table); rings are kept whole."""
    stride = 8
    raw = open(os.path.join(SRC, layer['file']), 'rb').read()
    dt = {'f32': np.float32, 'u8': np.uint8}
    arrs = {k: np.frombuffer(raw, dt[a['type']], a['count'] * a['components'], a['byteOffset'])
                 .reshape(a['count'], a['components']) for k, a in layer['attributes'].items()}
    keep, objects = [], []
    for o in layer['objects']:
        idx = np.arange(o['start'], o['start'] + o['count'])
        if o['kind'] == 'rib':
            assert (o['count'] - 1) % stride == 0
            s = np.linspace(0, 1, o['count'])
            x = arrs['position'][idx, 0]
            err = np.abs(x - np.interp(s, table['s'], table['x_story'])).max()
            assert err < 1e-4, 'rib %s is not in s order (%.2g)' % (o['name'], err)
            idx = idx[::stride]
        objects.append({**o, 'start': sum(len(k) for k in keep), 'count': len(idx)})
        keep.append(idx)
    sel = np.concatenate(keep)
    out, attrs, off = bytearray(), {}, 0
    for k, a in layer['attributes'].items():
        b = arrs[k][sel].tobytes()
        attrs[k] = {**a, 'byteOffset': off, 'count': int(len(sel))}
        out += b + bytes(align4(len(b)) - len(b))
        off = len(out)
    open(os.path.join(OUT, layer['file']), 'wb').write(out)
    return {**layer, 'byteLength': len(out), 'attributes': attrs, 'objects': objects,
            'ribS': 'rib vertex i is at s = i / (count - 1)'}


def clean_glb(src, dst, max_px):
    """Rewrite a GLB with every embedded image re-encoded as a baseline RGB JPEG no larger than max_px, neutral
    image names, and a plain `asset` block (version and generator only)."""
    b = open(src, 'rb').read()
    jlen = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    bin0 = 20 + jlen + 8
    image_views = {im['bufferView']: im for im in j.get('images', [])}
    for k, im in enumerate(j.get('images', [])):
        im['name'] = 'texture_%d' % k
    blob = bytearray()
    for i, bv in enumerate(j['bufferViews']):
        data = b[bin0 + bv.get('byteOffset', 0): bin0 + bv.get('byteOffset', 0) + bv['byteLength']]
        if i in image_views:
            im = Image.open(io.BytesIO(data)).convert('RGB')
            if max(im.size) > max_px:
                im = im.resize((max_px, max_px * im.size[1] // im.size[0]), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=85)
            data = buf.getvalue()
            image_views[i]['mimeType'] = 'image/jpeg'
        blob += bytes(align4(len(blob)) - len(blob))
        bv['byteOffset'] = len(blob)
        bv['byteLength'] = len(data)
        blob += data
    blob += bytes(align4(len(blob)) - len(blob))
    j['buffers'][0]['byteLength'] = len(blob)
    j['asset'] = {'version': '2.0', 'generator': 'universe-cone pipeline/web_pack.py'}
    j.pop('extras', None)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (align4(len(js)) - len(js))
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def main():
    # 1. The kit's checker reads the export the way an app would and exits 1 on any mismatch.
    cache = os.path.join(HERE, '.cache')
    os.makedirs(cache, exist_ok=True)
    subprocess.run([sys.executable, '-I', os.path.join(KIT, 'pipeline', 'check_web_export.py'), SRC,
                    os.path.join(cache, 'kit_side_view.png')], check=True)

    M = json.load(open(os.path.join(SRC, 'cone.json')))
    os.makedirs(os.path.join(OUT, 'images'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)

    # 2. Geometry.
    for key in ('dots', 'ray', 'years', 'bubbles'):
        shutil.copyfile(os.path.join(SRC, M['layers'][key]['file']), os.path.join(OUT, M['layers'][key]['file']))
    M['layers']['grid'] = thin_grid(M['layers']['grid'], M['cosmologyTable'])

    # 3. Fog: keep the alpha channel only.
    fog = M['layers']['fog']
    sx, sy, sz = fog['size']['x'], fog['size']['y'], fog['size']['z']
    raw = np.fromfile(os.path.join(SRC, fog['file']), np.uint8)
    assert raw.size == sx * sy * sz * 4, 'fog size disagrees with cone.json'
    rgba = raw.reshape(-1, 4)
    a = rgba[:, 3].astype(np.float32)
    # Sanity: RGB really is a fixed violet scaled by the same density (else R8 would lose information).
    nz = a > 8
    ratio = rgba[nz, :3].astype(np.float32) / a[nz, None]
    spread = float(np.abs(ratio - np.median(ratio, axis=0)).max())
    if spread > 0.2:
        sys.exit('fog RGB is not a single colour x density (spread %.3f); keep RGBA' % spread)
    violet = (np.median(ratio, axis=0) * 0.55).tolist()   # colour at density 1 (A = 0.55)
    fog_out = 'cone_fog_r8.bin'
    rgba[:, 3].tofile(os.path.join(OUT, fog_out))
    M['layers']['fog'] = {**fog, 'file': fog_out, 'byteLength': sx * sy * sz, 'kind': 'volumeR8',
                          'channel': 'A of the kit volume: 0.55 x density (0..255)', 'emission': violet}

    # 4. CMB disc, drawn from Planck data.
    disc = os.path.join(OUT, 'images', 'cone_cmb_disc.jpg')
    if '--cmb' in sys.argv:
        fits_path = sys.argv[sys.argv.index('--cmb') + 1]
        subprocess.run([sys.executable, '-I', os.path.join(HERE, 'cmb_disc.py'), fits_path, disc], check=True)
    elif not os.path.exists(disc):
        sys.exit('no CMB disc: pass --cmb <COM_CMB_IQU-smica_1024_R2.01_full.fits> (see pipeline/cmb_disc.py)')
    M['cmb'] = {
        'image': 'images/cone_cmb_disc.jpg', 'story': M['cmb']['story'], 'true': M['cmb']['true'],
        'source': 'Planck 2015 SMICA CMB map (ESA and the Planck Collaboration), north Galactic hemisphere, '
                  'orthographic; the disc fills 94 % of the square',
    }

    # 5. Galaxy atlas, full and lite.
    cards = json.load(open(os.path.join(SRC, M['cardsFile'])))
    atlas = cards['atlas']
    shutil.copyfile(os.path.join(SRC, atlas), os.path.join(OUT, 'images', 'cone_galaxies_atlas.jpg'))
    Image.open(os.path.join(SRC, atlas)).resize((2048, 2048), Image.LANCZOS).save(
        os.path.join(OUT, 'images', 'cone_galaxies_atlas_2k.jpg'), quality=86)
    cards['atlas'] = 'images/cone_galaxies_atlas.jpg'
    cards['atlasLite'] = 'images/cone_galaxies_atlas_2k.jpg'
    cards.pop('atlasPng', None)
    json.dump(cards, open(os.path.join(OUT, M['cardsFile']), 'w'), separators=(',', ':'))

    # 6. Labels: text only.
    labels = json.load(open(os.path.join(SRC, M['labelsFile'])))
    for t in labels['tags']:
        t.pop('png', None)
    json.dump(labels, open(os.path.join(OUT, M['labelsFile']), 'w'), separators=(',', ':'))

    # 7. Telescope.
    glb_out = os.path.join(OUT, 'models', 'jwst.glb')
    pre = os.path.join(cache, 'jwst_clean.glb')
    clean_glb(os.path.join(SRC, M['webb']['file']), pre, 1024)
    optimized = False
    if '--glb' in sys.argv:
        # gltf-transform's sharp/libvips texture step fails on this model's JPEGs on Windows ("colourspace:
        # parameter space not set"); the textures are already re-encoded above, so it only does geometry.
        cmd = ['npx', '--yes', '@gltf-transform/cli@4.2.1', 'optimize', pre, glb_out,
               '--compress', 'meshopt', '--texture-compress', 'false',
               '--simplify-ratio', '0.35', '--simplify-error', '0.0005']
        optimized = subprocess.run(cmd, shell=(os.name == 'nt')).returncode == 0
    if not optimized and not os.path.exists(glb_out):
        shutil.copyfile(pre, glb_out)
    M['webb'] = {'file': 'models/jwst.glb', 'units': M['webb']['units'], 'placement': M['webb']['placement']}

    M['credits'] = WEB_CREDITS
    M['web'] = {
        'packedBy': 'pipeline/web_pack.py',
        'fog': 'R8, emission colour in layers.fog.emission',
        'cmb': 'pipeline/cmb_disc.py from the Planck SMICA map, 1024 px JPEG',
        'atlas': 'cone_cards.json atlas (4096) and atlasLite (2048)',
        'labels': 'HTML text from cone_labels.json; the PNG cards are not shipped',
        'telescope': 'textures <= 1024 px; meshopt + simplify (gltf-transform)' if optimized else 'textures <= 1024 px',
    }
    json.dump(M, open(os.path.join(OUT, 'cone.json'), 'w'), separators=(',', ':'))

    total = 0.0
    for root, _, files in os.walk(OUT):
        for f in sorted(files):
            p = os.path.join(root, f)
            total += mb(p)
            print('%7.2f MB  %s' % (mb(p), os.path.relpath(p, OUT)))
    print('%7.2f MB  total' % total)


if __name__ == '__main__':
    main()
