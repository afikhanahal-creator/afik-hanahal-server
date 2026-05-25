import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// ── RSS sources ────────────────────────────────────────────────────────────────
// Google News searches are primary: always work, aggregate ALL Israeli news sites
// Direct feeds are bonuses: give images in RSS so less OG scraping needed
// MAX_PER_SOURCE ensures no single outlet floods the feed
const MAX_PER_SOURCE = 3

const RSS_SOURCES = [
  // ── Google News searches — always reliable, return articles from many outlets ──
  { name: 'Google נדל"ן',       url: 'https://news.google.com/rss/search?q=%D7%A0%D7%93%D7%9C%22%D7%9F+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',                              trusted: true, gn: true },
  { name: 'Google דירות',       url: 'https://news.google.com/rss/search?q=%D7%9E%D7%97%D7%99%D7%A8%D7%99+%D7%93%D7%99%D7%A8%D7%95%D7%AA+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',     trusted: true, gn: true },
  { name: 'Google קרקעות',      url: 'https://news.google.com/rss/search?q=%D7%A7%D7%A8%D7%A7%D7%A2%D7%95%D7%AA+%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he', trusted: true, gn: true },
  { name: 'Google שוק נדל"ן',   url: 'https://news.google.com/rss/search?q=%D7%A9%D7%95%D7%A7+%D7%94%D7%A0%D7%93%D7%9C%22%D7%9F+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',              trusted: true, gn: true },
  { name: 'Google פינוי בינוי',  url: 'https://news.google.com/rss/search?q=%D7%A4%D7%99%D7%A0%D7%95%D7%99+%D7%91%D7%99%D7%A0%D7%95%D7%99+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',         trusted: true, gn: true },
  { name: 'Google התחדשות',      url: 'https://news.google.com/rss/search?q=%D7%94%D7%AA%D7%97%D7%93%D7%A9%D7%95%D7%AA+%D7%A2%D7%99%D7%A8%D7%95%D7%A0%D7%99%D7%AA&hl=he&gl=IL&ceid=IL:he',               trusted: true, gn: true },
  { name: 'Google משכנתאות',     url: 'https://news.google.com/rss/search?q=%D7%9E%D7%A9%D7%9B%D7%A0%D7%AA%D7%90%D7%95%D7%AA+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',                    trusted: true, gn: true },
  { name: 'Google קבלנים',       url: 'https://news.google.com/rss/search?q=%D7%A7%D7%91%D7%9C%D7%A0%D7%99%D7%9D+%D7%91%D7%A0%D7%99%D7%99%D7%94+%D7%99%D7%A9%D7%A8%D7%90%D7%9C&hl=he&gl=IL&ceid=IL:he',  trusted: true, gn: true },

  // ── Direct feeds (include images in RSS — less OG scraping needed) ────────────
  { name: 'Ynet נדל"ן',         url: 'https://www.ynet.co.il/Integration/StoryRss8315.xml',                                              trusted: true  },
  { name: 'Ynet כלכלה',         url: 'https://www.ynet.co.il/Integration/StoryRss6.xml',                                                 trusted: false },
  { name: 'Globes נדל"ן',       url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederPage?iID=3',                          trusted: true  },
  { name: 'כלכליסט',            url: 'https://www.calcalist.co.il/rss/AID-1523869688.xml',                                               trusted: true  },
  { name: 'TheMarker',          url: 'https://www.themarker.com/cmlink/1.2-rss',                                                         trusted: true  },
  { name: 'Mako נדל"ן',         url: 'https://rss.mako.co.il/rss/31750a2610f26110VgnVCM1000005201000aRCRD.xml',                         trusted: true  },
  { name: 'מעריב נדל"ן',        url: 'https://www.maariv.co.il/rss/rssfeedsinglkategoriya,7213.xml',                                     trusted: true  },
  { name: 'N12 נדל"ן',          url: 'https://www.mako.co.il/rss/AID-f2e239cee5e8b710VgnVCM2000002a0c10acRCRD.xml',                     trusted: true  },
  { name: 'וואלה כלכלה',        url: 'https://rss.walla.co.il/feed/6',                                                                  trusted: false },
  { name: 'ישראל היום',         url: 'https://www.israelhayom.co.il/rss.php?cat=7',                                                      trusted: false },
]

const HE_RE = /[א-ת]/
const RE_FILTER = /נדל|דיר[הות]|דיור|שכיר[ות]|שוכר|משכיר|קרק[ע]|מגרש|משכנת|פינוי.?בינוי|התחדשות.?עירונית|מקרקעין|טאבו|קבלן|יזם|בנייה|בניין|תמ.?א|מגורים|שרון|כפר.?סבא|רעננה|נתניה|הוד.השרון|ראשון.?לציון|פתח.?תקווה|רמת.?גן|בני.?ברק|שוק.?הנד|מחיר.*דיר|רכישת.?דיר|דירה.*למכיר|למכיר.*דיר|אחוזי.?מימון|ריבית.*משכנת|כינוס.?נכסים|תל.?אביב.*נדל|ירושלים.*נדל/i

function isRealEstate(title) { return RE_FILTER.test(title) }
function isHebrew(text)       { return HE_RE.test(text) }

function isArticleImage(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.toLowerCase()
  return u.startsWith('http') &&
    !u.includes('logo') && !u.includes('default') && !u.includes('placeholder') &&
    !u.includes('favicon') && !u.includes('generic') && !u.includes('blank') &&
    !u.includes('avatar') && !u.includes('icon') && u.length > 20
}

// ── RSS parser (no external libs) ─────────────────────────────────────────────
function parseRSS(xml, sourceName, trusted = false, isGN = false) {
  const items = []
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1]
    const g = re => (c.match(re) || [])[1]?.trim()
      ?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'") || ''

    const rawTitle = g(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
    const link = g(/<link[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?<\/link>/)
             || g(/<guid[^>]*isPermaLink=["']?true["']?[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?<\/guid>/)
             || g(/<guid[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?<\/guid>/)
    if (!rawTitle || !link) continue

    const title   = rawTitle.replace(/<[^>]+>/g, '').trim()
    const pubDate = g(/<pubDate[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/)
                 || g(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/)
    const date    = pubDate ? new Date(pubDate) : new Date()

    // Image extraction — multiple strategies in priority order
    const imgMedia    = g(/<media:content[^>]+url=["']([^"']+)["']/)
                     || g(/<media:thumbnail[^>]+url=["']([^"']+)["']/)
    const imgEnc      = g(/<enclosure[^>]+type=["']image[^"']*["'][^>]+url=["']([^"']+)["']/)
                     || g(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image[^"']*["']/)

    const rawDesc = (c.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1] || ''
    const descDec = rawDesc
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
    const imgDesc = (descDec.match(/<img[^>]+src=["']([^"']+)["']/) || [])[1] || ''

    const rawCE = (c.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/) || [])[1] || ''
    const ceDec = rawCE
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
    const imgCE = (ceDec.match(/<img[^>]+src=["']([^"']+)["']/) || [])[1] || ''

    // Google News cards are branded thumbnails — not useful
    const rawImg = isGN ? '' : (imgMedia || imgEnc || imgDesc || imgCE || '')
    const image  = isArticleImage(rawImg) ? rawImg : ''

    // For Google News: extract real article URL + real source name
    let articleUrl    = link
    let displaySource = sourceName
    if (isGN) {
      const gnDesc = (c.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1] || ''
      const decoded = gnDesc.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
      const hrefMatch = decoded.match(/href=["']?(https?:\/\/(?!news\.google)[^"'\s>]+)/i)
      if (hrefMatch) articleUrl = hrefMatch[1]
      const gnSrc = g(/<source[^>]*>([^<]+)<\/source>/)
      if (gnSrc) displaySource = gnSrc
    }

    items.push({
      id: link, title, url: articleUrl, link, image,
      source: displaySource, trusted, isGN,
      publishedAt: date.toISOString(), date,
    })
  }
  return items
}

// ── Fetch og:image — server-side (no CORS) ────────────────────────────────────
// Tries multiple User-Agents so paywalled/bot-blocking sites are more likely to return an image
async function fetchOGImage(url) {
  const UAs = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ]
  for (const ua of UAs) {
    try {
      let domain = ''
      try { domain = new URL(url).hostname } catch {}
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
          'Referer': domain ? `https://${domain}/` : 'https://www.google.com/',
        },
        signal: AbortSignal.timeout(7000),
        redirect: 'follow',
      })
      if (!r.ok) continue
      try { if (new URL(r.url).hostname.includes('google.com')) return '' } catch {}
      const html = await r.text()
      const img = (
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i)
      )?.[1]?.replace(/&amp;/g,'&').replace(/&quot;/g,'"') || ''
      if (isArticleImage(img)) return img
    } catch {}
  }
  return ''
}

// ── De-duplicate images that appear on multiple articles (= source logo) ──────
function deduplicateImages(articles) {
  const cnt = {}
  articles.forEach(a => { if (a.image) cnt[a.image] = (cnt[a.image] || 0) + 1 })
  return articles.map(a => ({ ...a, image: (a.image && cnt[a.image] === 1) ? a.image : '' }))
}

// ── Limit articles per source (MAX_PER_SOURCE) ─────────────────────────────────
function balanceSources(articles) {
  const counts = {}
  const out = []
  for (const a of articles) {
    const key = a.source || ''
    counts[key] = (counts[key] || 0) + 1
    if (counts[key] <= MAX_PER_SOURCE) out.push(a)
  }
  return out
}

// Shuffle so sources interleave (article 0 from source A, 1 from B, 2 from C, etc.)
function shuffleSources(articles) {
  const bySource = {}
  articles.forEach(a => {
    const s = a.source || ''
    if (!bySource[s]) bySource[s] = []
    bySource[s].push(a)
  })
  const queues = Object.values(bySource)
  const out    = []
  let anyLeft  = true
  while (anyLeft) {
    anyLeft = false
    for (const q of queues) {
      if (q.length) { out.push(q.shift()); anyLeft = true }
    }
  }
  return out
}

// ── In-memory cache (30 min) ───────────────────────────────────────────────────
const CACHE = { articles: null, ts: 0 }
const TTL   = 30 * 60 * 1000

// ── Main build function — called by /feed and the daily cron ──────────────────
export async function buildNewsFeed() {
  console.log('[news] Building news feed from %d sources…', RSS_SOURCES.length)

  const results = await Promise.allSettled(
    RSS_SOURCES.map(async ({ name, url, trusted, gn }) => {
      try {
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/xml,text/xml,application/rss+xml,*/*;q=0.8',
            'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
          },
          signal: AbortSignal.timeout(12000),
        })
        if (!r.ok) { console.warn(`[news] ${name}: HTTP ${r.status}`); return [] }
        const parsed = parseRSS(await r.text(), name, trusted, gn)
        console.log(`[news] ${name}: ${parsed.length} items`)
        return parsed
      } catch (e) { console.warn(`[news] ${name}: ${e.message}`); return [] }
    })
  )

  // Merge: direct-source first (they win dedup over GN duplicates)
  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  const byDate = a => new Date(a.publishedAt).getTime()
  const direct = all.filter(a => !a.isGN).sort((a,b) => byDate(b) - byDate(a))
  const gn     = all.filter(a =>  a.isGN).sort((a,b) => byDate(b) - byDate(a))

  // Deduplicate by title prefix (40 chars)
  const seen   = new Set()
  const merged = [...direct, ...gn].filter(a => {
    if (!a.title || !isHebrew(a.title)) return false
    if (!a.trusted && !isRealEstate(a.title)) return false
    const k = a.title.replace(/\s+/g,'').slice(0, 40)
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // Sort by date, cap at 120 before limiting per source
  const sorted = merged.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 120)

  // Balance: max MAX_PER_SOURCE articles per outlet
  let balanced = balanceSources(sorted)

  // Shuffle: interleave sources so the feed looks diverse
  balanced = shuffleSources(balanced)

  // Remove duplicate images (source logos shared across articles)
  balanced = deduplicateImages(balanced)

  // Enrich with og:image where missing — parallel, direct-source articles first
  const withoutImg = balanced.filter(a => !a.image)
  const needImg = [
    ...withoutImg.filter(a => !a.isGN),
    ...withoutImg.filter(a =>  a.isGN),
  ].slice(0, 50)  // up to 50 OG fetches

  console.log(`[news] Fetching og:image for ${needImg.length} articles…`)
  const ogResults = await Promise.allSettled(needImg.map(a => fetchOGImage(a.url)))
  const ogMap = new Map(needImg.map((a, i) => [a.id, ogResults[i]]))
  balanced = balanced.map(a => {
    if (!a.image && ogMap.has(a.id)) {
      const r   = ogMap.get(a.id)
      const img = (r?.status === 'fulfilled' && r.value) ? r.value : ''
      return { ...a, image: img }
    }
    return a
  })

  // Final: articles with image first, then without
  const withImg     = balanced.filter(a => a.image)
  const withoutImg2 = balanced.filter(a => !a.image)
  const final       = [...withImg, ...withoutImg2].slice(0, 80)

  const imgCount = final.filter(a => a.image).length
  const sources  = [...new Set(final.map(a => a.source))]
  console.log(`[news] Feed ready: ${final.length} articles, ${imgCount} with images, ${sources.length} sources`)

  // Upsert to Supabase — keep for archive
  if (supabase) {
    const rows = final.map(a => ({
      id:          a.id,
      title:       a.title,
      url:         a.url,
      image:       a.image || null,
      source:      a.source,
      published_at: a.publishedAt,
      lang:        'he',
      archived:    false,
    }))
    supabase.from('news_articles')
      .upsert(rows, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.warn('[news] supabase upsert:', error.message) })

    // Mark articles older than 3 weeks as archived
    const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
    supabase.from('news_articles')
      .update({ archived: true })
      .eq('lang', 'he').lt('published_at', cutoff).eq('archived', false)
      .then(({ error }) => { if (error) console.warn('[news] archive old:', error.message) })

    // Delete articles older than 30 days to keep table clean
    const deleteCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    supabase.from('news_articles')
      .delete()
      .lt('published_at', deleteCutoff)
      .then(({ error }) => { if (error) console.warn('[news] cleanup:', error.message) })
  }

  return final
}

// ── GET /api/news/feed ─────────────────────────────────────────────────────────
router.get('/feed', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const force = req.query.force === '1'

  if (!force && CACHE.articles && (Date.now() - CACHE.ts) < TTL) {
    return res.json(CACHE.articles)
  }

  let articles
  try {
    articles = await buildNewsFeed()
  } catch (e) {
    console.error('[news] buildNewsFeed error:', e.message)
    articles = []
  }

  if (!articles.length && supabase) {
    // Fallback to Supabase cache
    const { data } = await supabase.from('news_articles')
      .select('*').eq('lang','he')
      .order('published_at', { ascending: false }).limit(80)
    articles = data || []
  }

  CACHE.articles = articles
  CACHE.ts       = Date.now()

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600')
  res.json(articles)
})

// ── GET /api/news/archive — last 3 weeks from Supabase ────────────────────────
router.get('/archive', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!supabase) return res.json([])

  const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('news_articles')
    .select('id, title, url, image, source, published_at')
    .eq('lang', 'he')
    .gte('published_at', cutoff)
    .order('published_at', { ascending: false })
    .limit(500)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ── GET /api/news — current live articles (Supabase non-archived) ──────────────
router.get('/', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  // Return cache first for speed
  if (CACHE.articles && CACHE.articles.length) return res.json(CACHE.articles)

  if (!supabase) return res.json([])
  const { data, error } = await supabase.from('news_articles')
    .select('*').eq('lang','he').eq('archived', false)
    .order('published_at', { ascending: false }).limit(80)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ── POST /api/news/sync — frontend push to Supabase ───────────────────────────
router.post('/sync', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' })
  const { articles, lang = 'he' } = req.body
  if (!Array.isArray(articles) || !articles.length)
    return res.status(400).json({ error: 'articles array required' })
  const rows = articles.map(a => ({
    id:          a.id || a.url,
    title:       a.title,
    url:         a.url || a.link,
    image:       a.image || null,
    source:      a.source,
    published_at: a.publishedAt || a.published_at || null,
    lang,
    archived:    false,
  }))
  const { error } = await supabase.from('news_articles').upsert(rows, { onConflict: 'id' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, count: rows.length })
})

export default router
