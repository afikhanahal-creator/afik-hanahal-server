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
// Every article, regardless of source, must match one of these real-estate terms
const RE_FILTER = /נדל|דיר[הות]|דיור|שכיר[ות]|שוכר|משכיר|קרק[ע]|מגרש|משכנת|פינוי.?בינוי|התחדשות.?עירונית|מקרקעין|טאבו|קבלן|יזם|בנייה|בניין|תמ.?א|מגורים|שרון|כפר.?סבא|רעננה|נתניה|הוד.?השרון|ראשון.?לציון|פתח.?תקווה|רמת.?גן|בני.?ברק|שוק.?הנד|מחיר.*דיר|רכישת.?דיר|דירה.*למכיר|למכיר.*דיר|אחוזי.?מימון|ריבית.*משכנת|כינוס.?נכסים|תל.?אביב.*נדל|ירושלים.*נדל|הלוואת.?נדל|שכר.?דירה|שוכרים|משכיר|מתחם|יח.?ד|בנייה.?רוויה|בניה.?רוויה|פרויקט|ביצוע.?בינוי|רוכשי.?דיר|שוק.?הדיור|מחיר.?לדיירים|זכות.?בדירה|דמי.?שכירות/i

function isRealEstate(title) { return RE_FILTER.test(title) }
function isHebrew(text)       { return HE_RE.test(text) }

