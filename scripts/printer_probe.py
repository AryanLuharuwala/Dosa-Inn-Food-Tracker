#!/usr/bin/env python3
"""
BLE thermal printer probe & test tool.

Lets you scan for, inspect, and send test prints to a Bluetooth Low Energy
thermal printer (cat-printer / iPrint family or ESC/POS BLE printers)
without going through the browser. Useful for diagnosing what protocol
the printer actually speaks.

Requires:
    pip install bleak

Usage:
    python3 printer_probe.py scan
        Scan for nearby BLE devices for ~8 seconds and list them.

    python3 printer_probe.py inspect <ADDRESS_OR_NAME>
        Connect and dump every service + characteristic. The most
        important diagnostic — tells us exactly which UUIDs and
        properties the printer exposes.

    python3 printer_probe.py test-cat <ADDRESS_OR_NAME>
        Send a cat-printer / iPrint protocol test print: horizontal
        bars + vertical stripes rendered as a 384-px bitmap. If this
        prints, the printer speaks cat-protocol and our web code
        will work after the next deploy.

    python3 printer_probe.py test-escpos <ADDRESS_OR_NAME>
        Send a plain ESC/POS test print. If this prints (and test-cat
        doesn't), the printer is plain ESC/POS over BLE.

ADDRESS_OR_NAME can be:
    - a MAC address like AA:BB:CC:DD:EE:FF (Linux/Windows)
    - a UUID like 12345678-1234-1234-1234-123456789ABC (macOS)
    - a substring of the device name like "SC03h"

Note: every command does its own BLE-only scan first, so connections
always go over the LE transport (vital for printers that advertise
both Bluetooth Classic and BLE — without this, BlueZ picks Classic
and you get br-connection-refused).
"""

import asyncio
import sys

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("ERROR: bleak is not installed. Run:\n    pip install bleak", file=sys.stderr)
    sys.exit(1)


# ── Cat-printer / iPrint family UUIDs ────────────────────────────────────────
CAT_ADV_SRV = "0000af30-0000-1000-8000-00805f9b34fb"
CAT_PRINT_SRV = "0000ae30-0000-1000-8000-00805f9b34fb"
CAT_PRINT_TX = "0000ae01-0000-1000-8000-00805f9b34fb"
CAT_PRINT_RX = "0000ae02-0000-1000-8000-00805f9b34fb"

# Common alternate BLE thermal printer service UUIDs to highlight in inspect
ALT_PRINT_SERVICES = [
    "000018f0-0000-1000-8000-00805f9b34fb",  # Goojprt / Mocodo
    "0000ff00-0000-1000-8000-00805f9b34fb",  # generic vendor
    "0000ff10-0000-1000-8000-00805f9b34fb",  # Xprinter
    "0000ffe0-0000-1000-8000-00805f9b34fb",  # HM-10 BLE serial bridge
    "0000fee7-0000-1000-8000-00805f9b34fb",  # iPrint variant
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",  # ISSC / Microchip
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e",  # Nordic UART (NUS)
]


# ── Cat-printer wire protocol ────────────────────────────────────────────────

