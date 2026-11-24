/**
 * Churnveda Firebase Cloud Object Storage Service
 *
 * Implements:
 * 1. Private Workspace-Isolated Object Storage on Firebase Cloud Storage (`firebase-admin/storage`)
 *    with logical prefixes for imports, exports, reports, and user uploads.
 * 2. Strict MIME Type, Extension, and File Size Validation.
 * 3. Prevention of Executable & Script Uploads (.exe, .sh, .bat, .php, .js, etc.).
 * 4. Workspace-Isolated Object Keys: `{bucketId}/{workspaceId}/{timestamp}_{fileName}`.
 * 5. Secure Time-Limited Signed URLs (GCS V4 Signed URLs with HMAC-verified streaming fallback).
 * 6. Local disk fallback (`data/storage/`) only when Firebase Storage IAM/bucket is not yet reachable.
 * 7. Account Deletion & Retention Cleanup (deleting all workspace objects).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getStorage } from 'firebase-admin/storage';
import { getFirebaseAdminApp, STORAGE_BUCKET, checkAdcAdminIamAccess } from './firebaseBackend.ts';

// Allowed logical storage categories and their strict MIME type whitelist
export const STORAGE_BUCKET_CONFIG = {
  'customer-imports': {
    aliases: ['customer-imports', 'customer_imports'],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ['text/csv', 'application/vnd.ms-excel', 'application/pdf', 'text/plain'],
    allowedExtensions: ['.csv', '.pdf', '.txt']
  },
  'customer-exports': {
    aliases: ['customer-exports', 'workspace_exports'],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ['text/csv', 'application/json'],
    allowedExtensions: ['.csv', '.json']
  },
  'generated-reports': {
    aliases: ['generated-reports', 'retention_reports'],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ['application/pdf', 'application/json', 'text/plain'],
    allowedExtensions: ['.pdf', '.json', '.txt']
  },
  'user-uploads': {
    aliases: ['user-uploads'],
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/pdf'],
    allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.csv', '.pdf']
  }
} as const;

export type StorageBucketId = keyof typeof STORAGE_BUCKET_CONFIG;

// Prohibited extensions that must never be uploaded
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.com', '.vbs', '.msi', '.bin',
  '.php', '.phtml', '.asp', '.aspx', '.jsp', '.jspx', '.cgi', '.pl',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.jar', '.war'
]);

const LOCAL_STORAGE_ROOT = path.resolve(process.cwd(), 'data', 'storage');
const EPHEMERAL_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

let cachedStorageAvailable: boolean | null = null;
let cachedStorageCheckedAt = 0;

function getSigningSecret(): string {
  return (
    process.env.STORAGE_SIGNING_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    EPHEMERAL_SIGNING_SECRET
  );
}

function getFirebaseStorageBucket() {
  const app = getFirebaseAdminApp();
  return getStorage(app).bucket(STORAGE_BUCKET);
}

export function sanitizeWorkspaceSegment(workspaceId: string): string {
  return String(workspaceId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Validates a file's name, size, MIME type, and extension for security
 */
export function validateStorageFile(
  bucketId: StorageBucketId,
  fileName: string,
  fileSize: number,
  mimeType: string
): { valid: boolean; error?: string } {
  const config = STORAGE_BUCKET_CONFIG[bucketId];
  if (!config) {
    return { valid: false, error: `Invalid storage category: "${bucketId}".` };
  }

  if (fileSize <= 0) {
    return { valid: false, error: 'File payload cannot be empty.' };
  }

  if (fileSize > config.maxSizeBytes) {
    const maxMb = Math.round(config.maxSizeBytes / (1024 * 1024));
    return { valid: false, error: `File size exceeds the ${maxMb} MB limit.` };
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!ext || DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext || 'unknown'}" is prohibited for security.` };
  }

  if (!(config.allowedExtensions as readonly string[]).includes(ext)) {
    return {
      valid: false,
      error: `Extension "${ext}" is not permitted for ${bucketId}. Allowed: ${config.allowedExtensions.join(', ')}.`
    };
  }

  const normalizedMime = (mimeType || '').toLowerCase().split(';')[0].trim();
  const isAllowedMime = config.allowedMimeTypes.some(
    allowed => allowed === normalizedMime || (allowed === 'text/plain' && normalizedMime.startsWith('text/'))
  );

  if (!isAllowedMime && normalizedMime) {
    return {
      valid: false,
      error: `MIME type "${normalizedMime}" is not permitted for ${bucketId}.`
    };
  }

  return { valid: true };
}

