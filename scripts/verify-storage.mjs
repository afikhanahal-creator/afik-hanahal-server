// Verifies the storage/egress optimizations against your LIVE Supabase project.
// Run with your real env vars set (locally or in the Render shell):
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run verify:storage
//
// It checks: (1) the public buckets exist and are public, (2) a freshly
// uploaded object actually carries cache-control: max-age=31536000 via the CDN,
// (3) sharp compression produces WebP, (4) whether Cloudinary is configured for
// video. Exits non-zero if any hard check fails. Read-only except for a single
// tiny temp object it uploads and then deletes.

import sharp from 'sharp'
import { supabase } from '../lib/supabase.js'
import {
  compressImage, IMAGE_BUCKET, PDF_BUCKET, VIDEO_BUCKET, ONE_YEAR_CACHE,
} from '../lib/storage.js'

const ok   = m => console.log(`  ✓ ${m}`)
const warn = m => console.log(`  ⚠️  ${m}`)
const bad  = m => { console.log(`  ✗ ${m}`); failures++ }
let failures = 0

console.log('\n── Storage / egress verification ──\n')

if (!supabase) {
  console.error('✗ Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY, then re-run.')
  process.exit(1)
}

// 1. Buckets exist and are public ─────────────────────────────────────────────
console.log('1. Buckets')
const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
if (bErr) {
  bad(`listBuckets failed: ${bErr.message}`)
} else {
  for (const name of [IMAGE_BUCKET, PDF_BUCKET]) {
    const b = buckets.find(x => x.name === name)
    if (!b) bad(`bucket "${name}" missing — create it as a public bucket`)
    else if (!b.public) bad(`bucket "${name}" is PRIVATE — make it public so the CDN can serve it`)
    else ok(`bucket "${name}" exists and is public`)
  }
  const vid = buckets.find(x => x.name === VIDEO_BUCKET)
  if (vid) warn(`bucket "${VIDEO_BUCKET}" exists — videos should live on Cloudinary; consider clearing it`)
}

// 2. Image compression produces WebP ──────────────────────────────────────────
console.log('\n2. Image compression (sharp)')
try {
  const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 90, b: 40 } } }).png().toBuffer()
  const webp = await compressImage(png)
  const meta = await sharp(webp).metadata()
  if (meta.format === 'webp' && meta.width === 1600) ok(`3000px PNG → ${meta.format} @ ${meta.width}px, ${png.length}B → ${webp.length}B`)
  else bad(`unexpected output: format=${meta.format} width=${meta.width}`)
} catch (e) {
  bad(`compression failed: ${e.message}`)
}

// 3. Cache-Control round-trip via the public CDN URL ──────────────────────────
console.log('\n3. Cache-Control on a fresh upload')
const probePath = `_verify/cache-probe-${Date.now()}.webp`
try {
  const probe = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } } }).webp().toBuffer()
  const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET)
    .upload(probePath, probe, { contentType: 'image/webp', cacheControl: ONE_YEAR_CACHE, upsert: true })
  if (upErr) throw upErr
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(probePath)
  const res = await fetch(data.publicUrl, { cache: 'no-store' })
  const cc = res.headers.get('cache-control') || ''
  if (res.ok && /max-age=31536000/.test(cc)) ok(`public object served with "${cc}"`)
  else if (res.ok) bad(`object reachable but cache-control="${cc}" (expected max-age=31536000)`)
  else bad(`public URL not reachable (HTTP ${res.status}) — is the bucket public?`)
} catch (e) {
  bad(`cache-control check failed: ${e.message}`)
} finally {
  await supabase.storage.from(IMAGE_BUCKET).remove([probePath]).catch(() => {})
}

// 4. Cloudinary (video) configuration ─────────────────────────────────────────
console.log('\n4. Video hosting (Cloudinary)')
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET) {
  ok(`Cloudinary configured (cloud="${process.env.CLOUDINARY_CLOUD_NAME}") — videos bypass Supabase`)
} else if (process.env.ALLOW_SUPABASE_VIDEO === 'true') {
  warn('Cloudinary NOT set but ALLOW_SUPABASE_VIDEO=true — videos still go to Supabase (heavy egress)')
} else {
  warn('Cloudinary NOT set — /api/upload/video will return a guiding error until configured')
}

console.log(`\n── ${failures ? `${failures} check(s) FAILED` : 'All hard checks passed'} ──\n`)
process.exit(failures ? 1 : 0)
