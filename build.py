#!/usr/bin/env python3
from pathlib import Path
import base64, zipfile, shutil, json, re
ROOT = Path(__file__).parent
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
index = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'styles.css').read_text(encoding='utf-8')
app = (ROOT / 'app.js').read_text(encoding='utf-8')
restaurants = json.loads((ROOT / 'data' / 'restaurants.json').read_text(encoding='utf-8'))
data_js = 'window.BUCKET_LIST_RESTAURANTS = ' + json.dumps(restaurants, ensure_ascii=False) + ';\n'
old_data_js = (ROOT / 'data' / 'restaurants.js').read_text(encoding='utf-8')
if 'window.BUCKET_LIST_CITY_MARKERS = ' in old_data_js:
    data_js += 'window.BUCKET_LIST_CITY_MARKERS = ' + old_data_js.split('window.BUCKET_LIST_CITY_MARKERS = ', 1)[1]
(ROOT / 'data' / 'restaurants.js').write_text(data_js, encoding='utf-8')
png = ROOT / 'bucket-list-restaurants-graphic.png'
# asset-split portable: inline CSS/JS but keep PNG separate
asset = index
asset = asset.replace('<link href="styles.css" rel="stylesheet"/>', '<style>\n' + css + '\n</style>')
asset = asset.replace('<script src="data/restaurants.js"></script>\n<script src="app.js"></script>', '<script>\n' + data_js + '\n</script>\n<script>\n' + app + '\n</script>')
(DIST / 'S Tier Bucket List Restaurants App(5) - modular asset-split.html').write_text(asset, encoding='utf-8')
shutil.copy2(png, DIST / png.name)
# single-file standalone: also inline image
b64 = base64.b64encode(png.read_bytes()).decode('ascii')
standalone = asset.replace('src="bucket-list-restaurants-graphic.png"', 'src="data:image/png;base64,' + b64 + '"')
(DIST / 'S Tier Bucket List Restaurants App(5) - modular standalone.html').write_text(standalone, encoding='utf-8')
# Package source + dist
zip_path = DIST / 'S Tier Bucket List Restaurants App(5) - modular project.zip'
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for path in ROOT.rglob('*'):
        if path == zip_path or '.DS_Store' in path.name: continue
        z.write(path, path.relative_to(ROOT))
print('Built:', zip_path)
