#!/usr/bin/env python3
"""
Mimics what the ESP32 does, from your laptop. If this works, the server is
fine and the issue is on the ESP. If this fails the same way the ESP does,
the server is the problem.

Usage:
    python3 test_print_endpoint.py [token]

Without a token argument, reads DEVICE_TOKEN from env.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error

SERVER_BASE = os.environ.get("SERVER_BASE", "https://pollys.food")
DEVICE_ID   = os.environ.get("DEVICE_ID",   "printer")
WAIT_SEC    = 2  # match ESP

def get_token():
    if len(sys.argv) >= 2:
        return sys.argv[1].strip()
    t = os.environ.get("DEVICE_TOKEN")
    if not t:
        sys.exit("Provide the device token as arg 1, or set DEVICE_TOKEN env var.")
    return t.strip()

def poll_once(token):
    url = f"{SERVER_BASE}/api/print/jobs/next?device={DEVICE_ID}&wait={WAIT_SEC}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
    })
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=WAIT_SEC + 10) as resp:
            dt = (time.monotonic() - t0) * 1000
            print(f"  HTTP {resp.status} in {dt:.0f}ms")
            body = resp.read().decode("utf-8", errors="replace")
            if not body:
                print("  (empty body)")
                return
            try:
                doc = json.loads(body)
            except json.JSONDecodeError:
                print(f"  body (non-JSON, {len(body)}b): {body[:200]}")
                return
            settings = doc.get("settings")
            job      = doc.get("job")
            print(f"  settings: {settings}")
            if job:
                bmp = job.get("bitmap_b64", "")
                print(f"  job id={job.get('id')} {job.get('width')}x{job.get('height')} bmp_b64_len={len(bmp)}")
            else:
                print("  no job")
    except urllib.error.HTTPError as e:
        dt = (time.monotonic() - t0) * 1000
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            err_body = ""
        print(f"  HTTP {e.code} {e.reason} in {dt:.0f}ms  body={err_body}")
    except urllib.error.URLError as e:
        dt = (time.monotonic() - t0) * 1000
        print(f"  URLError in {dt:.0f}ms: {e.reason}")
    except Exception as e:
        dt = (time.monotonic() - t0) * 1000
        print(f"  {type(e).__name__} in {dt:.0f}ms: {e}")

def main():
    token = get_token()
    print(f"server : {SERVER_BASE}")
    print(f"device : {DEVICE_ID}")
    print(f"token  : {token[:6]}…{token[-4:]} (len={len(token)})")
    print(f"wait   : {WAIT_SEC}s")
    print()
    for i in range(3):
        print(f"poll {i+1}:")
        poll_once(token)
        time.sleep(1)

if __name__ == "__main__":
    main()
