#!/usr/bin/env python3
"""
Mimics what the ESP32 does, from your laptop. If this works, the server is
fine and the issue is on the ESP. If this fails the same way the ESP does,
the server is the problem.

Usage:
    python3 test_print_endpoint.py [token]          # poll 3x, no ack
    python3 test_print_endpoint.py ack [token]      # poll + ack ok, drains queue

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
WAIT_SEC    = 25  # match ESP

def parse_args():
    """Returns (mode, token). mode is 'poll' (default) or 'ack'."""
    args = sys.argv[1:]
    mode = "poll"
    if args and args[0] == "ack":
        mode = "ack"
        args = args[1:]
    if args:
        token = args[0].strip()
    else:
        token = os.environ.get("DEVICE_TOKEN", "").strip()
        if not token:
            sys.exit("Provide the device token as the last arg, or set DEVICE_TOKEN env var.")
    return mode, token

def poll_once(token):
    """Polls /next once. Returns the job id if one was claimed, else None."""
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
                return None
            try:
                doc = json.loads(body)
            except json.JSONDecodeError:
                print(f"  body (non-JSON, {len(body)}b): {body[:200]}")
                return None
            settings = doc.get("settings")
            job      = doc.get("job")
            print(f"  settings: {settings}")
            if job:
                bmp = job.get("bitmap_b64", "")
                jid = job.get("id")
                print(f"  job id={jid} {job.get('width')}x{job.get('height')} bmp_b64_len={len(bmp)}")
                return jid
            print("  no job")
            return None
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
    return None

def ack_job(token, job_id, status="ok", error=None):
    url = f"{SERVER_BASE}/api/print/jobs/{job_id}/ack"
    payload = {"status": status}
    if error:
        payload["error"] = error
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            dt = (time.monotonic() - t0) * 1000
            print(f"  ack HTTP {resp.status} in {dt:.0f}ms (id={job_id} status={status})")
    except urllib.error.HTTPError as e:
        dt = (time.monotonic() - t0) * 1000
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            err_body = ""
        print(f"  ack HTTP {e.code} {e.reason} in {dt:.0f}ms  body={err_body}")
    except Exception as e:
        dt = (time.monotonic() - t0) * 1000
        print(f"  ack {type(e).__name__} in {dt:.0f}ms: {e}")

def main():
    mode, token = parse_args()
    print(f"server : {SERVER_BASE}")
    print(f"device : {DEVICE_ID}")
    print(f"token  : {token[:6]}…{token[-4:]} (len={len(token)})")
    print(f"wait   : {WAIT_SEC}s")
    print(f"mode   : {mode}")
    print()

    if mode == "ack":
        # Drain mode: keep polling and ack-ok-ing until the server says "no job".
        # Each ack=ok deletes the job server-side, so the queue actually empties.
        n = 0
        while True:
            n += 1
            print(f"poll {n}:")
            jid = poll_once(token)
            if not jid:
                print("  queue drained.")
                return
            ack_job(token, jid, status="ok")
            time.sleep(0.5)
    else:
        for i in range(3):
            print(f"poll {i+1}:")
            poll_once(token)
            time.sleep(1)

if __name__ == "__main__":
    main()
