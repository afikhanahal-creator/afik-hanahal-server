import crypto from 'node:crypto'
import sharp from 'sharp'
import { supabase } from './supabase.js'

// Long-lived cache header for everything we put in Storage. Combined with the
// public CDN this means repeat views are served from the edge, not re-fetched
// from the origin bucket — the single biggest egress win.
export const ONE_YEAR_CACHE = '31536000'

export const IMAGE_BUCKET = 'property-images'
export const VIDEO_BUCKET = 'property-videos'
export const PDF_BUCKET   = 'property-pdfs'

const STORAGE_BUCKETS = [IMAGE_BUCKET, VIDEO_BUCKET, PDF_BUCKET]

// ── Image compression ────────────────────────────────────────────────────────
// Resize to a max width of 1600px (never upscale), convert to WebP @ q80, and
// drop all EXIF/metadata. `.rotate()` first so orientation is baked in before
// the EXIF orientation tag is stripped.
export async function compressImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Returns true if an object already lives at `path` in `bucket`.
async function objectExists(bucket, path) {
  try {
    const { data, error } = await supabase.storage.from(bucket).list('', { search: path, limit: 1 })
    if (error) return false
    return !!data?.some(o => o.name === path)
  } catch {
    return false
  }
}

// Upload a buffer under a content-addressed name (<sha256>.<ext>) so identical
// files are stored exactly once. If the object already exists we skip the
// upload entirely and just return the existing public URL (dedupe).
export async function uploadDeduped(bucket, buffer, { contentType, ext }) {
  const hash = sha256(buffer)
  const path = `${hash}.${ext}`

  if (!(await objectExists(bucket, path))) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, cacheControl: ONE_YEAR_CACHE, upsert: true })
    if (error) throw error
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return { url: data.publicUrl, path, hash, deduped: true }
}

// ── Orphan cleanup ───────────────────────────────────────────────────────────
// Property `data` is an opaque JSONB blob from the frontend, so we discover the
// files a property references by scanning every string for Supabase Storage
// public URLs and mapping them back to { bucket, path }.
const PUBLIC_URL_RE = /\/storage\/v1\/object\/public\/([^/?#]+)\/([^"'\s?#)]+)/g

export function extractStorageObjects(value) {
  const found = [] // { bucket, path }
  const seen = new Set()

  const walk = v => {
    if (v == null) return
    if (typeof v === 'string') {
      let m
      PUBLIC_URL_RE.lastIndex = 0
      while ((m = PUBLIC_URL_RE.exec(v)) !== null) {
        const bucket = decodeURIComponent(m[1])
        const path = decodeURIComponent(m[2])
        if (!STORAGE_BUCKETS.includes(bucket)) continue
        const key = `${bucket}::${path}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ bucket, path })
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk)
    } else if (typeof v === 'object') {
      Object.values(v).forEach(walk)
    }
  }

  walk(value)
  return found
}

// Remove a list of { bucket, path } objects, grouped per bucket. Best-effort:
// errors are logged, never thrown, so they can't block a property delete/update.
export async function removeStorageObjects(objects) {
  if (!supabase || !objects?.length) return
  const byBucket = new Map()
  for (const { bucket, path } of objects) {
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket).push(path)
  }
  for (const [bucket, paths] of byBucket) {
    try {
      const { error } = await supabase.storage.from(bucket).remove(paths)
      if (error) console.warn(`[storage] cleanup ${bucket} failed:`, error.message)
      else console.log(`[storage] removed ${paths.length} orphan object(s) from ${bucket}`)
    } catch (e) {
      console.warn(`[storage] cleanup ${bucket} exception:`, e.message)
    }
  }
}

export const objKey = o => `${o.bucket}::${o.path}`
