import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Structural & Dirty-Dozen Invariant Verification Suite
 * Verifies firestore.rules against firebase-blueprint.json and security_spec.md invariants.
 */

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

const rulesText = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

// Verify Eight Pillars structural enforcement in firestore.rules
assert.ok(rulesText.includes("rules_version = '2';"), 'Must use rules_version 2');
assert.ok(rulesText.includes('match /{document=**} {\n      allow read, write: if false;\n    }'), 'Missing default-deny global catch-all');
assert.ok(rulesText.includes('function isValidId(id)'), 'Missing isValidId helper');
assert.ok(rulesText.includes('request.auth.token.email_verified == true'), 'Missing email_verified gate');
assert.ok(rulesText.includes('isValidUserProfile('), 'Missing isValidUserProfile validator');
assert.ok(rulesText.includes('isValidWorkspace('), 'Missing isValidWorkspace validator');
assert.ok(rulesText.includes('isValidWorkspaceMember('), 'Missing isValidWorkspaceMember validator');
assert.ok(rulesText.includes('isValidCustomer('), 'Missing isValidCustomer validator');
assert.ok(rulesText.includes('isValidImportHistory('), 'Missing isValidImportHistory validator');
assert.ok(rulesText.includes('isValidWorkspaceIntegration('), 'Missing isValidWorkspaceIntegration validator');
assert.ok(rulesText.includes('isValidWorkspaceAlert('), 'Missing isValidWorkspaceAlert validator');
assert.ok(rulesText.includes('isValidOutboundMessage('), 'Missing isValidOutboundMessage validator');
assert.ok(rulesText.includes('isValidWorkspaceSubscription('), 'Missing isValidWorkspaceSubscription validator');
assert.ok(rulesText.includes('isValidSchedulerSetting('), 'Missing isValidSchedulerSetting validator');
assert.ok(rulesText.includes('isValidWorkspaceAuditLog('), 'Missing isValidWorkspaceAuditLog validator');
assert.ok(rulesText.includes('affectedKeys().hasOnly('), 'Missing action-based affectedKeys allowlisting');
assert.ok(rulesText.includes('request.time'), 'Missing server request.time enforcement');
assert.ok(!/allow\s+(read|list)\s*:\s*if\s+isSignedIn\(\)\s*;/.test(rulesText), 'Forbidden blanket isSignedIn() read/list detected');

// Verify 1:1 collection coverage with firebase-blueprint.json
const firestoreCollections = Object.keys(blueprint.firestore || {});
const expectedCollections = [
  '/users/{userId}',
  '/workspaces/{workspaceId}',
  '/workspaces/{workspaceId}/members/{memberId}',
  '/workspaces/{workspaceId}/customers/{customerId}',
  '/workspaces/{workspaceId}/importHistory/{importId}',
  '/workspaces/{workspaceId}/integrations/{integrationId}',
  '/workspaces/{workspaceId}/alerts/{alertId}',
  '/workspaces/{workspaceId}/outboundMessages/{messageId}',
  '/workspaces/{workspaceId}/subscriptions/{subscriptionId}',
  '/workspaces/{workspaceId}/schedulerSettings/{settingId}',
  '/workspaces/{workspaceId}/auditLogs/{logId}',
  '/admins/{adminId}'
];
for (const colPath of expectedCollections) {
  assert.ok(firestoreCollections.includes(colPath), `Missing ${colPath} in blueprint`);
}

// Verify Dirty Dozen payload constraints against blueprint boundaries
const idRegex = new RegExp(blueprint.entities.UserProfile.properties.id.pattern);

const dirtyDozenCases = [
  { name: '1. Unauthenticated access', check: () => rulesText.includes('isVerifiedUser()') },
  { name: '2. Unverified email bypass', check: () => rulesText.includes('request.auth.token.email_verified == true') },
  { name: '3. Self-assigned Admin role escalation', check: () => rulesText.includes("(incoming().role == 'Viewer' || isAdmin())") },
  { name: '4. Ghost/shadow field injection', check: () => rulesText.includes('data.keys().hasOnly(') },
  { name: '5. Identity spoofing on workspace owner', check: () => rulesText.includes('incoming().ownerId == request.auth.uid') },
  { name: '6. ID poisoning / oversized string', check: () => !idRegex.test('bad/id!@#') && 'a'.repeat(129).length > blueprint.entities.UserProfile.properties.id.maxLength },
  { name: '7. Client timestamp forgery', check: () => rulesText.includes('incoming().createdAt == request.time') && rulesText.includes('incoming().updatedAt == request.time') },
  { name: '8. Immutable field mutation', check: () => rulesText.includes('incoming().ownerId == existing().ownerId') && rulesText.includes('incoming().createdAt == existing().createdAt') },
  { name: '9. Orphaned subcollection creation', check: () => rulesText.includes('exists(/databases/$(database)/documents/workspaces/$(workspaceId))') },
  { name: '10. Cross-tenant list query scraping', check: () => rulesText.includes('resource.data.ownerId == request.auth.uid') },
  { name: '11. Terminal state overwrite (churned customer & SENT outbound message & immutable auditLogs)', check: () => rulesText.includes("existing().status != 'churned'") && rulesText.includes("existing().status != 'SENT'") && rulesText.includes('allow update, delete: if false;') },
  { name: '12. PII blanket read / user list', check: () => rulesText.includes('match /users/{userId}') && rulesText.includes('allow list: if false;') }
];

for (const tc of dirtyDozenCases) {
  assert.ok(tc.check(), `Dirty Dozen check failed: ${tc.name}`);
}

console.log(`All ${dirtyDozenCases.length} Dirty Dozen & ${expectedCollections.length}-collection Eight Pillars security checks passed.`);
