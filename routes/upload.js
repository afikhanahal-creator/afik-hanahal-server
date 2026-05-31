import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import multer from 'multer'

const router = Router()

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
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB for videos
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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per image
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
    await ensureBucket('property-pdfs', { fileSizeLimit: 25 * 1024 * 1024, allowedMimeTypes: ['application/pdf'] })

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from('property-pdfs')
      .upload(storagePath, req.file.buffer, { contentType: 'application/pdf', upsert: false })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage.from('property-pdfs').getPublicUrl(storagePath)

    return res.json({ ok: true, url: urlData.publicUrl, name: req.file.originalname, path: storagePath })
  } catch (e) {
    console.error('[upload pdf]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// POST /api/upload/video — stores to Supabase Storage, returns permanent public URL
router.post('/video', videoUpload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No video file provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })

  try {
    await ensureBucket('property-videos', { fileSizeLimit: 150 * 1024 * 1024 })

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from('property-videos')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || 'video/mp4',
        upsert: false,
      })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage.from('property-videos').getPublicUrl(storagePath)

    console.log(`[upload video] stored ${storagePath} (${Math.round(req.file.size / 1024)}KB)`)
    return res.json({ ok: true, url: urlData.publicUrl, name: req.file.originalname })
  } catch (e) {
    console.error('[upload video]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// POST /api/upload/image — stores to Supabase Storage property-images, returns permanent public URL
router.post('/image', imageUpload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No image file provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })

  try {
    await ensureBucket('property-images', { fileSizeLimit: 15 * 1024 * 1024 })

    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '')
    const storagePath = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('property-images')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: false,
      })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(storagePath)

    console.log(`[upload image] stored ${storagePath} (${Math.round(req.file.size / 1024)}KB)`)
    return res.json({ ok: true, url: urlData.publicUrl, name: req.file.originalname })
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
    await ensureBucket('property-images', { fileSizeLimit: 15 * 1024 * 1024 })

    const results = await Promise.all(req.files.map(async file => {
      const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '')
      const storagePath = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage
        .from('property-images')
        .upload(storagePath, file.buffer, { contentType: file.mimetype || 'image/jpeg', upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('property-images').getPublicUrl(storagePath)
      return { url: data.publicUrl, name: file.originalname }
    }))

    console.log(`[upload images] stored ${results.length} images`)
    return res.json({ ok: true, images: results })
  } catch (e) {
    console.error('[upload images]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

export default router
