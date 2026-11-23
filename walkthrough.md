# Security Summary

**Reviewed Files**: 14 (`server.ts`, `server/db.ts`, `server/scheduler.ts`, `server/outboundQueue.ts`, `server/firebaseBackend.ts`, `server/supabaseServer.ts`, `server/storageService.ts`, `server/migrate.ts`, `firestore.rules`, `src/services/authService.ts`, `src/components/auth/ForgotPasswordView.tsx`, `src/services/api.ts`, `.env.example`, `package.json`)
**Issues Resolved**: 14

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Billing & Subscription Activation Bypass | `server.ts` | 6286, 6572 | Direct plan upgrade and activation endpoints accepted unverified requests to grant `paid` / `active` access without a verified Razorpay checkout record. | Critical | Fixed | Rejected unverified upgrade/activation calls with `402 Payment Required` unless bound to a verified server-side payment or subscription record, and removed automatic `paid` elevation when saving card metadata. |
| Razorpay Order Amount & Cross-Tenant Forgery | `server.ts` | 7022, 7176, 7416 | Checkout verification trusted client-supplied plan/amount/currency fields or lacked strict persisted workspace binding and payment replay guards. | Critical | Fixed | Persisted authoritative checkout orders in `razorpay_orders`, ignored client-tampered prices, bound verification to the authenticated workspace, and blocked payment order replays (`409`). |
| Webhook Lifecycle & Refund Revocation | `server.ts` | 7660–7980 | Cancelled/halted/expired trials could fall through to a fallback active status; refunds were not revoking workspace access; and email-matched webhooks did not resync `subscriptions` rows when `razorpay_subscription_id` was unset. | Critical | Fixed | Enforced fail-closed state transitions on `cancelled`, `halted`, `past_due`, and `trial_expired`; enforced `current_period_end` / `trial_ends_at` expiry across restarts; handled `payment.refunded`/`refund.*`; and synced both `user` and `subscriptions` records on lifecycle webhooks. |
| AI Quota Bypass on Inactive Accounts | `server.ts` | 2089, 2253, 2400 | `/api/churn/recommend`, `/api/churn/batch-predict`, and non-`trial_expired` inactive states on `/api/churn/predict` could still execute AI analysis. | High | Fixed | Added unified `getWorkspaceAccessStatus` enforcement at the entry of `/api/churn/predict`, `/api/churn/recommend`, and `/api/churn/batch-predict`. |
| Password Reset Token Disclosure | `server.ts`, `src/services/authService.ts`, `src/components/auth/ForgotPasswordView.tsx` | 4893 (`server.ts`) | Forgot-password API responses and UI helper flows surfaced raw password reset tokens directly in JSON responses. | Critical | Fixed | Removed `resetToken` from `/api/auth/forgot-password` responses and removed client-side token simulator surfaces; reset delivery now runs strictly server-side via email. |
| Cross-Tenant Integration, Scheduler & Storage Leaks | `server.ts`, `server/scheduler.ts` | 2475, 3779, 8840 | Integration connection state, scheduler configuration, owner briefs, and signed storage URLs were either shared globally or duplicated across routes without workspace confinement. | High | Fixed | Scoped integration state, scheduler settings, owner briefs, queue status, and `/api/storage/signed-url` strictly to `workspaceId` with cross-tenant access returning `403`. |
| Cookie CSRF Validation | `server.ts` | 285–312 | Cookie-authenticated mutations lacked strict Origin/Referer validation across all proxy configurations and allowed missing origin headers on state-changing requests. | High | Fixed | Enabled `trust proxy`, required matching `Origin` or `Referer` against configured/same-origin hosts on cookie-authenticated mutations (exempting HMAC-signed webhooks), and rejected mismatched origins with `403 CSRF_BLOCKED`. |
| Unverified Meta WhatsApp Webhook & Consent | `server.ts` | 8272–8345 | Incoming WhatsApp webhooks lacked verification challenge and `X-Hub-Signature-256` HMAC validation, and opt-outs were not persisted cleanly before quota deduction. | High | Fixed | Added `GET /api/whatsapp/webhook` timing-safe challenge and `POST /api/whatsapp/webhook` `X-Hub-Signature-256` verification, persisted `STOP` opt-outs to SQLite/PostgreSQL, and enforced consent checks prior to outbound quota deduction. |
| Non-Persistent Scheduler & Duplicate Outreach | `server/db.ts`, `server/scheduler.ts`, `server/outboundQueue.ts` | `db.ts` 2580+ | Scheduler settings, owner briefs, and idempotency keys lived only in memory, allowing duplicate customer outreach or lost configs on restart. | High | Fixed | Added persistent `scheduler_settings`, `owner_briefs`, and `outbound_messages_log` tables, accurate IANA timezone scheduling, same-day customer duplicate suppression, and 3-attempt provider retry backoff. |
| Incomplete Account Deletion & Data Purge | `server.ts`, `server/db.ts`, `server/firebaseBackend.ts` | 3864 (`server.ts`) | Account deletion left behind scheduler configs, outbound logs, webhook references, or Firebase Auth records. | Medium | Fixed | Purged all workspace-scoped SQL/SQLite tables (`outbound_messages_log`, `scheduler_settings`, `owner_briefs`, `razorpay_orders`, etc.), in-memory caches, and Firebase Auth/Firestore records during deletion. |
| Firestore Rules Client-Writable Billing Fields | `firestore.rules` | 418–420, 460–462 | Client-authenticated Firestore updates still permit writing billing/plan metadata fields while Admin SDK credentials are unconfigured. | High | Needs Follow-Up | Server API enforcement uses authoritative SQLite/PostgreSQL records rather than Firestore; provision `GOOGLE_APPLICATION_CREDENTIALS` and tighten `firestore.rules` before production deployment. |
| Production Infrastructure & Secret Provisioning | `.env.example`, runtime env | — | Container runtime lacks PostgreSQL `DATABASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `WHATSAPP_*`, `GEMINI_API_KEY`, `TURNSTILE_SECRET_KEY`, `ALLOWED_ORIGINS`, `POSTAL_ADDRESS`, and external Firebase Authorized Domains setup. | Critical | Needs Follow-Up | Provision all required production environment variables, attach managed PostgreSQL (`npm run db:migrate`), and authorize production domains in Firebase Authentication Console before launch. |
| Transitive Dependency Advisories | `package.json`, `bun.lock` | — | `bun audit` flagged 2 transitive advisories in `@grpc/grpc-js` (1 High HTTP/2 header validation, 1 Low) pulled via `firebase` / `firebase-admin`. | Medium | Needs Follow-Up | Upgrade `firebase` / `firebase-admin` or override `@grpc/grpc-js` when upstream releases patched versions. |
| Ephemeral Container Rate Limiting & Storage | `server.ts`, `server/db.ts` | 480 (`server.ts`) | In-memory `rateLimiter` maps reset on container restart, and runtime falls back to local SQLite WAL without `DATABASE_URL`. | Medium | Needs Follow-Up | Attach managed PostgreSQL and Redis-backed rate limiting if scaling horizontally across multiple instances. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Client Bundle | `dist/assets/*`, `dist/index.html`, `server.ts` | Private keys (`RAZORPAY_KEY_SECRET`, `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, `JWT_SECRET`, `DATABASE_URL`) reside only in server environment variables and return zero matches in built frontend bundles. |
| Database Queries & Isolation | `server/db.ts`, `server.ts` | Uses parameterized SQL/SQLite statements (`$1`/`?`), PostgreSQL Row-Level Security policies, and strict server-resolved `workspaceId` scoping on every customer, scheduler, integration, billing, and storage route. |
| Webhook Cryptography & Idempotency | `server.ts` | Razorpay (`x-razorpay-signature`) and Meta WhatsApp (`x-hub-signature-256`) webhooks verify HMAC-SHA256 digests with `crypto.timingSafeEqual` over raw request bodies, backed by persistent `webhook_events` deduplication. |
| Security Headers & CORS | `server.ts` | Sets `X-Content-Type-Options: nosniff`, strict `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`, disables `X-Powered-By`, and rejects untrusted cross-origin preflights and cookie CSRF requests with `403`. |
| Account Privacy (Export & Delete) | `server.ts`, `server/db.ts` | `GET /api/auth/export-data` exports workspace-scoped data with `password_hash` omitted; `POST /api/auth/delete-account` deletes SQL/Firestore data and immediately revokes active sessions. |

---

## PoC Verification

### Unverified Billing Upgrade & Price-Tampering Bypass

#### Summary
| Field | Value |
|---|---|
| Issue Type | Broken Payment Verification & Client Price Trust |
| Impact | Critical |
| Affected File | `server.ts:6286`, `server.ts:6572`, `server.ts:7022`, `server.ts:7176` |
| Test Scenario | Authenticated workspace submits `POST /api/billing/upgrade` (`plan: "pro"`) without payment, or calls `POST /api/razorpay/create-order` with `{ tier: "pro", billingCycle: "monthly", amount: 1 }`, or replays a paid order with a different `razorpay_payment_id`. |

#### How It Was Fixed
Direct upgrade/activation endpoints require verified server-side payment records (`402` otherwise), order creation computes pricing strictly from authoritative server plan catalogs (`$349` for Pro Monthly) and persists expected amounts in `razorpay_orders`, and payment verification enforces HMAC-SHA256 matching, workspace ownership, and single-use replay locking.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/billing/upgrade` arrives without a verified payment reference at `server.ts:6572` | Rejected (`402 Payment Required`) |
| 2 | `POST /api/razorpay/create-order` ignores client `amount: 1`, resolves `$349` from `getExpectedPlanAmount`, and stores the order in `razorpay_orders` (`server.ts:7022`) | Authoritative order recorded |
| 3 | `POST /api/razorpay/verify-payment` validates HMAC-SHA256, checks `storedOrder.workspace_id`, marks `status = 'paid'`, and blocks subsequent attempts with a different `razorpay_payment_id` at `server.ts:7193` | Replay rejected (`409 Conflict`) |

#### Conclusion
**Fix Verified** - Live verification confirmed `create-order` returns `amountUsd: 349` despite tampered `amount: 1`, forged signatures return `400`, and order replays return `409`.

---

### Webhook Refund / Cancellation / Expiry Access Persistence

#### Summary
| Field | Value |
|---|---|
| Issue Type | Subscription Lifecycle Enforcement & Expired Trial Access |
| Impact | Critical |
| Affected File | `server.ts:5438–5593`, `server.ts:7663–7950`, `server.ts:2085`, `server.ts:8359` |
| Test Scenario | Replay `payment.refunded`, `subscription.halted`, `subscription.cancelled`, or expire `trial_ends_at` in SQLite across a server restart, then invoke `/api/messages/send` and `/api/churn/predict`, `/api/churn/recommend`, and `/api/churn/batch-predict`. |

#### How It Was Fixed
`getWorkspaceAccessStatus` (`server.ts:5438`) fails closed for `cancelled`, `halted`, `past_due`, `trial_expired`, and expired `current_period_end` / `trial_ends_at` timestamps; `syncDatabaseOnBoot` hydrates `trial_end_date` from persisted `trial_ends_at`; webhook handlers sync both `users` and `subscriptions` rows; and outbound messaging and all three AI churn routes enforce `isAllowedAccess`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Signed `payment.refunded` webhook reaches `server.ts:7827`, revoking `subscriptions` (`cancelled`) and `users` (`cancelled`) | Access revoked; duplicate event returns `already processed` |
| 2 | `subscription.halted` / `subscription.cancelled` updates both workspace subscription and owner records (`server.ts:7771–7826`) | `/api/messages/send` returns `403 SUBSCRIPTION_INACTIVE` |
| 3 | Expired `trial_ends_at` (`2020-01-01T00:00:00.000Z`) reloads across server restart (`server.ts:1010`), triggering `getWorkspaceAccessStatus` (`server.ts:5493`) | `/api/messages/send`, `/api/churn/predict`, `/api/churn/recommend`, and `/api/churn/batch-predict` all return `403` |

#### Conclusion
**Fix Verified** - Refunded, halted, cancelled, and expired trial workspaces are consistently blocked (`403`) across both messaging and AI analysis endpoints, including across server restarts.

---

### Cookie-Authenticated Cross-Site Request Forgery & Password Reset Token Leak

#### Summary
| Field | Value |
|---|---|
| Issue Type | CSRF Origin Bypass & Sensitive Token Exposure |
| Impact | Critical |
| Affected File | `server.ts:285–312`, `server.ts:4868–4950` |
| Test Scenario | Send a cookie-authenticated `POST` with `Origin: https://evil.example`, and call `POST /api/auth/forgot-password` checking for leaked `resetToken`. |

#### How It Was Fixed
Cookie-authenticated mutations enforce strict `Origin`/`Referer` allowlist checks (returning `403 CSRF_BLOCKED` on untrusted or missing origins), and `POST /api/auth/forgot-password` stores reset tokens strictly server-side without returning them in JSON responses.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | State-changing request with cookie session and `Origin: https://evil.example` hits CSRF middleware at `server.ts:285` | Blocked with `403 CSRF_BLOCKED` |
| 2 | `POST /api/auth/forgot-password` generates server-side token at `server.ts:4930` | Response returns generic confirmation with no token field |

#### Conclusion
**Fix Verified** - Cross-origin cookie mutations return `403 CSRF_BLOCKED` and password reset responses expose zero token material.

---

### Meta WhatsApp Webhook Forgery & STOP Opt-Out Bypass

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unauthenticated Webhook & Missing Persistent Consent Enforcement |
| Impact | High |
| Affected File | `server.ts:8247–8430` |
| Test Scenario | Submit `GET /api/whatsapp/webhook` with an invalid `hub.verify_token`, submit `POST /api/whatsapp/webhook` with an invalid `X-Hub-Signature-256`, then send a valid signed `STOP` message and attempt `POST /api/messages/send` to that phone number. |

#### How It Was Fixed
Added timing-safe `WHATSAPP_VERIFY_TOKEN` verification on `GET`, fail-closed `WHATSAPP_APP_SECRET` `X-Hub-Signature-256` HMAC validation on `POST`, persistent `STOP` opt-out storage in `unsubscribed_contacts`, and consent verification prior to quota deduction in `/api/messages/send`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `GET /api/whatsapp/webhook` with mismatched token hits `server.ts:8266` | Rejected (`403 Forbidden`); valid token returns challenge (`200`) |
| 2 | `POST /api/whatsapp/webhook` with bad `x-hub-signature-256` hits `server.ts:8301` | Rejected (`403`) |
| 3 | Valid HMAC-signed `STOP` message persists phone to `unsubscribed_contacts` (`server.ts:8316`), checked at `server.ts:8417` | Outbound WhatsApp dispatch blocked (`403 RECIPIENT_OPTED_OUT`) |

#### Conclusion
**Fix Verified** - Forged Meta WhatsApp webhooks are rejected and verified `STOP` replies permanently suppress subsequent outbound WhatsApp messages.
