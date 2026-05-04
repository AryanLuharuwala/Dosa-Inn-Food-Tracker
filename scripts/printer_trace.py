#!/usr/bin/env python3
"""
Printer protocol tracer / parity tester.

Runs ONE of two byte sequences against a real cat-printer and emits a
timestamped JSONL trace of every BLE op (write, notify, sleep, error):

    probe   - the verbatim Wireshark capture (same bytes/timing as
              printer_probe.py test-cat). The known-good baseline.

    website - the bytes + timing the production website is supposed to emit
              (a Python port of lib/catPrinter.ts + lib/bluetoothPrinter.ts).
              If this trace is byte-and-timing identical to `probe`, the
              website is in sync with the captured sequence.

Usage:
    pip install bleak
    python3 scripts/printer_trace.py probe   <ADDR_OR_NAME> [out.jsonl]
    python3 scripts/printer_trace.py website <ADDR_OR_NAME> [out.jsonl]

After running both, diff the two JSONL files (`kind` + `hex` columns) to
see exactly where they diverge. Anything other than the bitmap-row content
or the per-event `t` (timestamp) being slightly different means there's
a real protocol gap.
"""

import asyncio
import json
import sys
import time
from typing import Optional

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("ERROR: bleak is not installed. Run:\n    pip install bleak", file=sys.stderr)
    sys.exit(1)


# ── BLE UUIDs ────────────────────────────────────────────────────────────────

CAT_PRINT_SRV = "0000ae30-0000-1000-8000-00805f9b34fb"
CAT_PRINT_TX  = "0000ae01-0000-1000-8000-00805f9b34fb"
CAT_PRINT_RX  = "0000ae02-0000-1000-8000-00805f9b34fb"
CAT_PRINT_RX2 = "0000ae04-0000-1000-8000-00805f9b34fb"
CAT_PRINT_RX3 = "0000ae05-0000-1000-8000-00805f9b34fb"
RX_UUIDS = [CAT_PRINT_RX, CAT_PRINT_RX2, CAT_PRINT_RX3]


# ── Cat-printer protocol primitives (Python mirror of lib/catPrinter.ts) ─────

