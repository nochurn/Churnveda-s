# Security Summary

**Reviewed Files**: 36
**Issues Resolved**: 8

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Production Bundle & Source Map Exposure | `server.ts` | 10319 | `serveProdStaticAndSpa()` served the entire `dist/` folder over HTTP, exposing compiled server code (`dist/server.cjs`, `dist/migrate.cjs`) and `.map` source maps in production. | Critical | Fixed | Added a pre-static guard returning `404` for `.cjs`, `.map`, `/server`, and `/migrate` before mounting `express.static(distPath)`. |
| Cross-Tenant Workspace IDOR Fallback | `server.ts` | 1317 | `resolveAuthorizedWorkspace()` warned on an unauthorized `x-workspace-id` or `?workspaceId=` and silently returned the caller's workspace (`200 OK`) instead of rejecting the cross-tenant request. | High | Fixed | Threw `ForbiddenWorkspaceError` (`403 FORBIDDEN`) for unauthorized workspace overrides and propagated `403` across `requireAuth` and billing/storage/cron handlers. |
| Cross-Account Client State Bleed | `src/services/aiEmployeeService.ts` | 24 | `AiEmployeeService` stored drafts, messages, briefs, and Top 5 lists in global un-scoped `localStorage` keys and did not clear them on logout or account switch. | High | Fixed | Scoped `aiEmployeeService` storage keys per `workspaceId` (`setWorkspaceContext`) and cleared all in-memory state on logout (`clearWorkspaceState`). |
| URL Query Token Leakage | `server.ts` | 1110 | `resolveAuthUser()`, `getAuthUser()`, and `/api/auth/logout` accepted `?token=` in query strings, risking session token leakage in URLs, server logs, and `Referer` headers. | High | Fixed | Removed `req.query.token` extraction across `resolveAuthUser()`, `getAuthUser()`, and `/api/auth/logout`; tokens are accepted only via cookies or `Authorization` / `x-session-token` headers. |
| Weak PRNG Backup Codes | `src/services/authService.ts` | 46 | `generateBackupCodes()` used `Math.random()` to generate 2FA recovery codes. | Medium | Fixed | Replaced `Math.random()` with Web Crypto CSPRNG (`crypto.getRandomValues`). |
| Hardcoded Password Reset Token Fallback | `src/components/auth/ResetPasswordView.tsx` | 22 | `ResetPasswordView` and `src/App.tsx` defaulted empty reset tokens to `'demo-reset-token'` / `'demo-token-123'`. | Medium | Fixed | Removed static fallback token defaults and validated a non-empty reset token before submission. |
| Synthetic PDF Customers & Invalid CSV Coercion | `server.ts` | 3050 | Empty/unreadable PDFs fabricated 4 fake customer rows, and CSV import coerced missing/invalid emails, negative MRRs, and invalid dates into synthetic `@example.com` records. | High | Fixed | Removed synthetic PDF fallback rows (returning `400` when no records exist) and enforced strict row-level email/MRR/date validation into `invalidRows`. |
| Billing Trial FK Crash, Replay Expiry Extension & Queue Duplication | `server.ts` & `server/outboundQueue.ts` | 6209, 6292, 337 | Guest trial orders violated the PostgreSQL `workspaces` FK, idempotent trial verification recalculated a fresh 14-day expiry on replay, and already-`QUEUED` message IDs could be re-queued without duplicate suppression. | High | Fixed | Persisted guest checkout workspaces prior to `trial_verifications`, returned stored `trial_ends_at` on `already_verified` replays, and suppressed duplicate enqueues for `QUEUED` items. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Secrets | `server.ts`, `dist/assets/` | Private keys (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `GEMINI_API_KEY`, DB credentials) reside exclusively in `process.env`; bundle scan of `dist/assets/` and `dist/index.html` confirmed zero private secrets. |
| SQL & NoSQL Injection | `server/db.ts`, `firestore.rules` | PostgreSQL and SQLite queries use parameterized bindings (`$1`, `?`), and `firestore.rules` enforces schema allowlists (`hasOnly`), server timestamps (`request.time`), and tenant ownership. |
| Payment & Webhook Integrity | `server.ts` | Order amounts are computed server-side from `server/billingPlans.ts` (ignoring client prices), payment/webhook signatures use timing-safe HMAC-SHA256 verification (`crypto.timingSafeEqual`), and webhook event IDs are deduplicated in PostgreSQL/SQLite. |
| CSV Export Formula Injection | `server.ts` | `sanitizeCsvValue()` prefixes leading `=`, `+`, `-`, `@`, tab, and carriage return characters with a single quote before RFC-4180 quoting. |
| Dependency Security | `bun.lock` | `bun audit` identified 2 transitive advisories in `@grpc/grpc-js` (`1.9.16`, `1.14.7`) pulled by `firebase` / `firebase-admin`; tracked as low-exposure build/SDK follow-up. |

