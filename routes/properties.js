import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// In-memory cache — warmed from Supabase on startup, kept in sync on every write
let memStore = []
let supabaseOk = false   // flips to true once we get a successful read from Supabase

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// Called from index.js at startup — pre-warms memStore from Supabase so the
// cache is never empty after a restart even before the first admin request.
export async function preloadFromSupabase() {
  if (!supabase) {
    console.error('[properties] ⚠️  SUPABASE NOT CONFIGURED — properties will be LOST on restart!')
    console.error('[properties] ⚠️  Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.')
    return
  }
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id, data, published, created_at')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[properties] Startup Supabase read FAILED:', error.message)
      return
    }
    memStore = data.map(row => ({ ...row.data, id: row.id, published: row.published }))
    supabaseOk = true
    console.log('[properties] ✓ Loaded %d properties from Supabase on startup', memStore.length)
  } catch (e) {
    console.error('[properties] Startup Supabase exception:', e.message)
  }
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
        memStore = [...rows]   // keep cache in sync with every successful read
        supabaseOk = true
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

// GET /api/properties/status — health check (admin only)
router.get('/status', requireAdmin, (req, res) => {
  res.json({
    supabaseConfigured: !!supabase,
    supabaseReachable:  supabaseOk,
    cachedCount:        memStore.length,
    warning:            (!supabase || !supabaseOk)
      ? 'Supabase unavailable — data stored in memory only and will be lost on restart!'
      : null,
  })
})

// POST /api/properties/bulk — replace entire property list (admin)
router.post('/bulk', requireAdmin, async (req, res) => {
  const props = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected an array' })

  // Safety guard: never allow an accidental full wipe
  if (props.length === 0 && req.headers['x-confirm-wipe'] !== '1') {
    return res.status(400).json({
      error: 'Refusing empty array — would delete all properties. Send x-confirm-wipe: 1 header to override.',
    })
  }

  if (supabase) {
    try {
      if (props.length > 0) {
        const rows = props.map(p => ({
          id:        Number(p.id) || p.id,
          data:      p,
          published: p.published !== false,   // default true if missing
        }))

        // Upsert all current properties
        const { error: upsertErr } = await supabase
          .from('properties')
          .upsert(rows, { onConflict: 'id' })
        if (upsertErr) throw upsertErr

        // Delete rows no longer in the list
        const ids = rows.map(r => r.id)
        const { error: delErr } = await supabase
          .from('properties')
          .delete()
          .not('id', 'in', `(${ids.join(',')})`)
        if (delErr) console.warn('[properties] delete-orphans error:', delErr.message)
      } else {
        // Confirmed wipe
        const { error } = await supabase.from('properties').delete().gte('id', 0)
        if (error) throw error
      }

      memStore = [...props]
      supabaseOk = true
      console.log('[properties] ✓ Saved %d properties to Supabase', props.length)
      return res.json({ ok: true, count: props.length, storage: 'supabase' })
    } catch (e) {
      console.error('[properties] ⚠️  Supabase WRITE FAILED — falling back to memory:', e.message, e.details || '', e.hint || '')
      // Fall through to memory-only fallback
    }
  }

  // Memory-only fallback
  memStore = [...props]
  console.warn('[properties] ⚠️  Saved %d props to MEMORY ONLY — data will be LOST on server restart!', props.length)
  return res.json({
    ok: true,
    count: props.length,
    storage: 'memory',
    warning: 'Supabase unavailable — data stored in memory only and will be lost on restart!',
  })
})

export default router
