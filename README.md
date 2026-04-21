# Rocky Da Adda

> **"Mess ka trauma is real. Food shouldn't be."**

A mobile-first restaurant ordering system for campus dining. QR-based table ordering, preorders, PhonePe payments, a live kitchen dashboard, WhatsApp order notifications, and a full admin panel — deployable to Azure Web App.

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
| Framework | Next.js 16 (App Router, standalone output) |
| Language | TypeScript 5 |
| Database | Azure Database for PostgreSQL Flexible Server |
| Cache / Pub-Sub | Azure Cache for Redis |
| File storage | Azure Blob Storage |
| Realtime | Server-Sent Events over Redis Pub/Sub |
| Payments | PhonePe Checkout v2 |
| WhatsApp | whatsapp-web.js (separate Node.js process) |
| Process manager | pm2 (local) / Azure Web App (cloud) |
| Styling | CSS Modules + design tokens |
| State | React Context API |

---

## Azure Deployment (recommended)

### Services you need

| Azure service | Purpose |
|---|---|
| Azure Web App (Node 20) | Hosts the Next.js app |
| Azure Cosmos DB for MongoDB | Persistent data store |
| Azure Blob Storage | Menu image uploads |

### 1. Provision Azure resources

You need a **Cosmos DB for MongoDB** account and a **Storage Account**. Create the Storage Account via Cloud Shell:

```bash
RG="your-resource-group"
az storage account create --resource-group $RG --name pollysstorage \
  --location eastus --sku Standard_LRS --kind StorageV2

# Get connection string
az storage account show-connection-string --resource-group $RG \
  --name pollysstorage --query connectionString -o tsv
```

### 2. Migrate existing data (if any)

If you have local JSON files in `/data/`:
```bash
MONGO_URL="mongodb://..." npx tsx scripts/migrate-to-azure.ts
```

### 3. Set App Settings on Azure Web App

In **Azure Portal → Your Web App → Configuration → Application settings**, add:

```
MONGO_URL                          mongodb://pollys-server:key@pollys-server.mongo.cosmos.azure.com:10255/pollys-database?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@pollys-server@
MONGO_DB_NAME                      pollys-database
AZURE_STORAGE_CONNECTION_STRING    DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER_NAME       uploads
ADMIN_PASSWORD                     your-admin-password
PHONEPE_CLIENT_ID                  your-client-id
PHONEPE_CLIENT_SECRET              your-client-secret
PHONEPE_CLIENT_VERSION             1
PHONEPE_ENV                        production
PHONEPE_MERCHANT_ID                your-merchant-id
NEXT_PUBLIC_BASE_URL               https://your-app.azurewebsites.net
```

Also set **Startup Command**:
```
node /home/site/wwwroot/server.js
```

### 4. Set up GitHub Actions CI/CD

1. In GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - Secret: `AZURE_WEBAPP_PUBLISH_PROFILE` — download from Azure Portal → Web App → Overview → Get publish profile
   - Secret: `NEXT_PUBLIC_BASE_URL` — your app URL
2. In GitHub repo → **Settings → Secrets and variables → Actions → Variables**, add:
   - Variable: `AZURE_WEBAPP_NAME` — your Web App name (e.g. `rocky-da-adda`)
3. Push to `master` — the workflow in `.github/workflows/azure-deploy.yml` will build and deploy automatically.

---

## Local Development

### Prerequisites

- Node.js 20+
- A MongoDB-compatible database (local MongoDB, or point at Cosmos DB directly)

### 1. Clone & install

```bash
git clone https://github.com/AryanLuharuwala/Dosa-Inn-Food-Tracker.git
cd Dosa-Inn-Food-Tracker
npm install
cd whatsapp-service && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
MONGO_URL=mongodb://localhost:27017
MONGO_DB_NAME=rocky

# Azure Blob Storage (optional locally — skip if you don't need image upload)
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_NAME=uploads

ADMIN_PASSWORD=your-password

PHONEPE_CLIENT_ID=your-client-id
PHONEPE_CLIENT_SECRET=your-client-secret
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=sandbox
PHONEPE_MERCHANT_ID=your-merchant-id

NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Optional — voice agent
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=
```

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
│       ├── upload/            # Image upload (Azure Blob)
│       ├── whatsapp/          # Proxy to WhatsApp service
│       ├── settings/          # Edit .env.local from admin panel
│       └── livekit/token/     # Voice agent token (optional)
├── components/                # Shared UI (Header, LeafLoader, ItemSheet…)
├── db/
│   └── schema.sql             # PostgreSQL schema + seed data
├── lib/
│   ├── db.ts                  # PostgreSQL pool + Redis client
│   ├── localDb.ts             # All data access (backed by PostgreSQL)
│   ├── menuContext.tsx        # Global state (menu, orders, settings)
│   ├── cartContext.tsx        # Cart state
│   ├── apiAuth.ts             # Auth helpers + Redis rate limiter
│   ├── paymentTokens.ts       # Server-side single-use payment tokens (PostgreSQL)
│   ├── serverEvents.ts        # SSE broadcast via Redis Pub/Sub
│   ├── whatsapp.ts            # WhatsApp notification helpers
│   └── useSound.ts            # Sound hook
├── scripts/
│   └── migrate-to-azure.ts   # One-time JSON → PostgreSQL migration
├── whatsapp-service/
│   └── server.js              # Standalone WhatsApp Node.js process
├── public/
│   └── sounds/                # UI sound effects
├── .github/workflows/
│   └── azure-deploy.yml       # CI/CD: build + deploy to Azure Web App
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

> **Note on Azure:** WhatsApp requires a persistent browser session and local disk. It is not suited to Azure Web App's ephemeral containers. Run it on a separate VM or a Linux VPS alongside the Azure deployment, or disable it if not needed.

---

## Security

- All write operations on `/api/db` require an admin session cookie
- `order_add` requires a server-issued, single-use **payment token** that is only issued after PhonePe confirms `COMPLETED` — prevents free-order attacks
- Login is rate-limited (5 attempts / 10 min per IP) via Redis
- PhonePe status check is rate-limited (20 req / min per IP) via Redis
- Image upload is admin-only, max 5 MB, image types only
- WhatsApp service only accepts connections from `127.0.0.1`
- Sensitive env values are masked in the admin UI

---

## Admin Access

Default URL: `https://your-app.azurewebsites.net/admin`  
Password: set via `ADMIN_PASSWORD` environment variable (or change it from the admin panel).

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
