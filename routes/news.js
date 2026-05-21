import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// trusted:true = dedicated real-estate section feed, skip keyword filter
const RSS_SOURCES = [
  // Direct Hebrew feeds — include media:content images
  { name: 'Ynet נדל"ן',       url: 'https://www.ynet.co.il/Integration/StoryRss8315.xml',                                                                                  trusted: true  },
  { name: 'Ynet כלכלה',       url: 'https://www.ynet.co.il/Integration/StoryRss6.xml',                                                                                     trusted: false },
  { name: 'Globes נדל"ן',     url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederPage?iID=3',                                                              trusted: true  },
  { name: 'כלכליסט נדל"ן',    url: 'https://www.calcalist.co.il/rss/AID-1523869688.xml',                                                                                   trusted: true  },
  { name: 'TheMarker נדל"ן',   url: 'https://www.themarker.com/cmlink/1.2-rss',                                                                                             trusted: true  },
  { name: 'Mako נדל"ן',       url: 'https://rss.mako.co.il/rss/31750a2610f26110VgnVCM1000005201000aRCRD.xml',                                                              trusted: true  },
  { name: 'Walla כלכלה',      url: 'https://rss.walla.co.il/feed/6',                                                                                                       trusted: false },
  // Google News Hebrew searches — no images but ensure Hebrew content breadth
  { name: 'Google נדל"ן',     url: 'https://news.google.com/rss/search?q=%D7%A0%D7%93%D7%9C%D7%9F+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',              trusted: true  },
  { name: 'Google דיור',      url: 'https://news.google.com/rss/search?q=%D7%9E%D7%97%D7%99%D7%A8%D7%99+%D7%93%D7%99%D7%A8%D7%95%D7%AA+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he', trusted: true },
]

const HE_RE   = /[א-ת]/
const RE_FILTER = /נדל|דיר[הות]|דיור|שכיר[ות]|שוכר|משכיר|קרק[ע]|מגרש|משכנת|פינוי.?בינוי|התחדשות עירונית|מקרקעין|טאבו|קבלן|יזם.?נד|בנייה|בניין|תמ.?א|מגורים|שרון|כפר.?סבא|רעננה|נתניה|הוד.השרון|שוק הד|מחירי ד|רכישת ד/i
function isHebrew(text)     { return HE_RE.test(text) }
function isRealEstate(title) { return RE_FILTER.test(title) }

function isArticleImage(url) {
  if (!url) return false
  const u = url.toLowerCase()
  return !u.includes('logo') && !u.includes('default') && !u.includes('placeholder')
    && !u.includes('favicon') && !u.includes('generic')
}

function deduplicateImages(articles) {
  const imgCount = {}
  articles.forEach(a => { if (a.image) imgCount[a.image] = (imgCount[a.image] || 0) + 1 })
  return articles.map(a => ({ ...a, image: (a.image && imgCount[a.image] === 1) ? a.image : '' }))
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/xml,text/xml,application/rss+xml,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
}

// ── Parse RSS/Atom XML without external libs ───────────────────────────────
function parseRSS(xml, sourceName, trusted = false) {
  const items = []
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1]
    const g = (re) => (c.match(re) || [])[1]?.trim()
      ?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'") || ''

    const rawTitle = g(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
    const link     = g(/<link[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?<\/link>/)
               || g(/<guid[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?<\/guid>/)
    const pubDate  = g(/<pubDate[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/)
    const imgMedia = g(/<media:content[^>]+url=["']([^"']+)["']/)
               || g(/<media:thumbnail[^>]+url=["']([^"']+)["']/)
    const imgEnc   = g(/<enclosure[^>]+url=["']([^"']+)["']/)
    const imgDesc  = (c.match(/<description[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/) || [])[1] || ''

    if (!rawTitle || !link) continue
    const title = rawTitle.replace(/<[^>]+>/g, '')
    // Google News media:thumbnail/content is a source-branded card, not the real article image
    const rawImg = link.includes('news.google.com') ? '' : (imgMedia || imgEnc || imgDesc || '')
    const image = isArticleImage(rawImg) ? rawImg : ''
    const date  = pubDate ? new Date(pubDate) : new Date()

    let articleUrl = link
    let displaySource = sourceName
    if (link.includes('news.google.com')) {
      const rawDesc = (c.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1] || ''
      const decoded = rawDesc.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
      const realHref = decoded.match(/href=["']?(https?:\/\/(?!news\.google)[^"'\s>]+)/i)
      if (realHref) articleUrl = realHref[1]
      const gnSrc = g(/<source[^>]*>([^<]+)<\/source>/)
      if (gnSrc) displaySource = gnSrc
    }

    items.push({ id: link, title, url: articleUrl, link, image, source: displaySource, trusted,
      publishedAt: date.toISOString(), date })
  }
  return items
}

// ── Fetch og:image server-side (no CORS issues) ───────────────────────────
async function fetchOGImage(url) {
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(7000), redirect: 'follow' })
    if (!r.ok) return ''
    // If redirect landed on a Google domain, we'd only get their site icon — skip
    try { if (new URL(r.url).hostname.includes('google.com')) return '' } catch {}
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
    RSS_SOURCES.map(async ({ name, url, trusted = false }) => {
      try {
        const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) })
        if (!r.ok) { console.warn(`[news] ${name} ${r.status}`); return [] }
        return parseRSS(await r.text(), name, trusted)
      } catch (e) { console.warn(`[news] ${name}:`, e.message); return [] }
    })
  )

  // Merge: direct-source articles first so they beat Google News duplicates in deduplication
  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  const byDate = a => new Date(a.publishedAt).getTime()
  const combined = [
    ...all.filter(a => !a.link.includes('news.google.com')).sort((a,b) => byDate(b) - byDate(a)),
    ...all.filter(a =>  a.link.includes('news.google.com')).sort((a,b) => byDate(b) - byDate(a)),
  ]
  const seen = new Set()
  let articles = combined
    .filter(a => {
      if (!a.title || !a.link) return false
      if (!isHebrew(a.title)) return false
      if (!a.trusted && !isRealEstate(a.title)) return false
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

  // Clear duplicate images (source logos shared across multiple articles)
  articles = deduplicateImages(articles)

  // Enrich with og:image where missing (parallel, max 30, direct-source first)
  const withoutImg = articles.filter(a => !a.image)
  const needImg = [
    ...withoutImg.filter(a => !a.link.includes('news.google.com')),
    ...withoutImg.filter(a =>  a.link.includes('news.google.com')),
  ].slice(0, 40)
  const ogResults = await Promise.allSettled(needImg.map(a => fetchOGImage(a.url)))
  const ogMap = new Map(needImg.map((a, i) => [a.id, ogResults[i]]))
  articles = articles.map(a => {
    if (!a.image && ogMap.has(a.id)) {
      const r = ogMap.get(a.id)
      const ogImg = (r?.status === 'fulfilled' ? r.value : '') || ''
      return { ...a, image: ogImg }
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