def crc8(data: bytes) -> int:
    """CRC-8 poly 0x07 init 0x00, computed over payload only."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xff if crc & 0x80 else (crc << 1) & 0xff
    return crc


def frame(cmd: int, payload: bytes) -> bytes:
    return bytes([
        0x51, 0x78, cmd, 0x00,
        len(payload) & 0xff, (len(payload) >> 8) & 0xff,
        *payload,
        crc8(payload),
        0xff,
    ])


def u8(*b: int) -> bytes:
    return bytes(b)


def u16(n: int) -> bytes:
    return bytes([n & 0xff, (n >> 8) & 0xff])


CMD_GET_DEVICE_INFO  = 0xa8
CMD_GET_DEVICE_STATE = 0xa3
CMD_SET_DPI          = 0xa4
CMD_LATTICE          = 0xa6
CMD_FEED             = 0xa1
CMD_SPEED            = 0xbd
CMD_ENERGY           = 0xaf
CMD_APPLY_ENERGY     = 0xbe
CMD_BITMAP           = 0xa2
CMD_WARMUP           = 0xbb

LATTICE_START = bytes([0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c])
LATTICE_END   = bytes([0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17])

DEFAULT_SPEED  = 30      # 0x1E
DEFAULT_ENERGY = 12000   # 0x2EE0
FINISH_FEED    = 48      # 0x0030


# ── Tracer ───────────────────────────────────────────────────────────────────

class Tracer:
    """Timestamped JSONL event logger. Writes to stdout always; to a file if
    given. Every event includes monotonic-clock seconds since construction."""

    def __init__(self, label: str, out_path: Optional[str]):
        self.t0 = time.monotonic()
        self.label = label
        self.f = open(out_path, 'w') if out_path else None
        self.emit('start', mode=label)

    def emit(self, kind: str, **kw):
        ev = {'t': round(time.monotonic() - self.t0, 4), 'kind': kind, **kw}
        # Compact line for stdout, full JSON for file
        h = kw.get('hex', '')
        h_short = (h[:32] + '…') if len(h) > 32 else h
        extras = ' '.join(f'{k}={v}' for k, v in kw.items() if k not in ('hex',))
        print(f"[{ev['t']:7.3f}s] {kind:14} {extras}{(' hex=' + h_short) if h else ''}")
        if self.f:
            self.f.write(json.dumps(ev) + '\n')
            self.f.flush()

    def close(self):
        if self.f:
            self.f.close()


# ── Connect + subscribe (shared) ─────────────────────────────────────────────

def explain_connect_error(e: Exception, addr: str) -> str:
    """Decode common bleak/BlueZ connect failures into an actionable hint.
    Same heuristics as scripts/printer_probe.py."""
    msg = str(e) or repr(e)
    low = msg.lower()
    if 'br-connection-refused' in low or 'bredr' in low:
        return (
            "BlueZ tried Bluetooth Classic (BR/EDR) instead of LE and it failed. "
            "The printer's LE side is fine — Linux just picks the wrong transport. "
            f"Fix: sudo btmgmt bredr off  (then retry trace, then sudo btmgmt bredr on). "
            f"Or unpair: bluetoothctl -- remove {addr}"
        )
    if 'le-connection-abort-by-local' in low:
        return "Adapter aborted the LE handshake. Restart bluetooth: sudo systemctl restart bluetooth"
    if 'notready' in low.replace(' ', ''):
        return "BlueZ adapter not ready — bluetoothctl power on"
    if 'in progress' in low or 'already' in low:
        return "Previous connection still pending — wait a few seconds and retry"
    if 'timed out' in low or 'timeout' in low:
        return (
            "Connect timed out. Most common cause on Linux is the BR/EDR fallback — "
            "sudo btmgmt bredr off, retry, sudo btmgmt bredr on. "
            "Also try unpairing in OS Bluetooth settings."
        )
    return ""


async def resolve(target: str, tr: Tracer):
    target_lower = target.lower()
    tr.emit('scan_begin', target=target)
    found = await BleakScanner.discover(timeout=8.0)
    for d in found:
        if d.address.lower() == target_lower:
            tr.emit('scan_found', address=d.address, name=d.name or '')
            return d
    if ':' not in target and len(target) < 32:
        for d in found:
            if d.name and target_lower in d.name.lower():
                tr.emit('scan_found', address=d.address, name=d.name)
                return d
    tr.emit('scan_fail', target=target,
            seen=[(d.address, d.name or '') for d in found])
    sys.exit(1)


async def connect_subscribe(c: BleakClient, tr: Tracer):
    # bleak connects on context-manager enter; this is just the post-connect
    # bookkeeping that mirrors what the website does after gatt.connect().
    tr.emit('connected', mtu=getattr(c, 'mtu_size', None))

    def cb(uuid: str):
        return lambda _, data: tr.emit('notify', char=uuid[:8],
                                       length=len(data), hex=data.hex())

    for u in RX_UUIDS:
        try:
            await c.start_notify(u, cb(u))
            tr.emit('notify_sub', char=u[:8])
        except Exception as e:
            tr.emit('notify_sub_skip', char=u[:8], error=str(e))


def find_tx(client: BleakClient, tr: Tracer):
    for svc in client.services:
        if svc.uuid.lower() == CAT_PRINT_SRV:
            for ch in svc.characteristics:
                if ch.uuid.lower() == CAT_PRINT_TX:
                    tr.emit('tx_found', service=svc.uuid, char=ch.uuid)
                    return ch
    tr.emit('tx_missing', service=CAT_PRINT_SRV, char=CAT_PRINT_TX)
    return None


async def write(c: BleakClient, tx, data: bytes, tr: Tracer, label: str = ''):
    tr.emit('write', label=label, length=len(data), hex=data.hex())
    await c.write_gatt_char(tx, data, response=False)


async def sleep(seconds: float, tr: Tracer, label: str = ''):
    tr.emit('sleep', label=label, ms=round(seconds * 1000, 1))
    await asyncio.sleep(seconds)


# ── Mode "probe": Wireshark verbatim (matches printer_probe.py test-cat) ─────

PROBE_PREAMBLE_HEX = (
    '5178a30001000000ff'                          # GetDeviceState
    '5178a40001003399ff'                          # SetDpi 0x33
    '5178a6000b00aa551738445f5f5f44382ca1ff'      # Lattice start
    '5178af000200e02e89ff'                        # Energy = 12000 (u16)
    '5178be0001000000ff'                          # ApplyEnergy 0x00
    '5178bd0001001e5aff'                          # Speed = 30
)

PROBE_POSTAMBLE_HEX = (
    '5178bd000100194fff'                          # Speed = 25
    '5178a10002003000f9ff'                        # Feed 48
    '5178a10002003000f9ff'                        # Feed 48 (again)
    '5178bd000100194fff'                          # Speed 25
    '5178a6000b00aa5517000000000000001711ff'      # Lattice end
    '5178a30001000000ff'                          # Final GetDeviceState
)


def test_pattern_rows() -> list[bytes]:
    """24 rows × 48 bytes — the same test pattern as printer_probe.py:
    horizontal bars then vertical stripes."""
    rows: list[bytes] = []
    for _ in range(4): rows.append(bytes([0xff] * 48))
    for _ in range(4): rows.append(bytes([0x00] * 48))
    for _ in range(4): rows.append(bytes([0xff] * 48))
    for _ in range(4): rows.append(bytes([0x00] * 48))
    stripes = bytes([0xff if i % 2 == 0 else 0x00 for i in range(48)])
    for _ in range(8): rows.append(stripes)
    return rows


async def run_probe(target: str, tr: Tracer):
    device = await resolve(target, tr)
    async with BleakClient(device, timeout=15.0) as c:
        await connect_subscribe(c, tr)
        tx = find_tx(c, tr)
        if not tx:
            return

        tr.emit('phase', name='warmup')
        await write(c, tx, bytes.fromhex('5178a80001000000ff5178a30001000000ff'), tr, 'warmup_a')
        await write(c, tx, bytes.fromhex('5178bb0001000107ff'), tr, 'warmup_b')
        await sleep(0.1, tr, 'after_warmup')

        tr.emit('phase', name='preamble')
        await write(c, tx, bytes.fromhex(PROBE_PREAMBLE_HEX), tr, 'preamble')
        await sleep(0.05, tr, 'after_preamble')

        tr.emit('phase', name='bitmap')
        rows = test_pattern_rows()
        for i, row in enumerate(rows):
            await write(c, tx, frame(CMD_BITMAP, row), tr, f'row_{i}')
            if i < len(rows) - 1:
                await sleep(0.01, tr, f'after_row_{i}')

        tr.emit('phase', name='postamble')
        await write(c, tx, bytes.fromhex(PROBE_POSTAMBLE_HEX), tr, 'postamble')
        await sleep(0.5, tr, 'tail_settle')
        tr.emit('done')


# ── Mode "website": port of lib/catPrinter.ts + lib/bluetoothPrinter.ts ──────
# Each helper here is the Python equivalent of the TypeScript function with
# the same name. If you change the TS, change this too — that's the point.

def website_warmup_a() -> bytes:
    return frame(CMD_GET_DEVICE_INFO, u8(0)) + frame(CMD_GET_DEVICE_STATE, u8(0))


def website_warmup_b() -> bytes:
    return frame(CMD_WARMUP, u8(1))


def website_preamble() -> bytes:
    return (
        frame(CMD_GET_DEVICE_STATE, u8(0)) +
        frame(CMD_SET_DPI,          u8(0x33)) +
        frame(CMD_LATTICE,          LATTICE_START) +
        frame(CMD_ENERGY,           u16(DEFAULT_ENERGY)) +
        frame(CMD_APPLY_ENERGY,     u8(0)) +
        frame(CMD_SPEED,            u8(DEFAULT_SPEED))
    )


def website_postamble() -> bytes:
    return (
        frame(CMD_SPEED,            u8(0x19)) +
        frame(CMD_FEED,             u16(FINISH_FEED)) +
        frame(CMD_FEED,             u16(FINISH_FEED)) +
        frame(CMD_SPEED,            u8(0x19)) +
        frame(CMD_LATTICE,          LATTICE_END) +
        frame(CMD_GET_DEVICE_STATE, u8(0))
    )


async def run_website(target: str, tr: Tracer):
    """Mirrors lib/bluetoothPrinter.ts catPrint() exactly:
       warmup_a → warmup_b → 100ms → preamble → 50ms →
       (row → 10ms) × N (no trailing 10ms) → postamble → 500ms"""
    device = await resolve(target, tr)
    async with BleakClient(device, timeout=15.0) as c:
        await connect_subscribe(c, tr)
        tx = find_tx(c, tr)
        if not tx:
            return

        tr.emit('phase', name='warmup')
        await write(c, tx, website_warmup_a(), tr, 'warmup_a')
        await write(c, tx, website_warmup_b(), tr, 'warmup_b')
        await sleep(0.100, tr, 'after_warmup')

        tr.emit('phase', name='preamble')
        await write(c, tx, website_preamble(), tr, 'preamble')
        await sleep(0.050, tr, 'after_preamble')

        tr.emit('phase', name='bitmap')
        rows = test_pattern_rows()
        for i, row in enumerate(rows):
            await write(c, tx, frame(CMD_BITMAP, row), tr, f'row_{i}')
            if i < len(rows) - 1:
                await sleep(0.010, tr, f'after_row_{i}')

        tr.emit('phase', name='postamble')
        await write(c, tx, website_postamble(), tr, 'postamble')
        await sleep(0.500, tr, 'tail_settle')
        tr.emit('done')


# ── Self-check (no printer required) ─────────────────────────────────────────

def selfcheck():
    """Verify the website-mode byte builders produce byte-identical output to
    the verbatim Wireshark hex used in probe-mode. Run with no printer:
        python3 scripts/printer_trace.py selfcheck
    """
    expected_warmup_a = bytes.fromhex('5178a80001000000ff5178a30001000000ff')
    expected_warmup_b = bytes.fromhex('5178bb0001000107ff')
    expected_preamble = bytes.fromhex(PROBE_PREAMBLE_HEX)
    expected_postamble = bytes.fromhex(PROBE_POSTAMBLE_HEX)

    checks = [
        ('warmup_a',  website_warmup_a(),  expected_warmup_a),
        ('warmup_b',  website_warmup_b(),  expected_warmup_b),
        ('preamble',  website_preamble(),  expected_preamble),
        ('postamble', website_postamble(), expected_postamble),
    ]
    ok = True
    for label, got, want in checks:
        match = got == want
        status = '✓' if match else '✗'
        print(f"  {status} {label:10}  got={got.hex()}  want={want.hex()}")
        if not match:
            ok = False
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    if len(sys.argv) >= 2 and sys.argv[1] == 'selfcheck':
        selfcheck()
        return
    if len(sys.argv) < 3 or sys.argv[1] not in ('probe', 'website'):
        print(__doc__)
        sys.exit(1)
    mode = sys.argv[1]
    target = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) >= 4 else None

    tr = Tracer(label=mode, out_path=out_path)
    try:
        if mode == 'probe':
            await run_probe(target, tr)
        else:
            await run_website(target, tr)
    except Exception as e:
        # str(e) is sometimes empty on bleak exceptions — capture type and
        # repr too so the trace file has enough info to debug from.
        tr.emit('error',
                type=type(e).__name__,
                message=str(e),
                repr=repr(e))
        hint = explain_connect_error(e, target)
        if hint:
            tr.emit('hint', text=hint)
        raise
    finally:
        tr.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
