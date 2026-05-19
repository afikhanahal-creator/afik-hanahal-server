-- ─────────────────────────────────────────────────────────────────────────────
-- Afik Hanahal — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Properties
--    The full frontend property object is stored as JSONB.
--    "published" is denormalised for fast filtering.
--    IDs are the same numeric timestamps the frontend generates (Date.now()).
CREATE TABLE IF NOT EXISTS properties (
  id         BIGINT      PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  published  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS properties_published_idx ON properties (published);
CREATE INDEX IF NOT EXISTS properties_created_idx   ON properties (created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_updated_at ON properties;
CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 2. Contacts (lead submissions from the website contact form)
CREATE TABLE IF NOT EXISTS contacts (
  id            BIGSERIAL   PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  message       TEXT,
  prop_title    TEXT,
  prop_location TEXT,
  source        TEXT        NOT NULL DEFAULT 'website',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_created_idx ON contacts (created_at DESC);


-- 3. News article cache
--    Frontend still fetches from Bing; it also POSTs articles here as a backup.
CREATE TABLE IF NOT EXISTS news_articles (
  id           TEXT        PRIMARY KEY,   -- URL or Bing article ID
  title        TEXT,
  url          TEXT,
  image        TEXT,
  source       TEXT,
  published_at TIMESTAMPTZ,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lang         TEXT        NOT NULL DEFAULT 'he',
  archived     BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS news_lang_idx      ON news_articles (lang, archived);
CREATE INDEX IF NOT EXISTS news_published_idx ON news_articles (published_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security (RLS)
-- The server uses the service-role key which bypasses RLS, so these policies
-- are only relevant if you ever use the anon/public key from the browser.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE properties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

-- Allow public reads for published properties
CREATE POLICY "Public can read published properties"
  ON properties FOR SELECT
  USING (published = true);

-- Allow public inserts to contacts (contact form submissions)
CREATE POLICY "Public can submit contacts"
  ON contacts FOR INSERT
  WITH CHECK (true);

-- Allow public reads for non-archived news
CREATE POLICY "Public can read news"
  ON news_articles FOR SELECT
  USING (archived = false);

CREATE POLICY "Public can upsert news"
  ON news_articles FOR INSERT
  WITH CHECK (true);
