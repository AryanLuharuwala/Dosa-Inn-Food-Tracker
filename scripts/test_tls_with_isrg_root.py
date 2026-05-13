#!/usr/bin/env python3
"""
Connect to pollys.food using ONLY the ISRG Root X1 cert as a trust anchor —
the exact same cert the ESP firmware pins via setCACert(). If this fails the
cert chain on the server doesn't validate to ISRG Root X1, which means the
ESP's TLS pin is the reason it sees "connection refused".

If this script succeeds with HTTP 200/401/204, the cert chain is fine and
the ESP failure is a different network-path issue.
"""

import os
import sys
import ssl
import tempfile
import urllib.request

# Same PEM as TLS_CA_CERT in scripts/esp32_printer_bridge/esp32_printer_bridge.ino
# DigiCert Global Root G2 — pollys.food's actual root.
ISRG_ROOT_X1 = """\
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
"""

SERVER = os.environ.get("SERVER_BASE", "https://pollys.food")
TOKEN  = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEVICE_TOKEN", "")

# Build an SSL context that trusts ONLY ISRG Root X1 — no system CAs.
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.check_hostname = True
ctx.verify_mode = ssl.CERT_REQUIRED

# load_verify_locations needs a file path. Write to a temp file.
with tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False) as f:
    f.write(ISRG_ROOT_X1)
    capath = f.name

ctx.load_verify_locations(cafile=capath)

print(f"server: {SERVER}")
print(f"trust : ISRG Root X1 ONLY (mimicking ESP setCACert)")
print(f"token : {('set, len=' + str(len(TOKEN))) if TOKEN else 'none'}")
print()

url = f"{SERVER}/api/print/jobs/next?device=printer&wait=2"
req = urllib.request.Request(url)
if TOKEN:
    req.add_header("Authorization", f"Bearer {TOKEN}")

try:
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        print(f"HTTP {resp.status} — TLS chain validates against ISRG Root X1 ✓")
        body = resp.read(200).decode("utf-8", errors="replace")
        print(f"body: {body[:200]}")
except ssl.SSLError as e:
    print(f"TLS error — cert chain does NOT validate against ISRG Root X1")
    print(f"  {e}")
    print()
    print("Diagnosis: the cert pinned in your ESP firmware no longer matches")
    print("what pollys.food serves. Likely fixes:")
    print("  - Server is now behind Cloudflare or a different proxy")
    print("  - LE rotated to a different root chain")
    print("  - Update TLS_CA_CERT in the firmware to the current root")
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code} {e.reason} — TLS OK, server returned an error")
except urllib.error.URLError as e:
    print(f"URLError — TLS or network: {e.reason}")
except Exception as e:
    print(f"{type(e).__name__}: {e}")