def crc8(data: bytes) -> int:
    """CRC-8 with poly 0x07, init 0x00 — what cat-printers expect."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xff if crc & 0x80 else (crc << 1) & 0xff
    return crc


def frame(cmd: int, payload: bytes) -> bytes:
    """Build a cat-printer command packet:
       51 78 [cmd] [type=0] [len_lo] [len_hi] [payload...] [crc8] FF
    """
    return bytes([
        0x51, 0x78, cmd, 0x00,
        len(payload) & 0xff, (len(payload) >> 8) & 0xff,
        *payload,
        crc8(payload),
        0xff,
    ])


CMD_GET_DEVICE_STATE = 0xa3
CMD_LATTICE = 0xa6
CMD_FEED = 0xa1
CMD_SPEED = 0xbd
CMD_ENERGY = 0xaf
CMD_APPLY_ENERGY = 0xbe
CMD_BITMAP = 0xa2

LATTICE_START = bytes([0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c])
LATTICE_END = bytes([0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17])


# ── Resolution & error handling ──────────────────────────────────────────────

async def resolve(target: str):
    """Find the device via BLE-only scan and return its BLEDevice object.

    Always returning a BLEDevice (not a raw address string) is critical
    for devices that advertise both BR/EDR (Classic) and BLE — like
    cheap Chinese thermal printers. Passing an address string lets BlueZ
    pick BR/EDR by default; passing a BLEDevice forces LE since the
    scanner only saw the LE advertisement.
    """
    target_lower = target.lower()
    print(f"Scanning (LE-only, 8s) for '{target}'...")
    found = await BleakScanner.discover(timeout=8.0)
    for d in found:
        if d.address.lower() == target_lower:
            print(f"Found {d.address}  ({d.name!r})")
            return d
    if ':' not in target and len(target) < 32:
        candidates = [d for d in found if (d.name or '') and target_lower in d.name.lower()]
        if candidates:
            d = candidates[0]
            print(f"Found {d.address}  ({d.name!r})")
            return d
    print(f"\nNo BLE-advertising device found matching '{target}'. Available:")
    for d in found:
        print(f"  {d.address}  {d.name!r}")
    print("\nIf the printer was visible via `scan` but not here, it stopped")
    print("advertising on LE — power-cycle it and retry.")
    sys.exit(1)


def explain_connect_error(e: Exception, device) -> None:
    """Decode common BlueZ / bleak connect failures into actionable hints."""
    msg = str(e)
    print(f"\nConnect failed: {msg}\n")
    is_bredr = 'br-connection-refused' in msg or 'BREDR' in msg or 'bredr' in msg.lower()
    if is_bredr:
        print("  → BlueZ tried Bluetooth Classic (BR/EDR) profiles instead of BLE,")
        print("    and they all failed. This is a Linux-specific issue — the printer")
        print("    advertises BOTH transports, so BlueZ tries Classic first by")
        print("    default. The printer's BLE side itself is fine (nRF Connect on")
        print("    Android can talk to it; Chrome's Web Bluetooth on Android should")
        print("    too).")
        print()
        print("    Workaround: disable Classic on the adapter, then connect.")
        print("    Run as root or with sudo:")
        print(f"        sudo btmgmt bredr off")
        print(f"        ~/.venv/bin/python3 scripts/printer_probe.py inspect {device.address}")
        print(f"        sudo btmgmt bredr on   # restore Classic afterwards")
        print()
        print("    Or skip Linux entirely and test from your Android phone:")
        print("    open the deployed admin page in Chrome on Android, tap")
        print("    'Connect Printer' — same BLE stack as nRF Connect, should pair.")
    elif 'le-connection-abort-by-local' in msg:
        print("  → Adapter aborted the LE handshake. Usually fixed by restarting")
        print("    the Bluetooth service:  sudo systemctl restart bluetooth")
    elif 'NotReady' in msg:
        print("  → BlueZ adapter not ready. Try:  bluetoothctl power on")
    elif 'Already' in msg or 'In Progress' in msg:
        print("  → Previous connection attempt still pending. Wait a few seconds and retry.")


# ── Commands ─────────────────────────────────────────────────────────────────

async def cmd_scan():
    print("Scanning for 8 seconds...\n")
    found = await BleakScanner.discover(timeout=8.0, return_adv=True)
    rows = []
    for addr, (device, adv) in found.items():
        rssi = adv.rssi if adv else None
        name = device.name or '<unnamed>'
        services = ', '.join(adv.service_uuids) if adv and adv.service_uuids else ''
        rows.append((rssi or -999, addr, name, services))
    rows.sort(reverse=True)
    print(f"{'RSSI':>5}  {'ADDRESS':<20}  {'NAME':<28}  ADVERTISED SERVICES")
    print('-' * 100)
    for rssi, addr, name, services in rows:
        rssi_str = str(rssi) if rssi != -999 else '?'
        print(f"{rssi_str:>5}  {addr:<20}  {name[:28]:<28}  {services}")


async def cmd_inspect(target: str):
    device = await resolve(target)
    print(f"\nConnecting to {device.address} (forcing BLE transport)...")
    try:
        async with BleakClient(device, timeout=15.0) as c:
            print(f"Connected. MTU = {getattr(c, 'mtu_size', '?')}\n")
            for svc in c.services:
                print(f"Service: {svc.uuid}  {svc.description or ''}")
                for ch in svc.characteristics:
                    props = ', '.join(ch.properties)
                    print(f"  Char  {ch.uuid}  [{props}]  {ch.description or ''}")
                    for desc in ch.descriptors:
                        print(f"    Desc {desc.uuid}")
                print()
            print("--- Probe summary ---")
            all_uuids = {svc.uuid for svc in c.services}
            if CAT_PRINT_SRV in all_uuids:
                print(f"  ✓ Cat-printer service ({CAT_PRINT_SRV}) PRESENT — use cat-printer protocol")
            else:
                print(f"  ✗ Cat-printer service ({CAT_PRINT_SRV}) absent")
            for s in ALT_PRINT_SERVICES:
                if s in all_uuids:
                    print(f"  ✓ Alternate service {s} PRESENT")
    except Exception as e:
        explain_connect_error(e, device)


async def cmd_test_cat(target: str):
    """Replays the *exact* byte sequence captured from iPrint via Wireshark
    (lisp3r/bluetooth-thermal-printer). The init/warmup/header/footer are
    cribbed verbatim — only the bitmap rows are our test pattern."""
    device = await resolve(target)
    print(f"Connecting to {device.address} (forcing BLE transport)...")
    try:
        async with BleakClient(device, timeout=15.0) as c:
            print("Connected.")
            tx = None
            rx_uuids = [CAT_PRINT_RX, "0000ae04-0000-1000-8000-00805f9b34fb", "0000ae05-0000-1000-8000-00805f9b34fb"]
            for svc in c.services:
                if svc.uuid.lower() == CAT_PRINT_SRV.lower():
                    for ch in svc.characteristics:
                        if ch.uuid.lower() == CAT_PRINT_TX.lower():
                            tx = ch
                            break
            if tx is None:
                print(f"ERROR: cat-printer TX char ({CAT_PRINT_TX}) not found on {CAT_PRINT_SRV}.")
                print("Run `inspect` to see what services this printer actually exposes.")
                return

            # The captured init sequence enables notifications on AE02/AE04
            # and indications on AE05 *before* sending any commands. Without
            # this, some firmware variants silently drop subsequent writes.
            print("Enabling notifications on AE02/AE04/AE05...")
            for u in rx_uuids:
                try:
                    await c.start_notify(u, lambda _s, d: print(f"  notify {u[:8]}: {d.hex()}"))
                except Exception as e:
                    print(f"  (skipped {u[:8]}: {e})")

            async def send(packet: bytes):
                await c.write_gatt_char(tx, packet, response=False)

            async def send_hex(hex_str: str):
                await send(bytes.fromhex(hex_str.replace(' ', '')))

            # Warmup — copied verbatim from the Wireshark dump
            print("\nWarmup: GetDeviceInfo + GetDeviceState...")
            await send_hex('5178a80001000000ff 5178a30001000000ff')
            print("Warmup: cmd 0xBB...")
            await send_hex('5178bb0001000107ff')
            await asyncio.sleep(0.1)

            # Header (verbatim, Speed=30, Energy=12000, ApplyEnergy=0)
            print("Header: state, dpi, lattice-start, energy, apply, speed...")
            await send_hex(
                '5178a30001000000ff'                           # GetDeviceState
                '5178a40001003399ff'                           # SetDpi 0x33
                '5178a6000b00aa551738445f5f5f44382ca1ff'      # Lattice start
                '5178af000200e02e89ff'                         # Energy = 12000 (0x2EE0)
                '5178be0001000000ff'                           # ApplyEnergy 0x00
                '5178bd0001001e5aff'                           # Speed = 30 (0x1E)
            )
            await asyncio.sleep(0.05)

            # Test bitmap (24 rows × 384 px)
            print("Bitmap: 24 rows × 48 bytes each...")
            pattern_rows = []
            for _ in range(4): pattern_rows.append(bytes([0xff] * 48))
            for _ in range(4): pattern_rows.append(bytes([0x00] * 48))
            for _ in range(4): pattern_rows.append(bytes([0xff] * 48))
            for _ in range(4): pattern_rows.append(bytes([0x00] * 48))
            stripes = bytes([0xff if i % 2 == 0 else 0x00 for i in range(48)])
            for _ in range(8): pattern_rows.append(stripes)
            for row in pattern_rows:
                await send(frame(CMD_BITMAP, row))
                await asyncio.sleep(0.01)

            # Footer (verbatim from dump)
            print("Footer: speed, feed×2, lattice-end, state...")
            await send_hex(
                '5178bd000100194fff'                           # Speed = 25 (0x19)
                '5178a10002003000f9ff'                         # Feed 48 lines
                '5178a10002003000f9ff'                         # Feed 48 lines (again)
                '5178bd000100194fff'                           # Speed 25
                '5178a6000b00aa5517000000000000001711ff'      # Lattice end
                '5178a30001000000ff'                           # Final GetDeviceState
            )
            await asyncio.sleep(0.5)

            print("\nDone. If paper printed bars + stripes, cat-printer protocol works ✓")
            print("If blank: this printer model needs additional warmup commands.")
            print("If garbled (vertical stripes wavy): printer is 80mm not 58mm — adjust width.")
    except Exception as e:
        explain_connect_error(e, device)


async def cmd_test_escpos(target: str):
    device = await resolve(target)
    print(f"Connecting to {device.address} (forcing BLE transport)...")
    try:
        async with BleakClient(device, timeout=15.0) as c:
            print("Connected.")
            tx = None
            for svc in c.services:
                for ch in svc.characteristics:
                    if 'write-without-response' in ch.properties:
                        tx = ch
                        print(f"Using {svc.uuid} / {ch.uuid} (writeWithoutResponse)")
                        break
                if tx: break
            if not tx:
                for svc in c.services:
                    for ch in svc.characteristics:
                        if 'write' in ch.properties:
                            tx = ch
                            print(f"Using {svc.uuid} / {ch.uuid} (write)")
                            break
                    if tx: break
            if not tx:
                print("ERROR: No writable characteristic found. Run `inspect`.")
                return

            ESC, GS = 0x1b, 0x1d
            data = bytearray()
            data += bytes([ESC, 0x40])
            data += bytes([ESC, 0x61, 0x01])
            data += bytes([ESC, 0x45, 0x01])
            data += bytes([GS, 0x21, 0x11])
            data += b"ESC/POS TEST\n"
            data += bytes([GS, 0x21, 0x00])
            data += bytes([ESC, 0x45, 0x00])
            data += bytes([ESC, 0x61, 0x00])
            data += b"-" * 32 + b"\n"
            data += b"If you see this text, the\n"
            data += b"printer accepts plain ESC/POS\n"
            data += b"over BLE.\n"
            data += b"-" * 32 + b"\n\n\n\n"
            data += bytes([GS, 0x56, 0x42, 0x00])

            print(f"Sending {len(data)} bytes of ESC/POS in 100-byte chunks...")
            response = 'write-without-response' not in tx.properties
            for i in range(0, len(data), 100):
                chunk = bytes(data[i:i + 100])
                await c.write_gatt_char(tx, chunk, response=response)
                await asyncio.sleep(0.01)
            print("\nDone. If paper printed text, ESC/POS works ✓")
            print("If blank, this printer uses a proprietary bitmap protocol.")
    except Exception as e:
        explain_connect_error(e, device)


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'scan':
        await cmd_scan()
    elif cmd == 'inspect' and len(sys.argv) >= 3:
        await cmd_inspect(sys.argv[2])
    elif cmd in ('test-cat', 'test_cat') and len(sys.argv) >= 3:
        await cmd_test_cat(sys.argv[2])
    elif cmd in ('test-escpos', 'test_escpos') and len(sys.argv) >= 3:
        await cmd_test_escpos(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
