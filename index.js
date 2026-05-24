import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import propertiesRouter, { preloadFromSupabase } from './routes/properties.js'
import contactsRouter  from './routes/contacts.js'
import newsRouter      from './routes/news.js'
import statsRouter     from './routes/stats.js'
import whatsappRouter  from './routes/whatsapp.js'
import capiRouter      from './routes/capi.js'
import aiRouter        from './routes/ai.js'
import uploadRouter    from './routes/upload.js'
import chatsRouter     from './routes/chats.js'
import { supabase }    from './lib/supabase.js'

// ── Run Supabase migrations on startup ─────────────────────────────────────
async function runMigrations() {
  if (!supabase) return
  const migrations = [
    `CREATE TABLE IF NOT EXISTS properties (
       id         BIGINT      PRIMARY KEY,
       data       JSONB       NOT NULL DEFAULT '{}',
       published  BOOLEAN     NOT NULL DEFAULT true,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS properties_published_idx ON properties (published)`,
    `CREATE INDEX IF NOT EXISTS properties_created_idx   ON properties (created_at DESC)`,
    `CREATE OR REPLACE FUNCTION update_updated_at()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$`,
    `DROP TRIGGER IF EXISTS properties_updated_at ON properties`,
    `CREATE TRIGGER properties_updated_at
     BEFORE UPDATE ON properties
     FOR EACH ROW EXECUTE FUNCTION update_updated_at()`,
    `CREATE TABLE IF NOT EXISTS site_config (
       key        TEXT        PRIMARY KEY,
       value      JSONB       NOT NULL DEFAULT '[]',
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS contacts (
       id            BIGSERIAL   PRIMARY KEY,
       name          TEXT,
       phone         TEXT,
       email         TEXT,
       message       TEXT,
       prop_title    TEXT,
       prop_location TEXT,
       source        TEXT        NOT NULL DEFAULT 'website',
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'new'`,
    `CREATE TABLE IF NOT EXISTS chats (
       id         BIGSERIAL   PRIMARY KEY,
       phone      TEXT        NOT NULL,
       direction  TEXT        NOT NULL DEFAULT 'out',
       message    TEXT        NOT NULL,
       status     TEXT        NOT NULL DEFAULT 'sent',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS chats_phone_idx ON chats (phone, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS news_articles (
       id           TEXT        PRIMARY KEY,
       title        TEXT        NOT NULL,
       url          TEXT,
       image        TEXT,
       source       TEXT,
       published_at TIMESTAMPTZ,
       lang         TEXT        NOT NULL DEFAULT 'he',
       archived     BOOLEAN     NOT NULL DEFAULT false,
       created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS news_articles_lang_idx ON news_articles (lang, published_at DESC)`,
  ]
  for (const sql of migrations) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: null }))
      if (error) {
        // Try raw query via postgres REST (Supabase supports this via rpc)
        console.log('[migrations] rpc failed, trying direct — this is normal on first setup')
      }
    } catch {}
  }
  // Verify the properties table exists by doing a simple count
  try {
    const { error } = await supabase.from('properties').select('id', { count: 'exact', head: true })
    if (error) {
      console.warn('[migrations] properties table may not exist — run supabase-schema.sql in Supabase SQL editor:', error.message)
    } else {
      console.log('[migrations] ✓ Supabase properties table verified')
    }
  } catch (e) {
    console.warn('[migrations] Supabase check failed:', e.message)
  }
}
runMigrations().then(() => preloadFromSupabase())

const app = express()

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())

function isAllowed(origin) {
  if (!origin) return true                           // server-to-server / health checks
  if (allowedOrigins.includes(origin)) return true  // explicit whitelist
  if (/\.vercel\.app$/.test(origin)) return true    // all Vercel preview deployments
  if (/localhost(:\d+)?$/.test(origin)) return true // local dev
  return false
}

app.use(cors({
  origin: (origin, cb) => isAllowed(origin) ? cb(null, true) : cb(new Error(`CORS: ${origin} not allowed`)),
  credentials: true,
}))

app.use(express.json({ limit: '25mb' }))

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }))

app.use('/api/properties', propertiesRouter)
app.use('/api/contacts',   contactsRouter)
app.use('/api/news',       newsRouter)
app.use('/api/stats',      statsRouter)
app.use('/api/whatsapp',   whatsappRouter)
app.use('/api/capi',       capiRouter)
app.use('/api/ai',         aiRouter)
app.use('/api/upload',    uploadRouter)
app.use('/api/chats',     chatsRouter)

// Handle multer errors (e.g., file too large, wrong type)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    const limit = req.path?.includes('/video') ? '150MB' : '25MB'
    return res.status(413).json({ error: `File too large — maximum ${limit}` })
  }
  if (err.message?.includes('Only PDF') || err.message?.includes('Only video')) return res.status(415).json({ error: err.message })
  console.error('[server error]', err.message || err)
  return res.status(500).json({ error: err.message || 'Server error' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`)
  // Warm news cache on startup then refresh every morning at 08:00 Israel time
  warmNewsCache()
  setInterval(warmNewsCache, 60 * 60 * 1000)   // check hourly
})

async function warmNewsCache() {
  try {
    const hourIL = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }))
    // On startup (hour=any) we always warm; on scheduled checks only at 08:00
    const LAST_KEY = '_newsCacheWarmedDate'
    const todayIL  = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem' })
    if (global[LAST_KEY] === todayIL && hourIL !== 8) return
    global[LAST_KEY] = todayIL
    console.log('[news-cron] warming news cache…')
    const r = await fetch(`http://localhost:${PORT}/api/news/feed`, { signal: AbortSignal.timeout(60000) })
    console.log(`[news-cron] done — ${r.status}`)
  } catch (e) { console.warn('[news-cron] warm failed:', e.message) }
}
