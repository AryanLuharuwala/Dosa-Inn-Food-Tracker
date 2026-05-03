# BLE Printer Probe

Tool for diagnosing what protocol your Bluetooth thermal printer speaks,
without going through the browser. Talks to the printer directly via
[bleak](https://github.com/hbldh/bleak).

## Setup (one-time)

```bash
# Install bleak (works on Linux / macOS / Windows)
pip install bleak

# Linux only: ensure your user can use Bluetooth without sudo
sudo usermod -aG bluetooth $USER
# log out and back in for the group change to take effect
```

## Diagnostic flow

### 1. Scan to find your printer

```bash
python3 scripts/printer_probe.py scan
```

You'll see a table like:

```
 RSSI  ADDRESS              NAME                          ADVERTISED SERVICES
----------------------------------------------------------------------------
  -45  AA:BB:CC:DD:EE:FF    SC03h-BA71                    0000af30-...
  -78  11:22:33:44:55:66    Some other device             ...
```

Find the row for your printer. Note the **ADDRESS** (or use the device name as a substring).

### 2. Inspect what it actually exposes

```bash
python3 scripts/printer_probe.py inspect AA:BB:CC:DD:EE:FF
# or
python3 scripts/printer_probe.py inspect SC03h
```

Output is a complete dump of every BLE service and characteristic on the printer, like:

```
Service: 0000ae30-0000-1000-8000-00805f9b34fb
  Char  0000ae01-...  [write-without-response]
  Char  0000ae02-...  [notify]
  ...

--- Probe summary ---
  ✓ Cat-printer service (0000ae30-...) PRESENT — use cat-printer protocol
```

This is the most important step — it tells us exactly which protocol path to take in the web app.

### 3. Try printing a test pattern

**If `inspect` says cat-printer service is PRESENT:**
```bash
python3 scripts/printer_probe.py test-cat AA:BB:CC:DD:EE:FF
```
Sends a cat-printer protocol test print (horizontal bars + vertical stripes).
If you get paper output → the protocol works. If blank → the printer
might use slightly different command sequences or different UUIDs.

**If cat-printer service is absent, or if test-cat doesn't print:**
```bash
python3 scripts/printer_probe.py test-escpos AA:BB:CC:DD:EE:FF
```
Sends a plain ESC/POS test print. If this works → printer is plain
ESC/POS over BLE.

### 4. Report findings

Paste the `inspect` output and which `test-*` command produced paper, and
the web code can be adjusted to match exactly what your printer accepts.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `scan` doesn't see the printer | Printer asleep or paired to another app | Wake it; close iPrint app |
| `br-connection-refused` or `BREDR.ProfileUnavailable` | BlueZ on Linux tried Classic first (printer advertises both BLE & Classic) | `sudo btmgmt bredr off`, retry, then `sudo btmgmt bredr on` |
| Connect fails after pairing in OS | OS already paired the device | `bluetoothctl -- remove <addr>`; macOS: Bluetooth Settings → Forget |
| `Permission denied` opening BLE | Linux without bluetooth group | `sudo usermod -aG bluetooth $USER` and re-log |
| `inspect` connects but lists 0 services | Printer dropped link mid-discovery | Try again; some iPrint printers need 2-3 attempts |
| `test-cat` prints garbage | Wrong width — printer is 80mm not 58mm | Increase row width to 72 bytes (576 px) in `printer_probe.py` |

### The Linux-specific BR/EDR problem

Many cheap Chinese BLE thermal printers (SC03h, GB02, MX02, etc.) advertise
both Bluetooth Classic profiles (SPP, A2DP, etc — leftover from generic
firmware templates) **and** BLE. BlueZ on Linux defaults to Classic when
both are available, which fails for these devices because their Classic
side either doesn't accept connections or only accepts paired clients.

The fix is to tell the controller "ignore Classic, use LE only":

```bash
sudo btmgmt bredr off                          # disable Classic
~/.venv/bin/python3 scripts/printer_probe.py inspect <ADDR>
sudo btmgmt bredr on                           # restore Classic
```

This isn't needed on:
- **Android Chrome** — Android's BLE stack handles dual-mode devices correctly
- **macOS** — CoreBluetooth always uses LE for BLEDevice connections
- **Windows** — WinRT BLE picks LE based on the discovery context

So the deployed web app on `polly.co.in` should work from your phone right
now. The script's BR/EDR struggle is purely a Linux/BlueZ desktop issue.

## Why not just use the browser?

The browser's Web Bluetooth implementation hides timing, retries, and
errors that this script makes visible. Once we know what UUIDs work
and which test command actually produces paper, we can encode that
exact behavior into the web app.
