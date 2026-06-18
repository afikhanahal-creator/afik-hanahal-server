import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import multer from 'multer'
import {
  compressImage, uploadDeduped,
  IMAGE_BUCKET, VIDEO_BUCKET, PDF_BUCKET, ONE_YEAR_CACHE,
} from '../lib/storage.js'

const router = Router()

const VIDEO_MAX_MB = Number(process.env.VIDEO_MAX_MB || 150)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for PDFs
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  },
})

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || /\.(mp4|mov|avi|webm|ogg|mkv)$/i.test(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error('Only video files are allowed'))
    }
  },
})

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per image (pre-compression)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

async function ensureBucket(name, opts = {}) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    console.warn(`[upload] listBuckets failed:`, listErr.message)
    return // may still exist — let the upload attempt proceed
  }
  if (buckets?.find(b => b.name === name)) return // already exists

  const { error: createErr } = await supabase.storage.createBucket(name, { public: true, ...opts })
  if (createErr) {
    console.error(`[upload] createBucket '${name}' failed:`, createErr.message)
    throw new Error(
      `Storage bucket "${name}" לא נמצא ולא ניתן ליצור אותו אוטומטית (${createErr.message}). ` +
      `יש ליצור אותו ידנית בלוח הבקרה של Supabase: Storage → New bucket → "${name}" (public).`
    )
  }
  console.log(`[upload] created bucket ${name}`)
}

// POST /api/upload/pdf
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })

  try {
    await ensureBucket(PDF_BUCKET, { fileSizeLimit: 25 * 1024 * 1024, allowedMimeTypes: ['application/pdf'] })

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: 'application/pdf',
        cacheControl: ONE_YEAR_CACHE,
        upsert: true,
      })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage.from(PDF_BUCKET).getPublicUrl(storagePath)

    return res.json({ ok: true, url: urlData.publicUrl, name: req.file.originalname, path: storagePath })
  } catch (e) {
    console.error('[upload pdf]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// ── Cloudinary video upload (unsigned preset) ─────────────────────────────────
// Videos are by far the heaviest objects in egress + storage, so we keep them
// out of Supabase and hand them to Cloudinary's video CDN, which also
// transcodes/compresses on delivery (q_auto). Returns the same { url } contract.
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET

async function uploadVideoToCloudinary(file) {
  const form = new FormData()
  form.append('file', new Blob([file.buffer], { type: file.mimetype || 'video/mp4' }), file.originalname)
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`
  const r = await fetch(endpoint, { method: 'POST', body: form })
  const json = await r.json().catch(() => ({}))
  if (!r.ok || !json.secure_url) {
    throw new Error(json?.error?.message || `Cloudinary upload failed (${r.status})`)
  }
  return json.secure_url
}

// POST /api/upload/video — prefers Cloudinary; never stores video in Supabase
// unless the ALLOW_SUPABASE_VIDEO escape hatch is explicitly set.
router.post('/video', videoUpload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No video file provided' })

  // Preferred path: Cloudinary
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) {
    try {
      const url = await uploadVideoToCloudinary(req.file)
      console.log(`[upload video] → Cloudinary ${Math.round(req.file.size / 1024)}KB`)
      return res.json({ ok: true, url, name: req.file.originalname, storage: 'cloudinary' })
    } catch (e) {
      console.error('[upload video] cloudinary failed:', e.message)
      return res.status(502).json({ error: `Cloudinary upload failed: ${e.message}` })
    }
  }

  // Escape hatch: keep storing in Supabase only if explicitly opted in.
  if (process.env.ALLOW_SUPABASE_VIDEO === 'true') {
    if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })
    try {
      await ensureBucket(VIDEO_BUCKET, { fileSizeLimit: VIDEO_MAX_MB * 1024 * 1024 })
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${Date.now()}_${safeName}`
      const { error: uploadErr } = await supabase.storage
        .from(VIDEO_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'video/mp4',
          cacheControl: ONE_YEAR_CACHE,
          upsert: true,
        })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(storagePath)
      console.log(`[upload video] → Supabase ${storagePath} (${Math.round(req.file.size / 1024)}KB)`)
      return res.json({ ok: true, url: urlData.publicUrl, name: req.file.originalname, storage: 'supabase' })
    } catch (e) {
      console.error('[upload video]', e.message)
      return res.status(500).json({ error: e.message })
    }
  }

  // Default: guide the admin to configure Cloudinary instead of bloating Storage.
  return res.status(501).json({
    error: 'העלאת וידאו ל-Supabase מושבתת כדי לחסוך באחסון ו-egress. ' +
           'יש להגדיר CLOUDINARY_CLOUD_NAME ו-CLOUDINARY_UPLOAD_PRESET בשרת ' +
           '(או להעלות את הסרטון ישירות ל-Cloudinary ולהדביק קישור).',
  })
})

// POST /api/upload/image — compress (WebP, max 1600px, no EXIF) then store
// under a content-hash name (dedupe) with a 1-year cache header.
router.post('/image', imageUpload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No image file provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })

  try {
    await ensureBucket(IMAGE_BUCKET, { fileSizeLimit: 15 * 1024 * 1024 })

    const compressed = await compressImage(req.file.buffer)
    const { url } = await uploadDeduped(IMAGE_BUCKET, compressed, { contentType: 'image/webp', ext: 'webp' })

    console.log(`[upload image] ${Math.round(req.file.size / 1024)}KB → ${Math.round(compressed.length / 1024)}KB webp`)
    return res.json({ ok: true, url, name: req.file.originalname })
  } catch (e) {
    console.error('[upload image]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// POST /api/upload/images — batch upload up to 20 images at once
router.post('/images', imageUpload.array('files', 20), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.files?.length) return res.status(400).json({ error: 'No images provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured' })

  try {
    await ensureBucket(IMAGE_BUCKET, { fileSizeLimit: 15 * 1024 * 1024 })

    const results = await Promise.all(req.files.map(async file => {
      const compressed = await compressImage(file.buffer)
      const { url } = await uploadDeduped(IMAGE_BUCKET, compressed, { contentType: 'image/webp', ext: 'webp' })
      return { url, name: file.originalname }
    }))

    console.log(`[upload images] stored ${results.length} images`)
    return res.json({ ok: true, images: results })
  } catch (e) {
    console.error('[upload images]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

export default router
