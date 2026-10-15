// Build a source-only release from HEAD plus the reviewed pricing files.
// Does not include unrelated working-tree changes, .env, or local output folders.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Use Git archive as baseline and Python's standard ZIP library for the overlay.
const files = [
  '.env.example','api/sheet-tools.js','api/_lib/pricing.js','api/_lib/pricingData.js','api/_lib/pricingStore.js',
  'shared/roles.js','shared/pricing.js','shared/pricingCatalog.js','shared/pricingPresets.js','shared/pricingComparison.js','shared/pricingFamilies.js','shared/productGroup.js','api/_lib/productGroup.js',
  'src/App.jsx','src/pages/Pricing.jsx','src/pages/TikTokPricing.jsx','src/pages/TikTokWorksheet.jsx','src/pages/TikTokWorksheet.css','src/pages/Pricing.css','src/data/pricingDemo.js','shared/tiktokPricing.js','test/tiktok-pricing.test.js',
  'src/pages/ShopeeCompact.css','src/pages/ShopeeUltraman.css','src/pages/TikTokUltraman.css','src/components/PricingHero.jsx','test/tiktok-worksheet-parity.test.js',
  'src/pages/PricingTypography.css',
  'test/pricing.test.js','test/pricing-api.test.js','test/pricing-data.test.js','test/pricing-families.test.js',
  'scripts/pricing-preflight.mjs','scripts/pricing-smoke.mjs','scripts/pricing-release-package.mjs',
  'docs/pricing-setup.th.md','docs/payi-pricing-plan.th.md',
]
const dir=resolve('output/pricing-release')
mkdirSync(dir,{recursive:true})
writeFileSync(`${dir}/base.zip`,execFileSync('git',['archive','--format=zip','HEAD'],{maxBuffer:100*1024*1024}))
writeFileSync(`${dir}/overlay.json`, JSON.stringify({files, root:process.cwd(), dir}))
const python = process.env.PRICING_PYTHON || 'python'
execFileSync(python,['-c',`import json,zipfile,pathlib,sys
p=json.load(open(sys.argv[1],encoding='utf-8')); d=pathlib.Path(p['dir']); root=pathlib.Path(p['root']); changed=set(p['files'])
with zipfile.ZipFile(d/'base.zip') as src, zipfile.ZipFile(d/'payi-pricing-source.zip','w',zipfile.ZIP_DEFLATED) as out:
 for i in src.infolist():
  if i.filename not in changed: out.writestr(i,src.read(i.filename))
 for name in p['files']: out.write(root/name,name)
`,`${dir}/overlay.json`])
writeFileSync(`${dir}/manifest.json`,JSON.stringify({baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),archiveSha256:createHash('sha256').update(readFileSync(`${dir}/payi-pricing-source.zip`)).digest('hex')},null,2))
console.log('Created output/pricing-release/payi-pricing-source.zip with manifest; secrets and unrelated changes excluded')
