import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// In-memory fallback when Supabase is not reachable (lost on server restart)
let memStore = []

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// GET /api/properties
router.get('/', async (req, res) => {
  const admin = isAdmin(req)

  if (supabase) {
    try {
      let query = supabase.from('properties').select('id, data, published, created_at')
      if (!admin) query = query.eq('published', true)
      const { data, error } = await query.order('created_at', { ascending: false })
      if (!error) {
        return res.json(data.map(row => ({ ...row.data, id: row.id, published: row.published })))
      }
      console.warn('[properties] Supabase error, falling back to memory:', error.message)
    } catch (e) {
      console.warn('[properties] Supabase unreachable, falling back to memory:', e.message)
    }
  }

  // In-memory fallback
  return res.json(memStore.filter(p => admin || p.published))
})

// POST /api/properties/bulk — replace entire property list (admin)
router.post('/bulk', requireAdmin, async (req, res) => {
  const props = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected an array' })

  if (supabase) {
    try {
      if (props.length > 0) {
        const rows = props.map(p => ({
          id:        p.id,
          data:      p,
          published: !!p.published,
        }))
        const { error: upsertErr } = await supabase
          .from('properties')
          .upsert(rows, { onConflict: 'id' })
        if (upsertErr) throw upsertErr

        const ids = props.map(p => p.id).filter(Boolean)
        const { error: delErr } = await supabase
          .from('properties')
          .delete()
          .not('id', 'in', `(${ids.join(',')})`)
        if (delErr) throw delErr
      } else {
        const { error } = await supabase.from('properties').delete().neq('id', 0)
        if (error) throw error
      }

      memStore = [...props] // keep memory in sync
      return res.json({ ok: true, count: props.length })
    } catch (e) {
      console.warn('[properties] Supabase write failed, falling back to memory:', e.message)
    }
  }

  // In-memory fallback
  memStore = [...props]
  console.warn('[properties] Saved %d props to memory only (Supabase not configured)', props.length)
  return res.json({ ok: true, count: props.length, warning: 'Supabase not configured — memory only, lost on restart' })
})

export default router
