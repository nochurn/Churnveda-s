# Churnveda - AI Retention Employee SaaS Platform

Production-grade B2B SaaS platform for Churn Prediction, AI-driven Revenue Retention, and Multi-channel Customer Outreach (WhatsApp + Resend Email).

---

## Architecture Overview

Churnveda is architected as a modern full-stack web application:
- **Frontend SPA**: React 19, Tailwind CSS v4, Lucide icons, Motion, Vite 6.
- **Backend API**: Node.js & Express (`server.ts` bundled via esbuild to `dist/server.cjs`), featuring tenant isolation, Supabase Auth & PostgreSQL persistence, Razorpay USD subscriptions & webhooks, and Gemini AI.

---

## 1. Netlify Deployment (Frontend)

The repository includes a ready-to-use `netlify.toml` and `public/_redirects` configured for Netlify:

### Netlify Build Settings:
- **Build Command**: `npm run build` (or `npm run build:client`)
- **Publish Directory**: `dist`
- **Node Version**: `20`

### SPA Routing & Redirects:
- Netlify will serve `index.html` on all client-side routes (e.g. `/pricing`, `/login`, `/dashboard`, `/settings`) with HTTP 200 via `_redirects` and `netlify.toml`.

### Connecting Frontend to Backend on Netlify:
Netlify hosts static frontend assets and serverless functions. Because Churnveda's backend includes an Express server with webhooks, cron schedulers, and database synchronization, the recommended production setup is:
1. Deploy the Backend to a Node.js container service (Railway, Render, Fly.io, or AWS).
2. Configure Netlify to proxy API calls by uncommenting the proxy rule in `netlify.toml`:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://your-backend-service.up.railway.app/api/:splat"
     status = 200
     force = true
   ```
   *Alternatively*, set `VITE_API_URL=https://your-backend-service.up.railway.app` in your Netlify environment variables.

---

## 2. Environment Variables Required on Netlify

Add the following environment variables in **Netlify Site Settings > Build & Deploy > Environment**:

| Variable | Description | Exposure |
| :--- | :--- | :--- |
| `NODE_VERSION` | Set to `20` | Build time |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://xyz.supabase.co`) | Frontend (Public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase public anonymous API key | Frontend (Public) |
| `NEXT_PUBLIC_SITE_URL` | Your live Netlify site URL (`https://your-app.netlify.app`) | Frontend (Public) |
| `VITE_API_URL` | *(Optional)* Full URL to your deployed backend API | Frontend (Public) |

---

## 3. Backend Deployment (Railway, Render, or Docker)

For running the Node.js backend (`server.ts`):
- **Build Command**: `npm run build`
- **Start Command**: `node dist/server.cjs`
- **Database Migration**: `npm run db:migrate` (or automatic at boot)

### Backend Environment Variables:
| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `GEMINI_API_KEY` | Google Gemini API key for AI churn scoring |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (`rzp_live_...` or `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook secret for HMAC signature verification |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token for WhatsApp outreach |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business Phone Number ID |
| `RESEND_API_KEY` | Resend API key for automated customer retention emails |
| `RESEND_FROM_EMAIL` | Sender email address (e.g., `Churnveda <retention@yourdomain.com>`) |
| `APP_URL` | Live URL of your application |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (or dynamically injected by host) |

---

## 4. Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Start development server (runs full-stack Vite + Express)
npm run dev

# 4. Run type check / linting
npm run lint

# 5. Build for production
npm run build
```
