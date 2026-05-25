import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// In-memory cache — warmed from Supabase on startup, kept in sync on every write
let memStore = []
let supabaseOk = false

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function rowToPublic(row) {
  return { ...row.data, id: row.id, published: row.published }
}

async function writeToSupabase(prop) {
  const row = {
    id:        Number(prop.id) || prop.id,
    data:      prop,
    published: prop.published !== false,
  }
  const { error } = await supabase
    .from('properties')
    .upsert([row], { onConflict: 'id' })
  if (error) throw error
  supabaseOk = true
  // Sync to memStore
  const idx = memStore.findIndex(p => String(p.id) === String(prop.id))
  if (idx >= 0) memStore[idx] = { ...prop }
  else           memStore.unshift({ ...prop })
}

async function deleteFromSupabase(id) {
  const { error } = await supabase
    .from('properties')
    .delete()
    .eq('id', Number(id) || id)
  if (error) throw error
  supabaseOk = true
  memStore = memStore.filter(p => String(p.id) !== String(id))
}

// ── Startup preload ────────────────────────────────────────────────────────────
// Called from index.js — warms memStore so data survives restarts even before
// the first admin request.
export async function preloadFromSupabase() {
  if (!supabase) {
    console.error('[properties] ⚠️  SUPABASE NOT CONFIGURED — properties will be LOST on restart!')
    console.error('[properties] ⚠️  Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars in Render.com dashboard.')
    return
  }
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id, data, published, created_at')
      .order('created_at', { ascending: false })
    if (error) { console.error('[properties] Startup read FAILED:', error.message); return }
    memStore = data.map(rowToPublic)
    supabaseOk = true
    console.log('[properties] ✓ Loaded %d properties from Supabase on startup', memStore.length)
  } catch (e) {
    console.error('[properties] Startup exception:', e.message)
  }
}

// ── GET /api/properties — list all (public: published only; admin: all) ────────
router.get('/', async (req, res) => {
  const admin = isAdmin(req)

  if (supabase) {
    try {
      let q = supabase.from('properties').select('id, data, published, created_at')
      if (!admin) q = q.eq('published', true)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (!error) {
        const rows = data.map(rowToPublic)
        memStore = [...rows]
        supabaseOk = true
        return res.json(rows)
      }
      console.error('[properties] GET error:', error.message)
    } catch (e) {
      console.error('[properties] GET exception:', e.message)
    }
  }

  console.warn('[properties] Serving %d props from memory (Supabase unavailable)', memStore.length)
  return res.json(memStore.filter(p => admin || p.published !== false))
})

// ── GET /api/properties/status — Supabase health (admin) ──────────────────────
router.get('/status', requireAdmin, (req, res) => {
  res.json({
    supabaseConfigured: !!supabase,
    supabaseReachable:  supabaseOk,
    cachedCount:        memStore.length,
    warning: (!supabase || !supabaseOk)
      ? 'Supabase unavailable — data in memory only, lost on restart!'
      : null,
  })
})

