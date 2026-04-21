# Rocky Da Adda

> **"Mess ka trauma is real. Food shouldn't be."**

A mobile-first restaurant ordering system for campus dining. QR-based table ordering, preorders, PhonePe payments, a live kitchen dashboard, WhatsApp order notifications, and a full admin panel — all self-hosted, no cloud database required.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

**Customer side**
- Scan a QR code or enter a table number to start ordering
- Browse 80+ menu items with images, search, and category filters
- Add-ons, quantity control, real-time price totals
- Pay via PhonePe (UPI, cards, net banking)
- Preorder with a pickup time slot
- Real-time order tracking: Pending → Preparing → Ready → Delivered

**Admin panel** (`/admin`)
- Live order dashboard with one-click status updates
- Menu management — add, edit, delete items and categories with image upload
- Rush Hour mode — bulk-disable slow-prep items during peak hours
- Chef management — assign food categories to specific chefs
- WhatsApp notifications — scan QR to link a WhatsApp account; customers get automatic status updates
- Export all data as JSON or CSV
- Edit restaurant name, tagline, PhonePe credentials, and admin password from the dashboard

**Kitchen dashboard** (`/kitchen`, `/cook`)
- Orders grouped by chef with color-coded cards
- Tick off individual items; order auto-completes when all done
- Live updates via Server-Sent Events (no page refresh needed)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Database | Local JSON files (`/data/*.json`) — no external DB |
| Realtime | Server-Sent Events (`/api/events`) |
| Payments | PhonePe Checkout v2 |
| WhatsApp | whatsapp-web.js (separate Node.js process) |
| Process manager | pm2 |
| Styling | CSS Modules + design tokens |
| State | React Context API |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### 1. Clone & install

```bash
git clone https://github.com/AryanLuharuwala/Dosa-Inn-Food-Tracker.git
cd Dosa-Inn-Food-Tracker
npm install
cd whatsapp-service && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env.local   # or copy manually
```

Edit `.env.local`:

```env
ADMIN_PASSWORD=your-password

PHONEPE_CLIENT_ID=your-client-id
PHONEPE_CLIENT_SECRET=your-client-secret
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=sandbox           # or: production
PHONEPE_MERCHANT_ID=your-merchant-id

NEXT_PUBLIC_BASE_URL=https://yoursite.com

# Optional — for the voice agent feature
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=

WA_SERVICE_PORT=3478
```

You can also edit all of these from **Admin → WA tab → Payment & App Settings** after the first login.

### 3. Build & run

**Development:**
```bash
npm run dev
```

**Production (with pm2):**
```bash
npm run build
pm2 start ecosystem.config.js
```

---

## Self-Hosted Install (Linux)

Run the installer once on a fresh Linux server — it handles Node, pm2, Chromium (for WhatsApp), dependencies, `.env.local` setup wizard, build, and systemd auto-start:

```bash
bash install.sh
```

After install, the app runs at `http://localhost:3000` and restarts automatically on reboot.

---

## Self-Hosted Install (Windows)

Open PowerShell and run:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
.\install.ps1
```

Or just double-click `start.bat` after the initial install.

---

## Project Structure

```
├── app/
│   ├── page.tsx               # Landing page
│   ├── table/                 # Table QR / number entry
│   ├── menu/                  # Menu browsing
│   ├── checkout/              # Cart + PhonePe payment
│   ├── payment-result/        # Post-payment verification
│   ├── order-confirmed/       # Order success
│   ├── track-order/           # Customer order tracking
│   ├── preorder/              # Preorder flow
│   ├── admin/                 # Admin panel
│   ├── kitchen/               # Kitchen display (grouped by chef)
│   ├── cook/                  # Cook view
│   └── api/
│       ├── db/                # All data reads/writes
│       ├── auth/login/        # Admin login (rate-limited)
│       ├── phonepe/status/    # PhonePe payment verification
│       ├── events/            # SSE stream for live updates
│       ├── upload/            # Image upload
│       ├── whatsapp/          # Proxy to WhatsApp service
│       ├── settings/          # Edit .env.local from admin panel
│       └── livekit/token/     # Voice agent token (optional)
├── components/                # Shared UI (Header, LeafLoader, ItemSheet…)
├── lib/
│   ├── localDb.ts             # File-based JSON database
│   ├── menuContext.tsx        # Global state (menu, orders, settings)
│   ├── cartContext.tsx        # Cart state
│   ├── apiAuth.ts             # Auth helpers + rate limiter
│   ├── paymentTokens.ts       # Server-side single-use payment tokens
│   ├── serverEvents.ts        # SSE broadcast
│   ├── whatsapp.ts            # WhatsApp notification helpers
│   └── useSound.ts            # Sound hook
├── whatsapp-service/
│   └── server.js              # Standalone WhatsApp Node.js process
├── data/                      # JSON data files (auto-created on first run)
├── public/
│   ├── sounds/                # UI sound effects
│   └── uploads/               # Uploaded menu images
├── ecosystem.config.js        # pm2 process config
├── install.sh                 # Linux self-installer
├── install.ps1                # Windows self-installer
└── start.bat                  # Windows quick-start
```

---

## WhatsApp Notifications

The WhatsApp feature runs as a separate process (`whatsapp-service/server.js`) so it can maintain a persistent browser session without blocking Next.js.

1. Start the service (pm2 handles this automatically, or `cd whatsapp-service && node server.js`)
2. Go to **Admin → WA tab → Connect** and scan the QR with your WhatsApp
3. Customers who enter their phone number at checkout receive messages when their order status changes

The admin panel includes a live log viewer and a disconnect button.

---

## Security

- All write operations on `/api/db` require an admin session cookie
- `order_add` requires a server-issued, single-use **payment token** that is only issued after PhonePe confirms `COMPLETED` — prevents free-order attacks
- Login is rate-limited (5 attempts / 10 min per IP)
- PhonePe status check is rate-limited (20 req / min per IP)
- Image upload is admin-only, max 5 MB, image types only
- WhatsApp service only accepts connections from `127.0.0.1`
- Sensitive env values are masked in the admin UI

---

## Admin Access

Default URL: `http://localhost:3000/admin`  
Password: set via `ADMIN_PASSWORD` in `.env.local` (or change it from the admin panel).

---

## Design Tokens

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#1a4d2e` | Forest green — buttons, badges |
| `--color-accent` | `#7cb342` | Leaf green — tags, highlights |
| `--color-bg` | `#f8f6f1` | Off-white background |
| `--color-warning` | `#ff9800` | Orange — alerts |
| Font | Inter | Sans-serif |

---

**Scan. Order. Eat. Repeat.**