/**
 * Sanitizes a file name to prevent directory traversal or malicious characters
 */
export function sanitizeStorageFileName(rawName: string): string {
  const base = path.basename(rawName).trim();
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || `file_${Date.now()}`;
}

/**
 * Constructs the canonical workspace-isolated object path: `{bucketId}/{workspaceId}/{timestamp}_{fileName}`
 */
export function buildWorkspaceStoragePath(bucketId: StorageBucketId, workspaceId: string, fileName: string): string {
  const cleanWorkspace = sanitizeWorkspaceSegment(workspaceId);
  const cleanFileName = sanitizeStorageFileName(fileName);
  return `${bucketId}/${cleanWorkspace}/${Date.now()}_${cleanFileName}`;
}

/**
 * Normalizes and strictly validates that a requested path belongs to the authenticated workspace
 */
function resolveAuthorizedObjectKey(
  bucketId: StorageBucketId,
  workspaceId: string,
  rawStoragePath: string
): { ok: boolean; objectKey?: string; error?: string } {
  const cleanWs = sanitizeWorkspaceSegment(workspaceId);
  if (!cleanWs) {
    return { ok: false, error: 'Invalid workspace context.' };
  }

  const normalized = String(rawStoragePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..') || normalized.includes('\0')) {
    return { ok: false, error: 'Invalid storage path.' };
  }

  const expectedPrefix = `${bucketId}/${cleanWs}/`;
  if (normalized.startsWith(expectedPrefix)) {
    return { ok: true, objectKey: normalized };
  }

  if (normalized.startsWith(`${cleanWs}/`)) {
    return { ok: true, objectKey: `${bucketId}/${normalized}` };
  }

  return { ok: false, error: 'Unauthorized: Cannot access files outside of your workspace.' };
}

