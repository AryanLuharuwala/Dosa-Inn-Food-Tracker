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
        Connect and dump every service + characteristic. This is the
        most important diagnostic — it tells us exactly which UUIDs
        and properties the printer exposes.

    python3 printer_probe.py test-cat <ADDRESS_OR_NAME>
        Send a cat-printer / iPrint protocol test print: a few
        horizontal bars + the text "TEST" rendered as a bitmap.
        If this prints, the printer is cat-protocol and our web
        code should work after the next deploy.

    python3 printer_probe.py test-escpos <ADDRESS_OR_NAME>
        Send a plain ESC/POS test print. If this prints (and test-cat
        doesn't), the printer is plain ESC/POS over BLE.

ADDRESS_OR_NAME can be:
    - a MAC address like AA:BB:CC:DD:EE:FF (Linux/Windows)
    - a UUID like 12345678-1234-1234-1234-123456789ABC (macOS)
    - a substring of the device name like "SC03h" (will scan + match)
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

# Common alternate BLE thermal printer service UUIDs to probe
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


# Cat-printer command opcodes
CMD_GET_DEVICE_STATE = 0xa3
CMD_LATTICE = 0xa6
CMD_FEED = 0xa1
CMD_SPEED = 0xbd
CMD_ENERGY = 0xaf
CMD_APPLY_ENERGY = 0xbe
CMD_BITMAP = 0xa2

LATTICE_START = bytes([0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c])
LATTICE_END = bytes([0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17])


# ── Resolution helpers ──────────────────────────────────────────────────────

async def resolve(target: str):
    """Accept a MAC, UUID, or name substring; return a BLEDevice."""
    # If it looks like an address (colons or all-hex-uuid), use directly
    if ':' in target or len(target) >= 32:
        return target

    print(f"Looking for device matching name '{target}'...")
    found = await BleakScanner.discover(timeout=8.0)
    candidates = [d for d in found if (d.name or '') and target.lower() in d.name.lower()]
    if not candidates:
        print(f"No device found matching '{target}'. Available devices:")
        for d in found:
            print(f"  {d.address}  {d.name!r}")
        sys.exit(1)
    if len(candidates) > 1:
        print(f"Multiple matches; using first: {candidates[0].address} ({candidates[0].name})")
    return candidates[0].address


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
    rows.sort(reverse=True)  # strongest signal first
    print(f"{'RSSI':>5}  {'ADDRESS':<20}  {'NAME':<28}  ADVERTISED SERVICES")
    print('-' * 100)
    for rssi, addr, name, services in rows:
        rssi_str = str(rssi) if rssi != -999 else '?'
        print(f"{rssi_str:>5}  {addr:<20}  {name[:28]:<28}  {services}")


async def cmd_inspect(target: str):
    addr = await resolve(target)
    print(f"\nConnecting to {addr}...")
    async with BleakClient(addr, timeout=15.0) as c:
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
        # Check which known services this printer exposes
        all_uuids = {svc.uuid for svc in c.services}
        if CAT_PRINT_SRV in all_uuids:
            print(f"  ✓ Cat-printer service ({CAT_PRINT_SRV}) PRESENT — use cat-printer protocol")
        else:
            print(f"  ✗ Cat-printer service ({CAT_PRINT_SRV}) absent")
        for s in ALT_PRINT_SERVICES:
            if s in all_uuids:
                print(f"  ✓ Alternate service {s} PRESENT")


async def cmd_test_cat(target: str):
    addr = await resolve(target)
    print(f"Connecting to {addr}...")
    async with BleakClient(addr, timeout=15.0) as c:
        print("Connected.")
        # Locate the cat-printer write characteristic
        tx = None
        for svc in c.services:
            if svc.uuid.lower() == CAT_PRINT_SRV.lower():
                for ch in svc.characteristics:
                    if ch.uuid.lower() == CAT_PRINT_TX.lower():
                        tx = ch
                        break
        if tx is None:
            print(f"ERROR: cat-printer TX char ({CAT_PRINT_TX}) not found on {CAT_PRINT_SRV}.")
            print("This printer doesn't expose the cat-printer service. Run `inspect` to see what it has.")
            return

        async def send(packet: bytes):
            await c.write_gatt_char(tx, packet, response=False)

        print("\nSending preamble (state probe, lattice, speed, energy, apply)...")
        await send(frame(CMD_GET_DEVICE_STATE, b'\x00'))
        await send(frame(CMD_LATTICE, LATTICE_START))
        await send(frame(CMD_SPEED, b'\x20'))                                   # speed = 32
        await send(frame(CMD_ENERGY, bytes([0xc0, 0x5d, 0x00, 0x00])))          # energy = 24000 (LE)
        await send(frame(CMD_APPLY_ENERGY, b'\x01'))

        print("Sending test bitmap (24 rows × 384 px)...")
        # Pattern: 4 solid black, 4 white, 4 black, 4 white, then a vertical-stripe block
        pattern_rows = []
        for _ in range(4): pattern_rows.append(bytes([0xff] * 48))
        for _ in range(4): pattern_rows.append(bytes([0x00] * 48))
        for _ in range(4): pattern_rows.append(bytes([0xff] * 48))
        for _ in range(4): pattern_rows.append(bytes([0x00] * 48))
        # Vertical stripes (every other byte filled)
        stripes = bytes([0xff if i % 2 == 0 else 0x00 for i in range(48)])
        for _ in range(8): pattern_rows.append(stripes)

        for row in pattern_rows:
            await send(frame(CMD_BITMAP, row))
            await asyncio.sleep(0.005)  # tiny pacing — some BLE printers choke without it

        print("Sending postamble (feed 64, lattice end)...")
        await send(frame(CMD_FEED, b'\x40\x00'))
        await send(frame(CMD_LATTICE, LATTICE_END))

        print("\nDone. If paper printed bars + stripes, cat-printer protocol works! ✓")
        print("If blank, the printer either uses a different protocol or different UUIDs.")
        print("Run the `inspect` command to see what services this printer actually exposes.")


async def cmd_test_escpos(target: str):
    addr = await resolve(target)
    print(f"Connecting to {addr}...")
    async with BleakClient(addr, timeout=15.0) as c:
        print("Connected.")
        # Find any writable characteristic (preferring writeWithoutResponse)
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
            print("ERROR: No writable characteristic found. Run `inspect` to see what's available.")
            return

        ESC = 0x1b
        GS = 0x1d
        data = bytearray()
        data += bytes([ESC, 0x40])                                  # init
        data += bytes([ESC, 0x61, 0x01])                            # center
        data += bytes([ESC, 0x45, 0x01])                            # bold on
        data += bytes([GS, 0x21, 0x11])                             # double-size
        data += b"ESC/POS TEST\n"
        data += bytes([GS, 0x21, 0x00])                             # normal size
        data += bytes([ESC, 0x45, 0x00])                            # bold off
        data += bytes([ESC, 0x61, 0x00])                            # left
        data += b"-" * 32 + b"\n"
        data += b"If you see this text, the\n"
        data += b"printer accepts plain ESC/POS\n"
        data += b"over BLE.\n"
        data += b"-" * 32 + b"\n\n\n\n"
        data += bytes([GS, 0x56, 0x42, 0x00])                       # feed + cut

        print(f"Sending {len(data)} bytes of ESC/POS in 100-byte chunks...")
        try:
            response = 'write-without-response' not in tx.properties
            for i in range(0, len(data), 100):
                chunk = bytes(data[i:i + 100])
                await c.write_gatt_char(tx, chunk, response=response)
                await asyncio.sleep(0.01)
            print("\nDone. If paper printed text, ESC/POS works! ✓")
            print("If blank, this printer likely uses a proprietary bitmap protocol.")
        except Exception as e:
            print(f"\nWrite error: {e}")


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
