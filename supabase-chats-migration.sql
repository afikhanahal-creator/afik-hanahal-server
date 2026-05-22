-- Run this in: Supabase Dashboard → SQL Editor

-- 1. Chat messages table (WhatsApp CRM)
CREATE TABLE IF NOT EXISTS chats (
  id          BIGSERIAL   PRIMARY KEY,
  phone       TEXT        NOT NULL,
  direction   TEXT        NOT NULL DEFAULT 'out',  -- 'in' = from lead, 'out' = from us
  message     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'sent', -- sent | received | failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chats_phone_idx ON chats (phone, created_at DESC);

-- 2. Add lead_status column to existing contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'new';
-- Values: new | contacted | negotiating | won | lost

-- 3. Verify
SELECT 'chats table OK' AS status FROM chats LIMIT 0;
SELECT 'contacts.lead_status OK' AS status FROM contacts LIMIT 0;
