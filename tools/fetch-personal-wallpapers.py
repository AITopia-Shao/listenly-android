"""Fetch optional personal wallpapers; public staging never includes them."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
if not args.download:
    parser.error('Use --download to fetch the optional personal images. Public builds use original SVG backgrounds.')
output = ROOT / '.build' / 'personal-wallpapers'
output.mkdir(parents=True, exist_ok=True)
records = []
for name in ('day', 'night'):
    source = f'https://basicappleguy.com/s/Tahoe_{name.title()}_iPhone.png'
    file = output / (name + '.png')
    subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '90', '--output', str(file), source], check=True)
    data = file.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Wallpaper source did not return a PNG')
    records.append({'name': file.name, 'source': source, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(output / 'sources.json').write_text(json.dumps({'personalOnly': True, 'files': records}, indent=2), encoding='utf-8')
print('Personal wallpaper cache ready. -Demo and CI builds always use the original project backgrounds.')
