#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
DATA = Path(__file__).parent / 'data' / 'restaurants.json'
restaurants = json.loads(DATA.read_text(encoding='utf-8'))
issues = []
seen_ids = set(); seen_ranks = set()
required = ['id','rank','name','city','country','continent','tier','lat','lon','booking_difficulty','dress_code','english_friendliness','dietary_flexibility']
valid_tiers = {'S+','S','S-','Unranked'}
for i, r in enumerate(restaurants, 1):
    prefix = f"#{r.get('rank', i)} {r.get('name','(unnamed)')}"
    for key in required:
        if r.get(key) in (None, ''):
            issues.append(f"{prefix}: missing {key}")
    rid = str(r.get('id',''))
    if rid in seen_ids: issues.append(f"{prefix}: duplicate id {rid}")
    seen_ids.add(rid)
    rank = str(r.get('rank',''))
    if rank in seen_ranks: issues.append(f"{prefix}: duplicate rank {rank}")
    seen_ranks.add(rank)
    if r.get('tier') not in valid_tiers: issues.append(f"{prefix}: invalid tier {r.get('tier')}")
    for coord in ['lat','lon']:
        try: float(r.get(coord))
        except Exception: issues.append(f"{prefix}: invalid {coord}")
    for key in ['maps','website','reservation','michelin','instagram']:
        if r.get(key) and not re.match(r'^https?://', str(r[key])):
            issues.append(f"{prefix}: suspicious {key} URL")
if issues:
    print('\n'.join(issues))
    sys.exit(1)
print(f"Data validation passed: {len(restaurants)} restaurants, {len(seen_ids)} stable ids.")
