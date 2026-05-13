#!/usr/bin/env python3
"""
Dump every print_device's owner-identifying info, so we can confirm which
device a given token belongs to and how recently it checked in.

Run from your laptop (this script does NOT need admin session — it talks to
MongoDB directly via the same env Next.js uses).

    python3 diag_devices.py

Reads MONGO_URL + MONGO_DB_NAME from env or .env.local.
"""
import os
import sys
from datetime import datetime, timezone

# Best-effort .env.local loader
try:
    from pathlib import Path
    for envf in [Path(".env.local"), Path("../.env.local"), Path("../../.env.local")]:
        if envf.exists():
            for line in envf.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            break
except Exception:
    pass

try:
    from pymongo import MongoClient
except ImportError:
    sys.exit("pip install pymongo  # required")

MONGO_URL    = os.environ.get("MONGO_URL")    or sys.exit("MONGO_URL not set")
MONGO_DB     = os.environ.get("MONGO_DB_NAME") or sys.exit("MONGO_DB_NAME not set")

def rel(ts):
    if not ts:
        return "never"
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - ts.astimezone(timezone.utc)
    s = int(delta.total_seconds())
    if s < 60:   return f"{s}s ago"
    if s < 3600: return f"{s // 60}m ago"
    return f"{s // 3600}h ago"

client = MongoClient(MONGO_URL)
db = client[MONGO_DB]
devices = list(db.print_devices.find({}).sort("created_at", 1))

print(f"MongoDB : {MONGO_DB}")
print(f"Devices : {len(devices)}")
print()
print(f"{'id':<18} {'label':<20} {'revoked':<8} {'last_seen':<14} {'settings':<40}")
print("-" * 110)
for d in devices:
    print(f"{d.get('id', '?')[:16]:<18} "
          f"{(d.get('label') or '')[:18]:<20} "
          f"{str(bool(d.get('revoked'))):<8} "
          f"{rel(d.get('last_seen_at')):<14} "
          f"{str(d.get('settings') or {}):<40}")

print()
jobs = list(db.print_jobs.find({}, {"payload": 0}).sort("created_at", 1))
print(f"Jobs    : {len(jobs)}")
for j in jobs[-5:]:
    print(f"  {j.get('id', '')[:16]:<18} {j.get('status', '?'):<10} kind={j.get('kind', '?'):<6} {rel(j.get('created_at'))}")
