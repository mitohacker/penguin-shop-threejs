"""Package the independent static game beneath one project-named folder."""
import hashlib, json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
ZIP = ROOT / 'PenguinShopThreeJS-web.zip'
files = sorted(p for p in DIST.rglob('*') if p.is_file())
assert (DIST / 'index.html').is_file(), 'Run the production build first.'
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for p in files:
        archive.write(p, 'PenguinShopThreeJS/' + p.relative_to(DIST).as_posix())
    archive.writestr('PenguinShopThreeJS/README.txt', '''Penguin Shop - Three.js browser game

Serve this folder through an HTTP server, then open index.html in a browser.
Opening index.html as a file will not load ES modules and models.

To submit to CrazyGames, upload the game files inside this folder through the
developer portal. Enable Data Module progress saving. Test native fullscreen,
gameplay start/stop and saves in the portal preview before submitting.

The project is independent of the Godot game. Browser saves use separate keys.
No advertisements are requested in this Basic Launch version.
''')
with zipfile.ZipFile(ZIP) as archive:
    assert archive.testzip() is None, 'Archive CRC verification failed.'
    assert all(name.split('/')[0] == 'PenguinShopThreeJS' for name in archive.namelist())
    assert 'PenguinShopThreeJS/index.html' in archive.namelist()
source_hashes = json.loads((ROOT / 'tools/source-integrity.json').read_text('utf-8'))
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == h for p, h in source_hashes.items()), 'Original source assets changed.'
report = {
    'buildDirectory': str(DIST), 'zip': str(ZIP), 'archiveRoot': 'PenguinShopThreeJS',
    'runtimeFiles': len(files), 'buildBytes': sum(p.stat().st_size for p in files),
    'zipBytes': ZIP.stat().st_size, 'zipCRCVerified': True,
    'originalSourceFilesVerified': len(source_hashes), 'originalSourceUnchanged': True,
}
(ROOT / 'test-results').mkdir(exist_ok=True)
(ROOT / 'test-results/build-report.json').write_text(json.dumps(report, indent=2), 'utf-8')
print(json.dumps(report, indent=2))