function isArticleImage(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.toLowerCase()
  if (!u.startsWith('http')) return false
  if (u.length < 24) return false
  // reject obvious non-article images
  if (u.includes('logo') || u.includes('favicon') || u.includes('icon') ||
      u.includes('default') || u.includes('placeholder') || u.includes('blank') ||
      u.includes('avatar') || u.includes('generic') || u.includes('pixel') ||
      u.includes('spacer') || u.includes('tracking') || u.includes('1x1') ||
      u.endsWith('.svg') || u.endsWith('.gif')) return false
  return true
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
    // media:content / media:thumbnail — extract url= attr regardless of position
    const extractTagUrl = tag => {
      const t = c.match(new RegExp(`<${tag}[^>]*>`))?.[0] || ''
      return (t.match(/url=["']([^"']+)["']/) || [])[1] || ''
    }
    const imgMedia = extractTagUrl('media:content')
                  || extractTagUrl('media:thumbnail')

    // enclosure — both attribute orderings
    const imgEnc = g(/<enclosure[^>]+type=["']image[^"']*["'][^>]+url=["']([^"']+)["']/)
                || g(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image[^"']*["']/)

    // description / content:encoded — decoded HTML
    const rawDesc = (c.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1] || ''
    const descDec = rawDesc
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
    const imgDesc = (descDec.match(/<img[^>]+src=["']([^"']+)["']/) || [])[1]
                 || (descDec.match(/<img[^>]+src=([^\s>]+)/) || [])[1] || ''

    const rawCE = (c.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/) || [])[1] || ''
    const ceDec = rawCE
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
    const imgCE = (ceDec.match(/<img[^>]+src=["']([^"']+)["']/) || [])[1] || ''

    // <image><url>…</url></image> inside the item (some feeds)
    const imgItemTag = g(/<image[^>]*>[\s\S]*?<url[^>]*>(https?:\/\/[^<]+)<\/url>/)

    // Google News branded thumbs are useless — skip them
    const rawImg = isGN ? '' : (imgMedia || imgEnc || imgDesc || imgCE || imgItemTag || '')
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
// Tries multiple User-Agents in parallel for speed; extracts all common image meta tags
async function fetchOGImage(url) {
  if (!url || !url.startsWith('http')) return ''

  const UAs = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  ]

  let domain = ''
  try { domain = new URL(url).hostname } catch { return '' }

  // Try all UAs in parallel — take the first successful image
  const attempts = UAs.map(async ua => {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.google.com/',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
        signal: AbortSignal.timeout(9000),
        redirect: 'follow',
      })
      if (!r.ok) return ''
      // If redirect landed on Google/paywall, bail
      try {
        const finalHost = new URL(r.url).hostname
        if (finalHost === 'news.google.com' || finalHost === 'accounts.google.com') return ''
      } catch {}
      const html = await r.text()
      // All common og/twitter/schema image meta patterns
      const img = (
        html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i) ||
        html.match(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i) ||
        // JSON-LD schema.org image
        html.match(/"image"\s*:\s*\{\s*"@type"\s*:\s*"ImageObject"\s*,\s*"url"\s*:\s*"([^"]+)"/i) ||
        html.match(/"image"\s*:\s*"(https?:\/\/[^"]{20,})"/i)
      )?.[1]?.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\\u002F/g,'/').trim() || ''
      return isArticleImage(img) ? img : ''
    } catch { return '' }
  })

  // Return first non-empty result
  return new Promise(resolve => {
    let done = false
    let pending = UAs.length
    attempts.forEach(p => p.then(img => {
      pending--
      if (!done && img) { done = true; resolve(img) }
      else if (pending === 0 && !done) resolve('')
    }))
  })
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': 'application/xml,text/xml,application/rss+xml,*/*;q=0.8',
            'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
          },
          signal: AbortSignal.timeout(12000),
        })
        if (!r.ok) { console.warn(`[news] ${name}: HTTP ${r.status}`); return [] }
        const parsed = parseRSS(await r.text(), name, trusted, gn)
        console.log(`[news] ${name}: ${parsed.length} items (${parsed.filter(a=>a.image).length} with image)`)
        return parsed
      } catch (e) { console.warn(`[news] ${name}: ${e.message}`); return [] }
    })
  )

  // Merge: direct-source first so their images win dedup
  const all    = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  const byDate = a => new Date(a.publishedAt).getTime()
  const direct = all.filter(a => !a.isGN).sort((a,b) => byDate(b) - byDate(a))
  const gn     = all.filter(a =>  a.isGN).sort((a,b) => byDate(b) - byDate(a))

  // Deduplicate by 40-char title key; ALL articles must be Hebrew real-estate
  const seen   = new Set()
  const merged = [...direct, ...gn].filter(a => {
    if (!a.title || !isHebrew(a.title)) return false
    if (!isRealEstate(a.title)) return false   // strict — no exceptions
    const k = a.title.replace(/\s+/g,'').slice(0, 40)
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // Sort newest-first, cap pool at 200 before OG enrichment
  const pool = merged.sort((a,b) => byDate(b) - byDate(a)).slice(0, 200)

  // ── OG image enrichment — NO CAP — fetch for every article missing an image ──
  const needImg = pool.filter(a => !a.image)
  console.log(`[news] OG fetching for ${needImg.length}/${pool.length} articles…`)
  const ogResults = await Promise.allSettled(needImg.map(a => fetchOGImage(a.url)))
  const ogMap = new Map(needImg.map((a, i) => [a.id, ogResults[i]]))
  const enriched = pool.map(a => {
    if (!a.image && ogMap.has(a.id)) {
      const r   = ogMap.get(a.id)
      const img = r?.status === 'fulfilled' ? r.value : ''
      return { ...a, image: img || '' }
    }
    return a
  })

  // ── STRICT: drop every article that has no image ───────────────────────────
  const withImages = enriched.filter(a => a.image)
  console.log(`[news] ${withImages.length} articles have images (dropped ${pool.length - withImages.length} imageless)`)

  // Balance (source cap applied AFTER image filter — no slot wasted on imageless)
  let balanced = balanceSources(withImages)

  // Shuffle sources for visual diversity
  balanced = shuffleSources(balanced)

  // Remove duplicate images (same URL on multiple articles = source logo)
  balanced = deduplicateImages(balanced)

  // Final: only articles with images, max 40
  const final = balanced.filter(a => a.image).slice(0, 40)

  const sources = [...new Set(final.map(a => a.source))]
  console.log(`[news] ✓ Feed ready: ${final.length} articles WITH images, ${sources.length} sources: ${sources.join(', ')}`)

  // ── Save to Supabase (only articles with images) ─────────────────────────────
  if (supabase && final.length) {
    const rows = final.map(a => ({
      id:          a.id,
      title:       a.title,
      url:         a.url,
      image:       a.image,
      source:      a.source,
      published_at: a.publishedAt,
      lang:        'he',
      archived:    false,
    }))
    supabase.from('news_articles')
      .upsert(rows, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.warn('[news] supabase upsert:', error.message) })

    // Mark articles older than 30 days as archived
    const archiveCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    supabase.from('news_articles')
      .update({ archived: true })
      .eq('lang', 'he').lt('published_at', archiveCutoff).eq('archived', false)
      .then(({ error }) => { if (error) console.warn('[news] archive-mark:', error.message) })

    // Delete articles older than 35 days to keep table lean
    const deleteCutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()
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

// ── GET /api/news/archive — last 30 days from Supabase, images only ───────────
router.get('/archive', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!supabase) return res.json([])

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('news_articles')
    .select('id, title, url, image, source, published_at')
    .eq('lang', 'he')
    .gte('published_at', cutoff)
    .not('image', 'is', null)   // only articles with images
    .neq('image', '')           // exclude empty string images
    .order('published_at', { ascending: false })
    .limit(500)

  if (error) return res.status(500).json({ error: error.message })
  res.json((data || []).filter(a => a.image))   // double-check client-side too
})

// ── GET /api/news — current live articles, images only ─────────────────────────
router.get('/', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  // Return cache first for speed
  if (CACHE.articles && CACHE.articles.length) return res.json(CACHE.articles)

  if (!supabase) return res.json([])
  const { data, error } = await supabase.from('news_articles')
    .select('*').eq('lang','he').eq('archived', false)
    .not('image', 'is', null).neq('image', '')
    .order('published_at', { ascending: false }).limit(40)
  if (error) return res.status(500).json({ error: error.message })
  res.json((data || []).filter(a => a.image))
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