function writeLocalFallbackFile(objectKey: string, buffer: Buffer): string {
  const targetPath = path.resolve(LOCAL_STORAGE_ROOT, objectKey);
  if (!targetPath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid local storage path');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function readLocalFallbackFile(objectKey: string): Buffer | null {
  const targetPath = path.resolve(LOCAL_STORAGE_ROOT, objectKey);
  if (!targetPath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) return null;
  if (!fs.existsSync(targetPath)) return null;
  return fs.readFileSync(targetPath);
}

function signFallbackDownloadToken(params: {
  bucketId: StorageBucketId;
  workspaceId: string;
  objectKey: string;
  expiresAtMs: number;
}): string {
  const payload = `${params.bucketId}|${params.workspaceId}|${params.objectKey}|${params.expiresAtMs}`;
  return crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
}

export function verifySignedStorageDownloadToken(params: {
  bucketId: StorageBucketId;
  workspaceId: string;
  objectKey: string;
  expiresAtMs: number;
  signature: string;
}): boolean {
  if (!params.signature || !Number.isFinite(params.expiresAtMs) || Date.now() > params.expiresAtMs) {
    return false;
  }
  const expected = signFallbackDownloadToken({
    bucketId: params.bucketId,
    workspaceId: params.workspaceId,
    objectKey: params.objectKey,
    expiresAtMs: params.expiresAtMs
  });
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(params.signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Uploads a file to Firebase Cloud Storage with strict workspace isolation
 */
export async function uploadToWorkspaceStorage(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  fileName: string;
  data: Buffer | string;
  mimeType: string;
}): Promise<{
  success: boolean;
  path?: string;
  bucket?: string;
  storageBackend?: 'firebase' | 'local-fallback';
  sizeBytes?: number;
  error?: string;
}> {
  const { workspaceId, bucketId, fileName, data, mimeType } = options;

  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const validation = validateStorageFile(bucketId, fileName, buffer.length, mimeType);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const objectKey = buildWorkspaceStoragePath(bucketId, workspaceId, fileName);

  try {
    const bucket = getFirebaseStorageBucket();
    const file = bucket.file(objectKey);
    await file.save(buffer, {
      resumable: false,
      contentType: mimeType || 'application/octet-stream',
      metadata: {
        metadata: {
          workspaceId: sanitizeWorkspaceSegment(workspaceId),
          category: bucketId,
          originalFileName: sanitizeStorageFileName(fileName)
        }
      }
    });
    cachedStorageAvailable = true;
    cachedStorageCheckedAt = Date.now();

    return {
      success: true,
      path: objectKey,
      bucket: STORAGE_BUCKET,
      storageBackend: 'firebase',
      sizeBytes: buffer.length
    };
  } catch (err: any) {
    cachedStorageAvailable = false;
    cachedStorageCheckedAt = Date.now();
    console.warn(`[Churnveda Storage Notice] Firebase Storage upload fell back to local storage (${err?.message || 'unavailable'}).`);

    try {
      writeLocalFallbackFile(objectKey, buffer);
      return {
        success: true,
        path: objectKey,
        bucket: 'local-fallback',
        storageBackend: 'local-fallback',
        sizeBytes: buffer.length
      };
    } catch (localErr: any) {
      return { success: false, error: localErr?.message || err?.message || 'Storage upload failed' };
    }
  }
}

export interface StoredWorkspaceObject {
  path: string;
  name: string;
  bucketId: StorageBucketId;
  sizeBytes: number;
  contentType: string;
  updatedAt: string;
  storageBackend: 'firebase' | 'local-fallback';
}

/**
 * Lists files in Firebase Cloud Storage (plus any local fallback files) strictly scoped to workspaceId
 */
export async function listWorkspaceStorageFiles(
  workspaceId: string,
  bucketFilter?: StorageBucketId
): Promise<{ files: StoredWorkspaceObject[]; storageBackend: 'firebase' | 'local-fallback' }> {
  const cleanWs = sanitizeWorkspaceSegment(workspaceId);
  if (!cleanWs) return { files: [], storageBackend: 'local-fallback' };

  const targetBuckets: StorageBucketId[] = bucketFilter
    ? [bucketFilter]
    : (Object.keys(STORAGE_BUCKET_CONFIG) as StorageBucketId[]);

  const results: StoredWorkspaceObject[] = [];
  const seenPaths = new Set<string>();
  let firebaseLive = false;

  try {
    const bucket = getFirebaseStorageBucket();
    for (const bId of targetBuckets) {
      const prefix = `${bId}/${cleanWs}/`;
      const [files] = await bucket.getFiles({ prefix, maxResults: 200 });
      firebaseLive = true;
      for (const f of files) {
        const [meta] = await f.getMetadata().catch(() => [{} as any]);
        seenPaths.add(f.name);
        results.push({
          path: f.name,
          name: path.basename(f.name),
          bucketId: bId,
          sizeBytes: Number(meta?.size || 0),
          contentType: String(meta?.contentType || 'application/octet-stream'),
          updatedAt: String(meta?.updated || meta?.timeCreated || new Date().toISOString()),
          storageBackend: 'firebase'
        });
      }
    }
    cachedStorageAvailable = true;
    cachedStorageCheckedAt = Date.now();
  } catch {
    firebaseLive = false;
  }

  // Include local fallback files if present
  for (const bId of targetBuckets) {
    const localDir = path.resolve(LOCAL_STORAGE_ROOT, bId, cleanWs);
    if (!localDir.startsWith(LOCAL_STORAGE_ROOT + path.sep) || !fs.existsSync(localDir)) continue;
    for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const objKey = `${bId}/${cleanWs}/${entry.name}`;
      if (seenPaths.has(objKey)) continue;
      const stat = fs.statSync(path.join(localDir, entry.name));
      results.push({
        path: objKey,
        name: entry.name,
        bucketId: bId,
        sizeBytes: stat.size,
        contentType: 'application/octet-stream',
        updatedAt: stat.mtime.toISOString(),
        storageBackend: 'local-fallback'
      });
    }
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    files: results,
    storageBackend: firebaseLive ? 'firebase' : 'local-fallback'
  };
}

/**
 * Generates a secure, short-lived signed download URL for a private workspace object
 */
export async function createSignedDownloadUrl(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  storagePath: string;
  expiresInSeconds?: number;
}): Promise<{ success: boolean; signedUrl?: string; storageBackend?: 'firebase' | 'local-fallback'; error?: string }> {
  const { workspaceId, bucketId, storagePath, expiresInSeconds = 900 } = options;

  if (!STORAGE_BUCKET_CONFIG[bucketId]) {
    return { success: false, error: `Invalid storage category: "${bucketId}".` };
  }

  const resolved = resolveAuthorizedObjectKey(bucketId, workspaceId, storagePath);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const ttlSec = Math.min(3600, Math.max(60, expiresInSeconds));
  const expiresAtMs = Date.now() + ttlSec * 1000;
  const cleanWs = sanitizeWorkspaceSegment(workspaceId);

  try {
    const bucket = getFirebaseStorageBucket();
    const file = bucket.file(resolved.objectKey);
    const [exists] = await file.exists();
    if (exists) {
      try {
        const [signedUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: expiresAtMs
        });
        return { success: true, signedUrl, storageBackend: 'firebase' };
      } catch {
        // ADC without signBlob permission: fall back to HMAC-signed server download stream
        const sig = signFallbackDownloadToken({
          bucketId,
          workspaceId: cleanWs,
          objectKey: resolved.objectKey,
          expiresAtMs
        });
        const signedUrl = `/api/storage/download?bucket=${encodeURIComponent(bucketId)}&path=${encodeURIComponent(resolved.objectKey)}&ws=${encodeURIComponent(cleanWs)}&exp=${expiresAtMs}&sig=${sig}`;
        return { success: true, signedUrl, storageBackend: 'firebase' };
      }
    }
  } catch {
    // Fall through to local fallback check
  }

  const localBuf = readLocalFallbackFile(resolved.objectKey);
  if (localBuf) {
    const sig = signFallbackDownloadToken({
      bucketId,
      workspaceId: cleanWs,
      objectKey: resolved.objectKey,
      expiresAtMs
    });
    const signedUrl = `/api/storage/download?bucket=${encodeURIComponent(bucketId)}&path=${encodeURIComponent(resolved.objectKey)}&ws=${encodeURIComponent(cleanWs)}&exp=${expiresAtMs}&sig=${sig}`;
    return { success: true, signedUrl, storageBackend: 'local-fallback' };
  }

  return { success: false, error: 'Requested file was not found in workspace storage.' };
}

