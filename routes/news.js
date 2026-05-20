import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// ── Israeli real-estate RSS sources (no auth, no blocking) ─────────────────
const RSS_SOURCES = [
  { name: 'Ynet נדל"ן',       url: 'https://www.ynet.co.il/Integration/StoryRss2.aspx?id=3082' },
  { name: 'Calcalist נדל"ן',  url: 'https://www.calcalist.co.il/rss/AjaxPage,7340,L-4,00.html' },
  { name: 'Globes נדל"ן',     url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=1111' },
  { name: 'Walla! נדל"ן',     url: 'https://rss.walla.co.il/feed/22' },
  { name: 'TheMarker נדל"ן',  url: 'https://www.themarker.com/cmlink/1.4476' },
  { name: 'Bizportal נדל"ן',  url: 'https://www.bizportal.co.il/rss/realEstate' },
]

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
}

// ── Parse RSS/Atom XML without external libs ───────────────────────────────
function parseRSS(xml, sourceName) {
  const items = []
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1]
    const g = (re) => (c.match(re) || [])[1]?.trim()
      ?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'") || ''

    const rawTitle = g(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
    const link     = g(/<link[^>]*>\s*(https?:\/\/[^\s<]+)\s*<\/link>/)
               || g(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/)
    const pubDate  = g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)
    const imgEnc   = g(/<enclosure[^>]+url=["']([^"']+)["']/)
    const imgMedia = g(/<media:content[^>]+url=["']([^"']+)["']/)
               || g(/<media:thumbnail[^>]+url=["']([^"']+)["']/)
    const imgDesc  = (c.match(/<description[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/) || [])[1] || ''

    if (!rawTitle || !link) continue
    const title = rawTitle.replace(/<[^>]+>/g, '')
    const image = imgMedia || imgEnc || imgDesc || ''
    const date  = pubDate ? new Date(pubDate) : new Date()

    items.push({ id: link, title, url: link, link, image, source: sourceName,
      publishedAt: date.toISOString(), date })
  }
  return items
}

// ── Fetch og:image server-side (no CORS issues) ───────────────────────────
async function fetchOGImage(url) {
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(7000), redirect: 'follow' })
    if (!r.ok) return ''
    const html = await r.text()
    return (
      (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
       html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      )?.[1] || ''
    )
  } catch { return '' }
}

// ── In-memory cache (30 min) ───────────────────────────────────────────────
const CACHE = { articles: null, ts: 0 }
const TTL   = 30 * 60 * 1000

// GET /api/news/feed — primary endpoint: fetch, dedupe, enrich, cache ────────
router.get('/feed', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (CACHE.articles && (Date.now() - CACHE.ts) < TTL) {
    return res.json(CACHE.articles)
  }

  // Fetch all RSS sources in parallel
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async src => {
      try {
        const r = await fetch(src.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) })
        if (!r.ok) return []
        const xml = await r.text()
        return parseRSS(xml, src.name)
      } catch { return [] }
    })
  )

  // Merge + deduplicate by title
  const seen = new Set()
  let articles = results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(a => {
      const key = a.title.replace(/\s+/g,'').slice(0, 30)
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 50)

  if (!articles.length) {
    if (!supabase) return res.json([])
    const { data } = await supabase.from('news_articles')
      .select('*').eq('lang','he').eq('archived',false)
      .order('published_at', { ascending: false }).limit(50)
    return res.json(data || [])
  }

  // Enrich with og:image where missing (parallel, max 25)
  const needImg = articles.filter(a => !a.image).slice(0, 25)
  const ogResults = await Promise.allSettled(needImg.map(a => fetchOGImage(a.url)))

  let ogIdx = 0
  articles = articles.map(a => {
    if (!a.image) {
      const r = ogResults[ogIdx++]
      return { ...a, image: (r?.status === 'fulfilled' ? r.value : '') || '' }
    }
    return a
  })

  // Upsert to Supabase async (don't block response)
  if (supabase) {
    supabase.from('news_articles').upsert(
      articles.map(a => ({
        id: a.id, title: a.title, url: a.url,
        image: a.image || null, source: a.source,
        published_at: a.publishedAt, lang: 'he', archived: false,
      })),
      { onConflict: 'id' }
    ).then(({ error }) => { if (error) console.warn('[news] supabase:', error.message) })
  }

  CACHE.articles = articles
  CACHE.ts = Date.now()

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600')
  res.json(articles)
})

// GET /api/news — Supabase cache read ──────────────────────────────────────
router.get('/', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!supabase) return res.json([])
  const lang = req.query.lang || 'he'
  const { data, error } = await supabase.from('news_articles')
    .select('*').eq('lang', lang).eq('archived', false)
    .order('published_at', { ascending: false }).limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// POST /api/news/sync — frontend backup push ───────────────────────────────
router.post('/sync', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' })
  const { articles, lang = 'he' } = req.body
  if (!Array.isArray(articles) || !articles.length)
    return res.status(400).json({ error: 'articles array required' })
  const rows = articles.map(a => ({
    id: a.id || a.url, title: a.title, url: a.url || a.link,
    image: a.image || null, source: a.source,
    published_at: a.publishedAt || a.published_at || null,
    lang, archived: false,
  }))
  const { error } = await supabase.from('news_articles').upsert(rows, { onConflict: 'id' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, count: rows.length })
})

export default router
