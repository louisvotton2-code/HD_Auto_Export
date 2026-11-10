#!/usr/bin/env python3
"""Freeze source without local data, env, builds, dependencies or private docs."""
import hashlib, json, pathlib, shutil, sys
repo = pathlib.Path(__file__).resolve().parents[2]
out = pathlib.Path(sys.argv[1]).resolve()
if out.exists(): raise SystemExit('Destination must not exist')
exclude = {'node_modules','.next','.data','dist','out','coverage','test-results','playwright-report','__pycache__'}
roots = ['apps/api','apps/web','apps/admin','packages/contracts','packages/calculator-core','deploy/runtime']
files = [repo/p for p in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml']]
files += list(repo.glob('tsconfig*.json'))
for root in roots:
    for p in (repo/root).rglob('*'):
        rel = p.relative_to(repo/root)
        if any(x in exclude for x in rel.parts): continue
        if p.is_symlink(): raise SystemExit(f'Symlink in source: {rel}')
        if not p.is_file() or any(x in exclude for x in rel.parts): continue
        if p.name.startswith('.env') or p.suffix in {'.log','.pem','.key','.tsbuildinfo'}: continue
        files.append(p)
manifest = {}
for p in sorted(set(files)):
    rel = p.relative_to(repo); target = out/rel
    target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(p,target)
    manifest[str(rel)] = hashlib.sha256(target.read_bytes()).hexdigest()
(out/'source-manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
print(f'Frozen {len(manifest)} source files; manifest SHA256 '+hashlib.sha256((out/'source-manifest.json').read_bytes()).hexdigest())
