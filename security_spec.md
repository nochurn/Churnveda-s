# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants
1. **User Profile Ownership & Anti-Privilege-Escalation**:
   - `/users/{userId}` documents contain PII (`email`, `fullName`, `companyName`) and must only be readable (`get`) by `userId == request.auth.uid` or `isAdmin()`. No blanket `list` is allowed on `/users`.
   - On creation, non-admin users MUST only create their own profile (`id == userId == request.auth.uid`), MUST have `email_verified == true`, MUST assign least-privileged default `role == 'Viewer'`, and MUST supply server timestamps (`createdAt == request.time`, `updatedAt == request.time`).
   - On update, `id`, `email`, `role` (unless `isAdmin()`), and `createdAt` are immutable, and `affectedKeys()` is strictly partitioned per action.
2. **Workspace Master Gate & Relational Sync**:
   - `/workspaces/{workspaceId}` must have `id == workspaceId` and `ownerId == request.auth.uid` on creation.
   - Workspace subcollections (`/members/{memberId}`, `/customers/{customerId}`, `/importHistory/{importId}`, `/integrations/{integrationId}`, `/alerts/{alertId}`, `/outboundMessages/{messageId}`, `/subscriptions/{subscriptionId}`, `/schedulerSettings/{settingId}`, `/auditLogs/{logId}`) use the Master Gate (`get(/databases/.../workspaces/$(workspaceId))`) to guarantee synchronous loss of access if workspace ownership/membership is revoked.
3. **Strict Anti-Shadow-Field & Size Constraints**:
   - Every entity enforces `keys().hasAll(...) && keys().hasOnly(...)` on write, `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars) on every path parameter and ID field, and explicit `.size()` bounds on every string.
4. **Secure List Queries without O(n) Lookups**:
   - `allow list` rules on workspace subcollections evaluate `resource.data.ownerId == request.auth.uid && resource.data.workspaceId == workspaceId` (or `actorId == request.auth.uid` for auditLogs) directly with zero `get()` or `exists()` calls inside `allow list`.
5. **Terminal State Locking & Immutability**:
   - Once a customer outcome reaches a terminal state (`status == 'churned'` or `outcomeStatus == 'churned'`), non-admin client updates are blocked.
   - `/workspaces/{workspaceId}/auditLogs/{logId}` records are strictly immutable (`allow update, delete: if false`).
   - Once an `outboundMessages` record reaches `SENT`, non-admin updates are blocked.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Access**: Unauthenticated read/write to `/users/uid1`, `/workspaces/ws1`, `/workspaces/ws1/customers/c1`. -> `PERMISSION_DENIED`
2. **Unverified Email Bypass**: Authenticated user with `email_verified == false` attempting to create/update `/users/{uid}` or `/workspaces/{wsId}`. -> `PERMISSION_DENIED`
3. **Self-Assigned Admin Role Escalation**: User creates `/users/{uid}` with `role: 'Admin'` instead of `'Viewer'`, or updates `role` from `'Viewer'` to `'Admin'`. -> `PERMISSION_DENIED`
4. **Ghost / Shadow Field Injection**: Creating/updating a `Customer`, `UserProfile`, `WorkspaceIntegration`, or `WorkspaceSubscription` with an extra undeclared field (`isVerified: true` or `adminOverride: true`). -> `PERMISSION_DENIED`
5. **Identity Spoofing on Workspace/Customer**: Attacker creates `/workspaces/ws_victim` with `ownerId: 'victim_uid'` or `/workspaces/ws_attacker/customers/c1` with `ownerId: 'victim_uid'`. -> `PERMISSION_DENIED`
6. **ID Poisoning / Resource Exhaustion**: Writing to `/workspaces/{200-char-invalid-id!@#}` or injecting a 5KB `name` or `recommendedAction` exceeding schema `maxLength`. -> `PERMISSION_DENIED`
7. **Timestamp Forgery**: Providing a backdated client `Date` or string for `createdAt`/`updatedAt` instead of `request.time`. -> `PERMISSION_DENIED`
8. **Immutable Field Mutation**: Updating `createdAt`, `workspaceId`, `ownerId`, or `id` on an existing `Customer`, `Workspace`, or `WorkspaceAuditLog`. -> `PERMISSION_DENIED`
9. **Orphaned Subcollection Creation**: Creating `/workspaces/nonexistent_ws/customers/c1` or `/workspaces/nonexistent_ws/integrations/razorpay` where parent `/workspaces/nonexistent_ws` does not exist. -> `PERMISSION_DENIED`
10. **Cross-Tenant List Query Scraping**: User A listing `/workspaces/ws_user_b/customers` without `where('ownerId', '==', userA.uid)` or querying User B's workspace. -> `PERMISSION_DENIED`
11. **Terminal State Overwrite**: Non-admin attempting to mutate a customer record whose `status == 'churned'` or an outbound message whose `status == 'SENT'`. -> `PERMISSION_DENIED`
12. **PII Blanket Read / Unscoped User Enumeration**: Non-admin authenticated user calling `get` on `/users/other_uid` or `list` on `/users`. -> `PERMISSION_DENIED`

## 3. Red Team Audit Matrix & Conflict Report
- **Identity Spoofing**: Blocked by `isOwner(userId)`, `incoming().ownerId == request.auth.uid`, and `incoming().actorId == request.auth.uid` checks inside `isValid*` helpers and `allow create`/`update`.
- **State Shortcutting / Terminal State**: Blocked on `Customer` update by `existing().status != 'churned'` and on `OutboundMessage` update by `existing().status != 'SENT'` (with `isAdmin()` override).
- **Resource Poisoning**: Blocked by `isValidId(...)` (`<= 128`, regex) on all path variables & ID fields, plus explicit `.size()` bounds on every string field synchronized with `firebase-blueprint.json`.
- **Shadow Update / Value Poisoning**: Blocked by `data.keys().hasAll(...) && data.keys().hasOnly(...)` in every `isValid*` helper AND `incoming().diff(existing()).affectedKeys().hasOnly(...)` in every action-based `allow update` branch.
- **Email Spoofing**: Admin email check requires `request.auth.token.email_verified == true`.
- **PII Isolation**: `/users/{userId}` forbids `list` completely and restricts `get` to `isOwner(userId) || isAdmin()`.
- **Immutable Audit Logs**: `/workspaces/{workspaceId}/auditLogs/{logId}` forbids `update` and `delete` completely (`allow update, delete: if false`).
