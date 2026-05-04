# Prompt for the website-making agent

Paste the section below into the website agent. It is scoped tightly so the
endpoint cannot be abused to leak orders, customer data, or anything beyond
the receipts the kitchen would have printed anyway.

---

Add a **print-job queue** to the existing Next.js app on Vercel that an
ESP32 BLE bridge can poll over HTTPS. The bridge sits next to a thermal
printer in the kitchen; it is not a general-purpose API client. Treat
this as a hardware integration with a strict, narrow surface.

## What the endpoint must expose — and nothing else

Only **bills/receipts already queued for printing** by the existing
order flow. No order list, no customer info, no menu, no analytics, no
search, no historical lookup, no "give me job by index N". The device
can only ask "what's next?" and "I'm done with this one".

Concretely, three routes under `app/api/print/jobs/`:

1. `GET /api/print/jobs/next?device=<id>`
   - Returns `204 No Content` if the queue is empty.
   - Otherwise `200` with JSON:
     ```json
     {
       "id":         "<opaque uuid>",
       "width":      384,
       "height":     <int>,
       "bitmap_b64": "<base64 of (width/8)*height bytes>",
       "feed_lines": 32
     }
     ```
   - `bitmap_b64` is a **1-bit, MSB-first, byte-padded raster** of the
     receipt — the same kind of bitmap the existing Web Bluetooth code
     in `cat-printer/` builds via canvas + Floyd–Steinberg dithering.
     The firmware uses bitbank2's Thermal_Printer library which handles
     all per-model framing, so the server only needs to produce the
     raster — not protocol bytes. Reuse the existing canvas renderer:
     extract it into `lib/printer/` so both the browser and the server
     can call it. Do **not** return raw receipt text, JSON line-items,
     HTML, PNG, or anything else — only the opaque 1-bit raster.
   - Pops the job into an "in-flight" state with a 60-second visibility
     timeout, so a crashed bridge doesn't lose the job.

2. `POST /api/print/jobs/:id/ack`
   - Body: `{ "status": "ok" }` or `{ "status": "error", "error": "..." }`.
   - On `ok` → delete the job. On `error` → return it to the queue with
     a retry counter; after 3 failures, mark `dead` and stop redelivering.

3. (internal) `POST /api/print/jobs` — called by the existing order
   submission flow when a bill needs to be printed. Not exposed to the
   bridge. Body is the order id; the handler looks up the order, renders
   it to a 384-px-wide 1-bit dithered bitmap (reuse the existing client
   canvas renderer — extract it into a shared module under
   `lib/printer/` so both the browser and the server can call it), and
   inserts a row with the raw raster bytes.

## Auth

A single static **bearer token per physical printer device**, stored in
a `print_devices` table (`id`, `token_hash`, `label`, `created_at`,
`last_seen_at`, `revoked`). Token is generated once, shown once in the
admin UI, and only its bcrypt/argon2 hash is stored. The device sends
`Authorization: Bearer <token>` on every request. Revoking is a single
flag flip — no rotation dance.

The token authorizes **only** these three routes. It must not be
accepted by any other API route. Implement this as a dedicated
`requireDeviceToken(req)` helper in `lib/printer/auth.ts`; do not piggy-
back on the existing user/session auth.

## Hard constraints — please follow strictly

- No endpoint that lists, searches, or retrieves a job by id chosen by
  the client. The only "read" is `next` (server picks); `ack` takes the
  id the server just handed out. This makes it impossible for a stolen
  token to scrape historical bills.
- The `bitmap_b64` is an opaque 1-bit raster. The endpoint never returns
  the order's structured contents (items, prices, customer name, phone,
  address) as JSON. If a future feature needs that on the device,
  someone has to add a new route and review it then — don't pre-build it.
- Rate-limit `next` to e.g. 1 req/sec per device token; `ack` to 5/sec.
- Log device polls to `last_seen_at` so the admin UI can show "printer
  online 4s ago" without adding a separate health endpoint.
- CORS: these routes are **same-origin only**. No `Access-Control-Allow-Origin`.
- No public listing of `print_devices`. Admin UI surfaces them behind
  the existing admin auth.

## Storage

Use the existing database (whatever the project already uses — check
`db/` and `lib/db*` before adding anything new). Two new tables:
`print_devices` and `print_jobs (id, device_id, payload, status,
attempts, visible_after, created_at)`. `payload` is `bytea`/`Buffer`,
not text — base64-encode only at the API edge.

## Admin UI

One page under the existing admin section: list devices with
online/offline indicator and last-seen, "create device" button that
generates a token and shows it once, "revoke" button. No way to view or
re-fetch the token after creation. No way to view queued payloads
(they're opaque bytes; there's nothing useful to show, and rendering
them would defeat the point).

## What to deliver

- The three API routes above with the auth helper.
- The two tables (migration).
- The shared encoder module under `lib/printer/` extracted from the
  existing browser code, callable from both client and server.
- Hook into the existing "print bill" action so it enqueues a job
  instead of (or in addition to) opening the BLE picker.
- Admin page for device tokens.
- A short `docs/printer-bridge.md` describing the endpoint contract for
  the firmware (matching what the ESP32 already expects: the JSON shape
  in section 1 above).

Don't add: a websocket push channel, a "print arbitrary text" endpoint,
a label printer mode, a job-history viewer, multi-tenant device groups,
or anything else not listed. Keep the surface tiny.
