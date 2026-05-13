#!/usr/bin/env python3
"""
Fetch the next print job exactly the way the ESP would, then decode the
base64 bitmap and save it as a PNG so we can SEE what the server is
producing. Two failure modes look very similar on paper but differ here:

  - Server has no fonts → PNG shows literal [] [] boxes (missing-glyph
    tofu). Fix on the server (install + register fonts in node-canvas).

  - Bit packing is wrong → PNG renders gibberish/mirrored text. Fix the
    encoder.

Usage:
    # Trigger a print from admin first (so a job exists), then:
    python3 scripts/dump_next_job.py <token>

Requires:  pip install Pillow
"""
import os
import sys
import json
import base64
import urllib.request
import urllib.error

try:
    from PIL import Image
except ImportError:
    sys.exit("pip install Pillow")

SERVER = os.environ.get("SERVER_BASE", "https://pollys.food")
TOKEN  = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEVICE_TOKEN", "")
if not TOKEN:
    sys.exit("Provide token as arg 1 or set DEVICE_TOKEN")

# Try BOTH bit orderings so we can see which one looks right.
def decode_bitmap(buf: bytes, width: int, height: int, lsb_first: bool) -> Image.Image:
    bytes_per_row = (width + 7) // 8
    img = Image.new("1", (width, height), 1)  # white
    px = img.load()
    for y in range(height):
        for x in range(width):
            byte = buf[y * bytes_per_row + (x >> 3)]
            bit = (byte >> (x & 7)) & 1 if lsb_first else (byte >> (7 - (x & 7))) & 1
            if bit:
                px[x, y] = 0  # black
    return img

url = f"{SERVER}/api/print/jobs/next?device=printer&wait=2"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
print(f"GET {url}")

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
        doc = json.loads(body)
except Exception as e:
    sys.exit(f"failed: {e}")

print(f"settings: {doc.get('settings')}")
job = doc.get("job")
if not job:
    sys.exit("No job in queue. Trigger a print from admin first, then re-run.")

print(f"job id={job['id']}  {job['width']}x{job['height']}")
buf = base64.b64decode(job["bitmap_b64"])
print(f"bitmap raw bytes: {len(buf)} (expected {((job['width']+7)//8)*job['height']})")

# Save both encodings — open both PNGs and look at which one is legible.
for lsb, suffix in [(True, "_LSB.png"), (False, "_MSB.png")]:
    img = decode_bitmap(buf, job["width"], job["height"], lsb_first=lsb)
    out = f"/tmp/job_{job['id'][:8]}{suffix}"
    img.save(out)
    print(f"saved: {out}")

print()
print("Open the two PNGs. Whichever one is legible tells us the server's")
print("bit ordering. If BOTH look garbled (boxes/symbols), the canvas itself")
print("rendered missing-glyph tofu — that's a font issue on the server.")
