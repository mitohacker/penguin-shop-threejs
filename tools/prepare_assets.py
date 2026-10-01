"""Read the original game; write ONLY to this independent project's public/assets.
Copied deployment assets are independent files, never junctions/symlinks. Original
textures are resized only in the copy. A source SHA256 manifest verifies isolation.
"""
import csv, hashlib, json, shutil, re
from pathlib import Path
from urllib.parse import unquote
from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'C:\Dev\AIPrimitiveFun')
ROOT = SOURCE / 'assets/penguin_sort'
DEST = PROJECT / 'public/assets'
DEST.mkdir(parents=True, exist_ok=True)
source_hashes = {}

def record(path):
    source_hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()

def copy(path, dest):
    record(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)

def texture(path, dest, max_size=1024):
    record(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as img:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        if dest.suffix.lower() in ('.jpg', '.jpeg'):
            img.convert('RGB').save(dest, quality=86, optimize=True)
        else:
            img.save(dest, optimize=True)

manifest_path = ROOT / 'source_manifest.json'
record(manifest_path)
manifest = json.loads(manifest_path.read_text('utf-8'))
products, sheets, seen = [], [], set()
for sheet in manifest['sheets']:
    catalog_path = ROOT / sheet['id'] / 'catalog.json'
    record(catalog_path)
    catalog = json.loads(catalog_path.read_text('utf-8'))
    sheets.append({'id': sheet['id'], 'title': sheet['title']})
    for item in catalog['items']:
        path = SOURCE / item['scene'].removeprefix('res://')
        gltf = json.loads(path.read_text('utf-8'))
        record(path)
        for resource in gltf.get('buffers', []) + gltf.get('images', []):
            uri = resource.get('uri', '')
            if not uri or uri.startswith('data:'): continue
            dep = (path.parent / unquote(uri)).resolve()
            # Avoid percent-encoded reserved characters: some static servers
            # preserve %2B rather than resolving it to the literal + filename.
            safe_uri = re.sub(r'[^a-zA-Z0-9._/-]', '-', unquote(uri))
            resource['uri'] = safe_uri
            target = DEST / 'models' / sheet['id'] / safe_uri
            if str(target) in seen: continue
            seen.add(str(target))
            if dep.suffix.lower() in ('.jpg', '.jpeg', '.png'): texture(dep, target)
            else: copy(dep, target)
        (DEST / 'models' / sheet['id'] / path.name).write_text(json.dumps(gltf, separators=(',', ':')), 'utf-8')
        thumb = ROOT / 'thumbnails' / (item['id'] + '.png')
        if thumb.exists(): texture(thumb, DEST / 'thumbnails' / thumb.name, 160)
        products.append({'id': item['id'], 'name': item['name'], 'sheet': sheet['id'], 'size': [round(v * 2, 5) for v in item['size']], 'model': f"./assets/models/{sheet['id']}/{path.name}", 'thumbnail': f"./assets/thumbnails/{item['id']}.png"})

hulls_path = ROOT / 'collision_hulls.json'
record(hulls_path)
hulls = json.loads(hulls_path.read_text('utf-8'))
compact = {}
for item in products:
    points = hulls.get(item['id'], {}).get('points', [])
    # Preserve extrema, then distribute points across the reviewed source hull.
    indexes = set()
    if points:
        for axis in range(3):
            indexes.add(min(range(len(points)), key=lambda i: points[i][axis]))
            indexes.add(max(range(len(points)), key=lambda i: points[i][axis]))
        indexes.update(round(i * (len(points)-1) / 35) for i in range(36))
    compact[item['id']] = [[round(v * 2, 5) for v in points[i]] for i in sorted(indexes)]
(DEST / 'hulls.json').write_text(json.dumps(compact, separators=(',', ':')), 'utf-8')

csv_path = SOURCE / 'scripts/grocery/upgrades.csv'
record(csv_path)
with csv_path.open(encoding='utf-8-sig', newline='') as handle:
    upgrades = {}
    for row in csv.DictReader(handle):
        upgrades.setdefault(row['id'], []).append({k: float(v) for k, v in row.items() if k != 'id'})
(DEST / 'catalog.json').write_text(json.dumps({'products': products, 'sheets': sheets, 'upgrades': upgrades}, separators=(',', ':')), 'utf-8')

# The finished shop's decorative props; don't include editable source sheets.
for path in sorted((ROOT / 'environment/props').glob('*.glb')):
    copy(path, DEST / 'environment' / path.name)

(PROJECT / 'tools/source-integrity.json').write_text(json.dumps(source_hashes, indent=2), 'utf-8')
files = [p for p in DEST.rglob('*') if p.is_file()]
print(f'{len(products)} designs; {len(files)} files; {sum(p.stat().st_size for p in files)/1024/1024:.2f} MiB')
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == h for p, h in source_hashes.items()), 'Original asset changed!'
print('Original source hashes unchanged.')
