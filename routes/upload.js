import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import multer from 'multer'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  },
})

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

async function ensureBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets()
    if (!buckets?.find(b => b.name === 'property-pdfs')) {
      await supabase.storage.createBucket('property-pdfs', {
        public: true,
        fileSizeLimit: 25 * 1024 * 1024,
        allowedMimeTypes: ['application/pdf'],
      })
      console.log('[upload] created bucket property-pdfs')
    }
  } catch (e) {
    console.warn('[upload] bucket check failed:', e.message)
  }
}

// POST /api/upload/pdf
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided' })
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })

  try {
    await ensureBucket()

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-￿-]/g, '_')
    const storagePath = `${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from('property-pdfs')
      .upload(storagePath, req.file.buffer, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage
      .from('property-pdfs')
      .getPublicUrl(storagePath)

    return res.json({
      ok: true,
      url: urlData.publicUrl,
      name: req.file.originalname,
      path: storagePath,
    })
  } catch (e) {
    console.error('[upload pdf]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

export default router
