import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// GET /api/properties
// - Admin (with Bearer token): returns all properties
// - Public: returns only published properties
router.get('/', async (req, res) => {
  let query = supabase.from('properties').select('id, data, created_at')
  if (!isAdmin(req)) query = query.eq('published', true)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data.map(row => ({ ...row.data, id: row.id })))
})

// POST /api/properties/bulk — replace entire property list (admin)
// The frontend sends the full array; we upsert all and delete removed ones.
router.post('/bulk', requireAdmin, async (req, res) => {
  const props = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected an array' })

  if (props.length > 0) {
    const rows = props.map(p => ({
      id:        p.id,
      data:      p,
      published: !!p.published,
    }))
    const { error: upsertErr } = await supabase
      .from('properties')
      .upsert(rows, { onConflict: 'id' })
    if (upsertErr) return res.status(500).json({ error: upsertErr.message })

    // Remove any rows no longer in the provided array
    const ids = props.map(p => p.id).filter(Boolean)
    const { error: delErr } = await supabase
      .from('properties')
      .delete()
      .not('id', 'in', `(${ids.join(',')})`)
    if (delErr) return res.status(500).json({ error: delErr.message })
  } else {
    // Empty array — delete everything
    const { error } = await supabase.from('properties').delete().neq('id', 0)
    if (error) return res.status(500).json({ error: error.message })
  }

  res.json({ ok: true, count: props.length })
})

export default router
