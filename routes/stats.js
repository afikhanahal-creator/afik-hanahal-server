import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { getStorageUsage } from '../lib/usage.js'

const router = Router()

const DEFAULT_STATS = [
  { key:'deals',   value:150,  label:'עסקאות הושלמו', en_label:'Deals Completed', suffix:'+' },
  { key:'years',   value:30,   label:'שנות ניסיון',   en_label:'Years Experience', suffix:''  },
  { key:'clients', value:300,  label:'לקוחות מרוצים', en_label:'Happy Clients',    suffix:'+' },
  { key:'dunams',  value:5000, label:'דונם שווק',      en_label:'Dunams Marketed',  suffix:'+' },
]

const DEFAULT_SHARON = [
  { city:'הרצליה',    en_city:'Herzliya',     count:12, type:'נכסים בלעדיים', en_type:'Exclusive Properties' },
  { city:'כפר סבא',   en_city:'Kfar Saba',    count:8,  type:'מגרשים פרטיים', en_type:'Private Plots' },
  { city:'רעננה',     en_city:"Ra'anana",     count:6,  type:'קרקעות יזמיות', en_type:'Entrepreneurial Land' },
  { city:'הוד השרון', en_city:'Hod HaSharon', count:9,  type:'נכסים בלעדיים', en_type:'Exclusive Properties' },
]

// In-memory cache — survives Supabase hiccups within the same process lifetime
let MEM = { stats: DEFAULT_STATS, sharon: DEFAULT_SHARON, govmapToken: '', updatedAt: null }

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  return token === process.env.ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// GET /api/stats/usage — admin-only Supabase Storage usage snapshot
router.get('/usage', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (!supabase) return res.status(503).json({ error: 'Storage not configured — Supabase not connected' })
  try {
    return res.json(await getStorageUsage())
  } catch (e) {
    console.error('[stats usage]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// GET /api/stats — public, no auth required
router.get('/', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')

  if (supabase) {
    const { data, error } = await supabase
      .from('site_config')
      .select('key, value, updated_at')
      .in('key', ['stats', 'sharon', 'govmap_token'])

    if (!error && data?.length) {
      const result = { stats: DEFAULT_STATS, sharon: DEFAULT_SHARON, govmapToken: '', updatedAt: null }
      data.forEach(row => {
        if (row.key === 'stats'         && Array.isArray(row.value))  result.stats       = row.value
        if (row.key === 'sharon'        && Array.isArray(row.value))  result.sharon      = row.value
        if (row.key === 'govmap_token'  && typeof row.value === 'string') result.govmapToken = row.value
        if (row.key === 'govmap_token'  && row.value?.token)          result.govmapToken = row.value.token
        if (!result.updatedAt || row.updated_at > result.updatedAt)  result.updatedAt   = row.updated_at
      })
      // Update in-memory cache
      MEM = { ...MEM, ...result }
      return res.json(result)
    }
    if (error) console.warn('[stats] supabase read error:', error.message)
  }

  // Fallback: in-memory
  return res.json(MEM)
})

// POST /api/stats — admin-only save
router.post('/', requireAdmin, async (req, res) => {
  const { stats, sharon, govmapToken } = req.body
  if (!stats && !sharon && govmapToken === undefined)
    return res.status(400).json({ error: 'stats, sharon, or govmapToken required' })

  const now = new Date().toISOString()

  // Always update in-memory immediately
  if (stats)                   MEM.stats       = stats
  if (sharon)                  MEM.sharon      = sharon
  if (govmapToken !== undefined) MEM.govmapToken = govmapToken
  MEM.updatedAt = now

  if (supabase) {
    const rows = []
    if (stats)                     rows.push({ key: 'stats',        value: stats        })
    if (sharon)                    rows.push({ key: 'sharon',       value: sharon       })
    if (govmapToken !== undefined) rows.push({ key: 'govmap_token', value: govmapToken })

    const { error } = await supabase
      .from('site_config')
      .upsert(rows, { onConflict: 'key' })

    if (error) {
      console.error('[stats] supabase upsert error:', error.message)
      return res.status(500).json({ error: error.message })
    }
    console.log(`[stats] saved — stats:${!!stats} sharon:${!!sharon} govmapToken:${govmapToken !== undefined}`)
  }

  res.json({ ok: true, ts: now })
})

export default router
