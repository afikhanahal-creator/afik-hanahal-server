import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// POST /api/contacts — save a contact lead (public endpoint)
router.post('/', async (req, res) => {
  const { name, phone, email, msg, propTitle, propLocation, source } = req.body
  if (!name && !phone) return res.status(400).json({ error: 'name or phone required' })

  const { error } = await supabase.from('contacts').insert([{
    name,
    phone,
    email,
    message:       msg,
    prop_title:    propTitle,
    prop_location: propLocation,
    source:        source || 'website',
  }])

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ ok: true })
})

// GET /api/contacts — admin only
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