## PoC Verification

### Production Server Bundle & Source Map Block (`serveProdStaticAndSpa`)

#### Summary
| Field | Value |
|---|---|
| Issue Type | Information Disclosure (Compiled Server Bundle & Source Maps) |
| Impact | Critical |
| Affected File | `server.ts:10319` |
| Test Scenario | `GET /server.cjs` and `GET /server.cjs.map` when `NODE_ENV=production` |

#### How It Was Fixed
Added a pre-static Express middleware inside `serveProdStaticAndSpa()` that intercepts requests ending in `.cjs` or `.map` (as well as `/server` and `/migrate`) and immediately returns HTTP `404 Not Found` before `express.static(distPath)` runs.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Client sends `GET /server.cjs.map` in production mode (`NODE_ENV=production`). | Enters `serveProdStaticAndSpa()` middleware chain. |
| 2 | Guard checks `p.endsWith('.cjs') \|\| p.endsWith('.map') \|\| p === '/server' \|\| p === '/migrate'`. | Condition evaluates `true`. |
| 3 | Middleware returns `res.status(404).type('text/plain').send('Not Found')`. | `express.static(distPath)` is never reached; bundle/source map is never served. |

---

### Cross-Tenant Workspace IDOR Enforcement (`403 FORBIDDEN`)

#### Summary
| Field | Value |
|---|---|
| Issue Type | Broken Access Control / Cross-Tenant IDOR |
| Impact | High |
| Affected File | `server.ts:1312` |
| Test Scenario | Authenticated User A requests `GET /api/customers` with `x-workspace-id: <workspaceB>` and `GET /api/customers?workspaceId=<workspaceB>` |

#### How It Was Fixed
Updated `resolveAuthorizedWorkspace()` to throw `ForbiddenWorkspaceError` (`status = 403`) whenever a caller requests a foreign workspace ID without verified membership or ownership, and updated `requireAuth` and billing/storage/cron handlers to return `403 FORBIDDEN`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | User A authenticates and sends `GET /api/customers` with header `x-workspace-id: <workspaceB>`. | `requireAuth` resolves `user = Alice` (`server.ts:1346`). |
| 2 | `resolveAuthorizedWorkspace(req, user)` compares `requested !== user.workspace_id`, checks `db.workspaceMembers.isMember(requested, user.id)` (`false`) and `ws.owner_id === user.id` (`false`). | Throws `ForbiddenWorkspaceError` (`403`). |
| 3 | `requireAuth` catch block matches `err instanceof ForbiddenWorkspaceError` and returns `res.status(403).json(...)`. | Verified passing in `tests/churnveda-audit.test.ts` (both header and query variants return HTTP `403`). |

---

### Trial Verification Idempotency & Webhook Signature Enforcement

#### Summary
| Field | Value |
|---|---|
| Issue Type | Billing Replay / State Integrity |
| Impact | High |
| Affected File | `server.ts:6292`, `server.ts:7943` |
| Test Scenario | Replay `POST /api/billing/verify-trial-payment` after initial verification; send unsigned/forged/replayed events to `POST /api/razorpay/webhook` |

#### How It Was Fixed
Modified the `verification.status === 'verified'` branch in `/api/billing/verify-trial-payment` to return the persisted subscription `trial_ends_at` timestamp rather than computing `Date.now() + 14 days`, while `/api/razorpay/webhook` rejects missing signatures (`401`), invalid HMACs (`400`), and duplicate event IDs via `db.webhookEvents.recordIfNew`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | User A completes `POST /api/billing/verify-trial-payment` with valid HMAC signature, then replays the identical payload. | Second request hits `verification.status === 'verified'` and reads `existingSub.trial_ends_at`. |
| 2 | Response returns `already_verified: true` with the original `trial_ends_at` timestamp. | Verified exact timestamp equality in `tests/churnveda-audit.test.ts`. |
| 3 | `POST /api/razorpay/webhook` receives unsigned (`401`), forged HMAC (`400`), valid `subscription.cancelled` (`200`), and duplicate `evt_audit_cancel_001` (`200 Event already processed`). | Verified in `tests/churnveda-audit.test.ts`; User A billing state transitions once to `cancelled`. |