/**
 * Reads an authorized workspace object from Firebase Cloud Storage or local fallback
 */
export async function readWorkspaceStorageFile(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  storagePath: string;
}): Promise<{ success: boolean; buffer?: Buffer; contentType?: string; fileName?: string; error?: string }> {
  const { workspaceId, bucketId, storagePath } = options;
  if (!STORAGE_BUCKET_CONFIG[bucketId]) {
    return { success: false, error: 'Invalid storage category.' };
  }

  const resolved = resolveAuthorizedObjectKey(bucketId, workspaceId, storagePath);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  try {
    const bucket = getFirebaseStorageBucket();
    const file = bucket.file(resolved.objectKey);
    const [exists] = await file.exists();
    if (exists) {
      const [meta] = await file.getMetadata().catch(() => [{} as any]);
      const [buffer] = await file.download();
      return {
        success: true,
        buffer,
        contentType: String(meta?.contentType || 'application/octet-stream'),
        fileName: sanitizeStorageFileName(path.basename(resolved.objectKey))
      };
    }
  } catch {
    // Check local fallback
  }

  const localBuf = readLocalFallbackFile(resolved.objectKey);
  if (localBuf) {
    return {
      success: true,
      buffer: localBuf,
      contentType: 'application/octet-stream',
      fileName: sanitizeStorageFileName(path.basename(resolved.objectKey))
    };
  }

  return { success: false, error: 'File not found.' };
}

/**
 * Deletes a single file from workspace storage
 */
