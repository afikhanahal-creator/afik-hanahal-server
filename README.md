# Afik Hanahal — API server

Express API backing the Afik Hanahal real-estate site. Persists properties,
leads, news, chats and settings in Supabase, and stores media (images/PDFs) in
Supabase Storage with videos on Cloudinary.

```bash
npm install
cp .env.example .env   # fill in the values
npm start              # node index.js  (PORT defaults to 3001)
```

## Storage & egress optimizations

These keep Supabase storage size and egress low **without changing the API
response contract** (`/api/upload/*` still return `{ url }`, `/api/properties`
still returns the same shape).

### 1. Server-side image compression (`/api/upload/image`, `/api/upload/images`)
Every uploaded image is processed with [`sharp`](https://sharp.pixelplumbing.com/)
before it hits Storage: auto-oriented, resized to **max 1600px** wide, converted
to **WebP @ q80**, and stripped of all EXIF/metadata. Typically a ~10× size drop.

### 2. Long cache headers on every upload
All Storage uploads set `cacheControl: '31536000'` (1 year) + `upsert: true`, so
repeat views are served from the public CDN edge instead of re-fetching from the
origin bucket — the biggest repeat-egress win.

### 3. Content-hash filenames (dedupe)
Images are stored as `<sha256-of-compressed-bytes>.webp`. If the object already
exists the upload is skipped and the existing public URL is returned, so the same
photo is never stored twice.

### 4. Orphan cleanup
The property `data` blob is scanned for Supabase Storage URLs. On
`DELETE /api/properties/:id` those objects are removed from Storage; on
`PUT /api/properties/:id` any image/PDF the edit dropped is removed. The cleanup
is **dedupe-aware**: because identical images share one content-hash object
(see #3), an object is only deleted if **no other property still references it**.
Best-effort — never blocks the write.

### 5. Videos go to Cloudinary, not Supabase (`/api/upload/video`)
Videos are the heaviest objects, so they are not stored in Supabase Storage:
- If `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_UPLOAD_PRESET` are set → uploaded to
  Cloudinary's video CDN, returns its `secure_url` as `{ url }`.
- Otherwise → returns a guiding error (HTTP 501) telling the admin to configure
  Cloudinary, unless `ALLOW_SUPABASE_VIDEO=true` (escape hatch that keeps the old
  Supabase behavior). Upload size is capped by `VIDEO_MAX_MB` (default 150).

### 6. Response compression
`compression` middleware gzip/brotli-compresses all responses, including the
`/api/properties` JSON. Uploads already return URLs only — never base64-embedded
media — so payloads stay small.

### 7. Public caching on `GET /api/properties`
Public (non-admin) responses send an `ETag` + `Cache-Control: public,
max-age=60, stale-while-revalidate=600` and answer `304 Not Modified` on a
matching `If-None-Match`. Admin requests are always `no-store`.

### 8. Supabase checklist
- Buckets `property-images` / `property-pdfs` must be **public** (auto-created on
  first upload) so the CDN can serve them.
- Confirm objects carry `cache-control: max-age=31536000` (visible in the
  response headers of a public object URL).

## Environment variables
See [`.env.example`](./.env.example). Storage-relevant additions:
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `VIDEO_MAX_MB`,
`ALLOW_SUPABASE_VIDEO`.
