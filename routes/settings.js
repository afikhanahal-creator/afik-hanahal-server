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

// In-memory fallback
let MEM = {}

// GET /api/settings — admin only, returns all settings
router.get('/', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  if (supabase) {
    const { data, error } = await supabase
      .from('site_config')
      .select('key, value')
      .eq('key', 'admin_settings')
      .single()
    if (!error && data) {
      MEM = typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : {}
      return res.json(MEM)
    }
    if (error && error.code !== 'PGRST116') // PGRST116 = no rows
      console.warn('[settings] supabase read:', error.message)
  }
  return res.json(MEM)
})

// POST /api/settings — admin only, merges patch into existing settings
router.post('/', requireAdmin, async (req, res) => {
  const patch = req.body
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'body must be a JSON object' })

  MEM = { ...MEM, ...patch }

  if (supabase) {
    const { error } = await supabase
      .from('site_config')
      .upsert({ key: 'admin_settings', value: MEM }, { onConflict: 'key' })
    if (error) {
      console.error('[settings] supabase upsert:', error.message)
      return res.status(500).json({ error: error.message })
    }
    console.log('[settings] saved keys:', Object.keys(patch).join(', '))
  }

  res.json({ ok: true, saved: Object.keys(patch) })
})

export default router
