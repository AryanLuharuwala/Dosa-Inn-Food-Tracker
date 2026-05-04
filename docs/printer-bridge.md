# Printer Bridge — ESP32 Endpoint Contract

The ESP32 BLE bridge polls HTTPS endpoints on the server to fetch pre-rendered receipt bitmaps and delivers them to the thermal printer via bitbank2's `Thermal_Printer` library.

---

## Authentication

Every request must include:

```
Authorization: Bearer <token>
```

The token is a 43-character URL-safe base64 string generated once via the admin UI at `/admin/print-devices`. Only its bcrypt hash is stored server-side. A revoked token receives `401` on all requests.

---

## Endpoints

### 1. `GET /api/print/jobs/next?device=<id>`

Poll for the next queued receipt.

**Rate limit:** 1 req/s per device.

**Response — empty queue:**
```
HTTP 204 No Content
```

**Response — job available:**
```
HTTP 200 OK
Content-Type: application/json

{
  "id":         "<hex string, 32 chars>",
  "width":      384,
  "height":     <int, varies per receipt>,
  "bitmap_b64": "<base64-encoded bytes>",
  "feed_lines": 32
}
```

`bitmap_b64` decodes to `(width / 8) * height` bytes = `48 * height` bytes.

**Bitmap format:**
- 1 bit per pixel
- MSB of each byte = leftmost pixel (standard raster order)
- Row-major, no padding between rows
- White = 0, Black = 1
- Pass directly to `Thermal_Printer::printBitmap(width, height, data)` — the library handles all model-specific framing

The job enters an **inflight** state with a 60-second visibility timeout when returned. If the bridge crashes and never acks, the job will re-appear in the queue after 60 s.

---

### 2. `POST /api/print/jobs/:id/ack`

Acknowledge delivery of a job.

**Rate limit:** 5 req/s per device.

**Request body:**
```json
{ "status": "ok" }
```
or
```json
{ "status": "error", "error": "short description" }
```

**On `ok`:** job is deleted from the queue.

**On `error`:** job returns to the queue with a retry counter. After 3 failed attempts the job is marked `dead` and no longer re-queued.

**Response (both cases):**
```
HTTP 200 OK
{ "ok": true }
```

---

## Suggested polling loop (pseudo-code)

```cpp
void loop() {
    delay(1000); // respect 1 req/s rate limit

    HttpResponse r = GET("/api/print/jobs/next?device=" + DEVICE_ID, bearer);
    if (r.status == 204) return; // nothing to do

    Job job = parse(r.body);
    uint8_t* bitmap = base64_decode(job.bitmap_b64);

    bool ok = printer.printBitmap(job.width, job.height, bitmap);
    printer.feed(job.feed_lines);
    free(bitmap);

    POST("/api/print/jobs/" + job.id + "/ack", bearer,
         ok ? {"status":"ok"} : {"status":"error","error":"print failed"});
}
```

---

## Security guarantees

- The token authorises **only** `/api/print/jobs/next` and `/api/print/jobs/:id/ack`. No other route accepts device bearer tokens.
- `next` returns the server-chosen next job. The device cannot request a specific job by id, list historical jobs, or access any order data.
- The `bitmap_b64` payload is an opaque raster — no order items, prices, or customer data are present in the response.
- Revoking a device immediately stops it receiving jobs. Rotate by revoking the old entry and creating a new one.
