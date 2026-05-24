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
        const rows = data.map(row => ({ ...row.data, id: row.id, published: row.published }))
        // Keep memory in sync so restarts serve stale data while re-fetching
        if (admin) memStore = [...rows]
        return res.json(rows)
      }
      console.error('[properties] Supabase GET error:', error.message, error.details || '')
    } catch (e) {
      console.error('[properties] Supabase GET exception:', e.message)
    }
  }

  // In-memory fallback
  console.warn('[properties] Serving %d props from memory (Supabase unavailable)', memStore.length)
  return res.json(memStore.filter(p => admin || p.published !== false))
})

// POST /api/properties/bulk — replace entire property list (admin)
router.post('/bulk', requireAdmin, async (req, res) => {
  const props = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected an array' })
  // Safety guard: refuse an empty wipe unless the caller explicitly confirms it
  if (props.length === 0 && req.headers['x-confirm-wipe'] !== '1') {
    return res.status(400).json({ error: 'Refusing empty array — would delete all properties. Send x-confirm-wipe: 1 header to override.' })
  }

  if (supabase) {
    try {
      if (props.length > 0) {
        const rows = props.map(p => ({
          id:        Number(p.id) || p.id,   // coerce to number when possible
          data:      p,
          published: !!p.published,
        }))

        const { error: upsertErr } = await supabase
          .from('properties')
          .upsert(rows, { onConflict: 'id' })
        if (upsertErr) throw upsertErr

        // Delete rows no longer in the list
        const ids = rows.map(r => r.id)
        if (ids.length > 0) {
          // Build a comma-separated list for the NOT IN filter
          const idList = ids.join(',')
          const { error: delErr } = await supabase
            .from('properties')
            .delete()
            .not('id', 'in', `(${idList})`)
          if (delErr) console.warn('[properties] delete-orphans error:', delErr.message)
        }
      } else {
        // Empty array — wipe all
        const { error } = await supabase.from('properties').delete().gte('id', 0)
        if (error) throw error
      }

      memStore = [...props]
      console.log('[properties] Saved %d props to Supabase', props.length)
      return res.json({ ok: true, count: props.length })
    } catch (e) {
      console.error('[properties] Supabase WRITE FAILED:', e.message, e.details || '', e.hint || '')
      // Fall through to memory-only fallback
    }
  }

  // In-memory fallback — data survives until next restart only
  memStore = [...props]
  console.warn('[properties] Saved %d props to MEMORY ONLY — Supabase not configured or failed', props.length)
  return res.json({ ok: true, count: props.length, warning: 'Supabase not available — memory only, data lost on restart' })
})

export default router