// ── GET /api/properties/export — full JSON backup (admin) ─────────────────────
router.get('/export', requireAdmin, async (req, res) => {
  // Always try Supabase first for freshest data
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('id, data, published, created_at, updated_at')
        .order('created_at', { ascending: false })
      if (!error) {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Content-Disposition', `attachment; filename="properties-backup-${new Date().toISOString().slice(0,10)}.json"`)
        return res.json({ exportedAt: new Date().toISOString(), count: data.length, properties: data.map(rowToPublic) })
      }
    } catch {}
  }
  // Fallback to memory
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="properties-backup-${new Date().toISOString().slice(0,10)}.json"`)
  res.json({ exportedAt: new Date().toISOString(), count: memStore.length, source: 'memory', properties: [...memStore] })
})

// ── PUT /api/properties/:id — upsert a single property (admin) ────────────────
// Safe: only touches ONE row. Will never affect other properties.
router.put('/:id', requireAdmin, async (req, res) => {
  const prop = req.body
  if (!prop || typeof prop !== 'object') return res.status(400).json({ error: 'Expected a property object' })

  const id = req.params.id
  const propWithId = { ...prop, id: Number(id) || id, updatedAt: Date.now() }

  if (supabase) {
    try {
      await writeToSupabase(propWithId)
      console.log('[properties] ✓ Upserted property %s to Supabase (total: %d)', id, memStore.length)
      return res.json({ ok: true, id, storage: 'supabase' })
    } catch (e) {
      console.error('[properties] ⚠️  Supabase upsert FAILED for property %s:', id, e.message)
    }
  }

  // Memory-only fallback
  const idx = memStore.findIndex(p => String(p.id) === String(id))
  if (idx >= 0) memStore[idx] = { ...propWithId }
  else           memStore.unshift({ ...propWithId })
  console.warn('[properties] ⚠️  Saved property %s to MEMORY ONLY', id)
  return res.json({ ok: true, id, storage: 'memory', warning: 'Supabase unavailable — data will be lost on restart!' })
})

// ── DELETE /api/properties/:id — delete a single property (admin) ─────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id

  if (supabase) {
    try {
      await deleteFromSupabase(id)
      console.log('[properties] ✓ Deleted property %s from Supabase (total: %d)', id, memStore.length)
      return res.json({ ok: true, id, storage: 'supabase' })
    } catch (e) {
      console.error('[properties] ⚠️  Supabase delete FAILED for property %s:', id, e.message)
    }
  }

  // Memory-only fallback
  memStore = memStore.filter(p => String(p.id) !== String(id))
  console.warn('[properties] ⚠️  Deleted property %s from MEMORY ONLY', id)
  return res.json({ ok: true, id, storage: 'memory', warning: 'Supabase unavailable — data will be lost on restart!' })
})

// ── POST /api/properties/import — restore from a backup JSON (admin) ──────────
router.post('/import', requireAdmin, async (req, res) => {
  const { properties: props } = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected { properties: [...] }' })
  if (props.length === 0)    return res.status(400).json({ error: 'Backup is empty' })

  if (supabase) {
    try {
      const rows = props.map(p => ({ id: Number(p.id) || p.id, data: p, published: p.published !== false }))
      const { error } = await supabase.from('properties').upsert(rows, { onConflict: 'id' })
      if (error) throw error
      memStore = [...props]
      supabaseOk = true
      console.log('[properties] ✓ Imported %d properties from backup', props.length)
      return res.json({ ok: true, count: props.length, storage: 'supabase' })
    } catch (e) {
      console.error('[properties] Import to Supabase FAILED:', e.message)
    }
  }

  memStore = [...props]
  return res.json({ ok: true, count: props.length, storage: 'memory', warning: 'Supabase unavailable' })
})

// ── POST /api/properties/bulk — replace full list (legacy + admin tools) ───────
// Keep this for backward compat but individual PUT/:id is now preferred.
router.post('/bulk', requireAdmin, async (req, res) => {
  const props = req.body
  if (!Array.isArray(props)) return res.status(400).json({ error: 'Expected an array' })
  if (props.length === 0 && req.headers['x-confirm-wipe'] !== '1') {
    return res.status(400).json({ error: 'Refusing empty array — send x-confirm-wipe: 1 header to override.' })
  }

  if (supabase) {
    try {
      if (props.length > 0) {
        const rows = props.map(p => ({ id: Number(p.id) || p.id, data: p, published: p.published !== false }))
        const { error: upsertErr } = await supabase.from('properties').upsert(rows, { onConflict: 'id' })
        if (upsertErr) throw upsertErr
        const ids = rows.map(r => r.id)
        const { error: delErr } = await supabase.from('properties').delete().not('id', 'in', `(${ids.join(',')})`)
        if (delErr) console.warn('[properties] delete-orphans error:', delErr.message)
      } else {
        const { error } = await supabase.from('properties').delete().gte('id', 0)
        if (error) throw error
      }
      memStore = [...props]
      supabaseOk = true
      console.log('[properties] ✓ Bulk saved %d properties to Supabase', props.length)
      return res.json({ ok: true, count: props.length, storage: 'supabase' })
    } catch (e) {
      console.error('[properties] ⚠️  Bulk write FAILED:', e.message, e.details || '')
    }
  }

  memStore = [...props]
  console.warn('[properties] ⚠️  Bulk saved %d props to MEMORY ONLY', props.length)
  return res.json({ ok: true, count: props.length, storage: 'memory', warning: 'Supabase unavailable — data will be lost on restart!' })
})

export default router