export async function deleteWorkspaceStorageFile(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  storagePath: string;
}): Promise<{ success: boolean; error?: string }> {
  const { workspaceId, bucketId, storagePath } = options;
  if (!STORAGE_BUCKET_CONFIG[bucketId]) {
    return { success: false, error: 'Invalid storage category.' };
  }
  const resolved = resolveAuthorizedObjectKey(bucketId, workspaceId, storagePath);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  let deletedAny = false;
  try {
    const bucket = getFirebaseStorageBucket();
    const file = bucket.file(resolved.objectKey);
    const [exists] = await file.exists();
    if (exists) {
      await file.delete({ ignoreNotFound: true });
      deletedAny = true;
    }
  } catch {
    // Continue to local cleanup
  }

  const localPath = path.resolve(LOCAL_STORAGE_ROOT, resolved.objectKey);
  if (localPath.startsWith(LOCAL_STORAGE_ROOT + path.sep) && fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
    deletedAny = true;
  }

  return deletedAny ? { success: true } : { success: false, error: 'File not found.' };
}

/**
 * Deletes all files in all categories for a specific workspace (Used in Account Deletion)
 */
export async function deleteWorkspaceStorageFiles(workspaceId: string): Promise<{ deletedCount: number }> {
  const cleanWs = sanitizeWorkspaceSegment(workspaceId);
  if (!cleanWs) return { deletedCount: 0 };

  let totalDeleted = 0;

  try {
    const bucket = getFirebaseStorageBucket();
    for (const bucketKey of Object.keys(STORAGE_BUCKET_CONFIG) as StorageBucketId[]) {
      const prefix = `${bucketKey}/${cleanWs}/`;
      try {
        const [files] = await bucket.getFiles({ prefix });
        if (files.length > 0) {
          await Promise.allSettled(files.map(f => f.delete({ ignoreNotFound: true })));
          totalDeleted += files.length;
        }
      } catch {
        // Continue cleanup across other prefixes
      }
    }
  } catch {
    // Fallback to local cleanup
  }

  for (const bucketKey of Object.keys(STORAGE_BUCKET_CONFIG) as StorageBucketId[]) {
    const localWsDir = path.resolve(LOCAL_STORAGE_ROOT, bucketKey, cleanWs);
    if (localWsDir.startsWith(LOCAL_STORAGE_ROOT + path.sep) && fs.existsSync(localWsDir)) {
      const files = fs.readdirSync(localWsDir);
      fs.rmSync(localWsDir, { recursive: true, force: true });
      totalDeleted += files.length;
    }
  }

  return { deletedCount: totalDeleted };
}

/**
 * Probes Firebase Admin SDK & Firebase Cloud Storage readiness on startup
 */
export async function ensureStorageBuckets(): Promise<{
  firebaseAdminFirestoreReady: boolean;
  firebaseCloudStorageReady: boolean;
  bucket: string;
}> {
  const firestoreReady = await checkAdcAdminIamAccess(true).catch(() => false);
  let storageReady = false;

  try {
    const bucket = getFirebaseStorageBucket();
    const [exists] = await bucket.exists();
    storageReady = Boolean(exists);
    cachedStorageAvailable = storageReady;
    cachedStorageCheckedAt = Date.now();
    if (storageReady) {
      console.log(`[Churnveda Storage] Connected to Firebase Cloud Storage bucket: ${STORAGE_BUCKET}`);
    } else {
      console.warn(`[Churnveda Storage] Firebase Cloud Storage bucket "${STORAGE_BUCKET}" not found yet. Enable Storage in Firebase Console to activate cloud uploads.`);
    }
  } catch (err: any) {
    cachedStorageAvailable = false;
    cachedStorageCheckedAt = Date.now();
    console.warn(`[Churnveda Storage] Firebase Cloud Storage awaiting IAM permissions (${err?.message || 'permission check pending'}). Local fallback ready.`);
  }

  return {
    firebaseAdminFirestoreReady: firestoreReady,
    firebaseCloudStorageReady: storageReady,
    bucket: STORAGE_BUCKET
  };
}

export function getStorageStatusSnapshot() {
  return {
    provider: 'firebase-cloud-storage',
    bucket: STORAGE_BUCKET,
    cloudConnected: cachedStorageAvailable === true,
    lastCheckedAt: cachedStorageCheckedAt ? new Date(cachedStorageCheckedAt).toISOString() : null
  };
}
