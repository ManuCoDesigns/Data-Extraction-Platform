#!/usr/bin/env python3
"""
atlas_extractor.py — Australian Operating Mines 2024 →  Supplier Graph
=============================================================================
Fetches live GeoJSON from the Atlas Gov AU API or uses existing ZIP,
maps each mine to BGS Supplier Graph schema + Atlas extras fields,
and uploads directly to an  source.

Usage:
  python atlas_extractor.py --upload --source-id <uuid> --email admin@x.com --password pass
  python atlas_extractor.py --input-zip Atlas_Australia_517_mines.zip --upload --source-id <uuid> ...

pip install requests
"""
import sys, json, re, argparse, zipfile, io
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

ATLAS_GEOJSON_URL = (
    "https://services.ga.gov.au/gis/rest/services/AusOperatingMines/MapServer/0/query"
    "?where=1%3D1&outFields=*&f=geojson&resultRecordCount=2000"
)
ATLAS_SOURCE_URL = "https://digital.atlas.gov.au/datasets/australian-operating-mines-2024"
ATLAS_DOI = "10.26186/150821"

COMMODITY_SECTOR = {
    'precious metals': 'metals mining', 'base metals': 'metals mining',
    'battery': 'metals mining', 'alloy metals': 'metals mining',
    'iron ore': 'metals mining', 'manganese': 'metals mining',
    'uranium': 'metals mining', 'rare earth': 'metals mining',
    'diamond': 'metals mining', 'tin': 'metals mining', 'tungsten': 'metals mining',
    'high-purity elements': 'industrial minerals',
    'graphite': 'industrial minerals', 'potash': 'industrial minerals',
    'silica': 'industrial minerals', 'phosphate': 'industrial minerals',
    'heavy mineral sands': 'industrial minerals', 'bauxite': 'construction minerals',
    'coal': 'coal',
}

def get_sector(commodity):
    if not commodity: return 'metals mining'
    c = commodity.lower()
    for k, v in COMMODITY_SECTOR.items():
        if k in c: return v
    return 'metals mining'

def make_canonical(name):
    n = str(name).lower().strip()
    n = n.replace('&', 'and')
    n = re.sub(r'\s+', '-', n)
    n = re.sub(r'[^a-z0-9\-]', '', n)
    return re.sub(r'-+', '-', n).strip('-')

def build_supplier(idx, name, state, status, commodity, lat, lon):
    return {
        'supplier_id': None, 'duns_number': None,
        'company_name': name, 'canonical_name': make_canonical(name),
        'headquarters_location': None, 'website': None, 'company_description': None,
        'industry_sector': get_sector(commodity),
        'supply_chain_tier': 1,
        'typical_lead_time_days': None, 'is_verified': False,
        'manufacturing_sites': [{
            'location': f'{name} ({lat:.6f}, {lon:.6f})',
            'country': 'Australia', 'site_type': 'mine',
            'raw': f'{name}, {state}, {status}, {commodity}, lat {lat}, long {lon}. Source: Australian Operating Mines 2024, Geoscience Australia, https://doi.org/{ATLAS_DOI}',
        }],
        'certification_references': [], 'certifications_raw': None, 'regulation_references': [],
        'products_offered': [{
            'product_name': commodity, 'grade': None,
            'product_id': f'{idx}_{make_canonical(commodity)[:10].upper()}',
            'category': commodity, 'source_url': ATLAS_SOURCE_URL,
            'datasheet_url': None, 'cross_graph_material_id': None,
        }] if commodity else [],
        'data_completeness_flags': {'review_score': 'manual_only', 'defect_rate_ppm': 'manual_only',
            'on_time_delivery_rate': 'manual_only', 'pricing': 'api_only', 'inventory_levels': 'api_only'},
        'sources': [{'source_name': 'Australian Operating Mines 2024, Geoscience Australia',
            'source_url': ATLAS_SOURCE_URL, 'doi': ATLAS_DOI, 'tier': 'tier1'}],
        # EXTRAS
        'state': state, 'operational_status': status,
        'latitude': round(lat, 6), 'longitude': round(lon, 6),
        'source_doi': ATLAS_DOI,
    }

def from_geojson(url):
    print(f'  Fetching {url}...')
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    features = r.json().get('features', [])
    records = []
    for i, f in enumerate(features):
        p = f.get('properties', {})
        coords = f.get('geometry', {}).get('coordinates', [None, None])
        records.append(build_supplier(
            i+1,
            p.get('MINE_NAME') or p.get('name') or f'Mine_{i+1}',
            p.get('STATE_TERR') or p.get('state') or 'AU',
            p.get('STATUS') or 'Operating mine',
            p.get('COMMODITIES') or p.get('commodity') or '',
            coords[1] or 0, coords[0] or 0,
        ))
    return records

def from_zip(zip_path):
    records = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if not name.endswith('.json'): continue
            data = json.loads(zf.read(name))
            records.append(data)
    return records

def upload(records, source_id, base_url, email, password):
    s = requests.Session()
    s.headers['Content-Type'] = 'application/json'
    r = s.post(f'{base_url}/api/v1/auth/login', json={'email': email, 'password': password})
    r.raise_for_status()
    s.headers['Authorization'] = f"Bearer {r.json()['access_token']}"
    content = json.dumps(records, ensure_ascii=False, indent=2).encode()
    r = s.post(f'{base_url}/api/v1/sources/{source_id}/upload',
               files={'file': ('atlas_mines.json', io.BytesIO(content), 'application/json')},
               headers={k: v for k, v in s.headers.items() if k != 'Content-Type'})
    r.raise_for_status()
    return r.json()

def main():
    p = argparse.ArgumentParser(description='Atlas Australia Mines → ')
    p.add_argument('--input-zip', help='Use existing ZIP instead of live fetch')
    p.add_argument('--output', default='./atlas_output.json', help='Output JSON path')
    p.add_argument('--upload', action='store_true')
    p.add_argument('--source-id')
    p.add_argument('--url', default='https://-platform-production.up.railway.app')
    p.add_argument('--email'); p.add_argument('--password')
    args = p.parse_args()

    print('\n[1/3] Loading Atlas data...')
    if args.input_zip and Path(args.input_zip).exists():
        records = from_zip(args.input_zip)
        print(f'  Loaded {len(records)} records from ZIP')
    else:
        try:
            records = from_geojson(ATLAS_GEOJSON_URL)
            print(f'  Fetched {len(records)} records from Atlas API')
        except Exception as e:
            sys.exit(f'API fetch failed: {e}. Try --input-zip with an existing ZIP file.')

    print('\n[2/3] Saving...')
    with open(args.output, 'w') as f:
        json.dump(records, f, ensure_ascii=False, indent=2, default=str)
    print(f'  Saved {len(records)} records → {args.output}')

    if args.upload and args.source_id:
        print('\n[3/3] Uploading to ...')
        result = upload(records, args.source_id, args.url, args.email, args.password)
        print(f'  ✓ {result.get("valid_rows")}/{result.get("total_rows")} valid records uploaded')
    else:
        print('\n[3/3] Skipped upload (no --upload --source-id)')

    print(f'\nDone. {len(records)} mines extracted.\n')

if __name__ == '__main__':
    main()
