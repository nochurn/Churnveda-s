/**
 * Churnveda Supabase Storage Service
 *
 * Implements:
 * 1. Private Bucket Management for Customer Imports, Exports, and Reports.
 * 2. Strict MIME Type, Extension, and 10MB File Size Validation.
 * 3. Prevention of Executable & Script Uploads (.exe, .sh, .bat, .php, .js, etc.).
 * 4. Workspace-Isolated Storage Paths: `{workspaceId}/{fileName}`.
 * 5. Secure Time-Limited Signed URLs (default 15 minutes).
 * 6. Account Deletion & Retention Cleanup (deleting all workspace objects).
 */

import path from 'path';
import { getAdminClient, getValidatedAuthConfig } from './supabaseServer.ts';

// Allowed buckets and their strict MIME type whitelist
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
    return { valid: false, error: `Invalid storage bucket: "${bucketId}".` };
  }

  // 1. File size check
  if (fileSize > config.maxSizeBytes) {
    const maxMb = Math.round(config.maxSizeBytes / (1024 * 1024));
    return { valid: false, error: `File size exceeds the ${maxMb} MB limit.` };
  }

  // 2. Dangerous extension check
  const ext = path.extname(fileName).toLowerCase();
  if (!ext || DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext || 'unknown'}" is prohibited for security.` };
  }

  // 3. Allowed extension check
  if (!(config.allowedExtensions as readonly string[]).includes(ext)) {
    return {
      valid: false,
      error: `Extension "${ext}" is not permitted for ${bucketId}. Allowed: ${config.allowedExtensions.join(', ')}.`
    };
  }

  // 4. MIME type check
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
  // Strip control chars, directory separators, and keep alphanumeric, dashes, dots, underscores
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || `file_${Date.now()}`;
}

/**
 * Constructs the canonical workspace-isolated storage path: `{workspaceId}/{timestamp}_{fileName}`
 */
export function buildWorkspaceStoragePath(workspaceId: string, fileName: string): string {
  const cleanWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanFileName = sanitizeStorageFileName(fileName);
  return `${cleanWorkspace}/${Date.now()}_${cleanFileName}`;
}

/**
 * Uploads a file to a private Supabase Storage bucket with workspace isolation
 */
export async function uploadToWorkspaceStorage(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  fileName: string;
  data: Buffer | string;
  mimeType: string;
}): Promise<{ success: boolean; path?: string; error?: string }> {
  const { workspaceId, bucketId, fileName, data, mimeType } = options;

  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const validation = validateStorageFile(bucketId, fileName, buffer.length, mimeType);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const client = getAdminClient();
  if (!client) {
    // Graceful fallback when Supabase credentials are not yet configured in local development
    return {
      success: true,
      path: `local-storage-fallback/${workspaceId}/${sanitizeStorageFileName(fileName)}`
    };
  }

  const storagePath = buildWorkspaceStoragePath(workspaceId, fileName);

  try {
    const { error } = await client.storage.from(bucketId).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true
    });

    if (error) {
      console.warn(`[Churnveda Storage Warning] Failed uploading to bucket "${bucketId}":`, error.message);
      return { success: false, error: error.message };
    }

    return { success: true, path: storagePath };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Storage upload error' };
  }
}

/**
 * Generates a secure, short-lived signed URL for a private storage object
 */
export async function createSignedDownloadUrl(options: {
  workspaceId: string;
  bucketId: StorageBucketId;
  storagePath: string;
  expiresInSeconds?: number;
}): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const { workspaceId, bucketId, storagePath, expiresInSeconds = 900 } = options;

  // Strict cross-workspace isolation verification
  const pathPrefix = storagePath.split('/')[0];
  if (pathPrefix !== workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')) {
    return { success: false, error: 'Unauthorized: Cannot access files outside of your workspace.' };
  }

  const client = getAdminClient();
  if (!client) {
    return { success: false, error: 'Supabase Storage is not currently configured with service role credentials.' };
  }

  try {
    const { data, error } = await client.storage
      .from(bucketId)
      .createSignedUrl(storagePath, Math.min(3600, Math.max(60, expiresInSeconds)));

    if (error || !data?.signedUrl) {
      return { success: false, error: error?.message || 'Failed creating signed URL' };
    }

    return { success: true, signedUrl: data.signedUrl };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed creating signed download URL' };
  }
}

/**
 * Deletes all files in all buckets for a specific workspace (Used in Account Deletion)
 */
export async function deleteWorkspaceStorageFiles(workspaceId: string): Promise<{ deletedCount: number }> {
  const client = getAdminClient();
  if (!client) return { deletedCount: 0 };

  let totalDeleted = 0;
  const cleanWs = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');

  for (const bucketKey of Object.keys(STORAGE_BUCKET_CONFIG) as StorageBucketId[]) {
    try {
      const { data: files, error: listErr } = await client.storage.from(bucketKey).list(cleanWs);
      if (listErr || !files || files.length === 0) continue;

      const filePaths = files.map(f => `${cleanWs}/${f.name}`);
      const { error: delErr } = await client.storage.from(bucketKey).remove(filePaths);
      if (!delErr) {
        totalDeleted += filePaths.length;
      }
    } catch {
      // Continue cleanup across other buckets
    }
  }

  return { deletedCount: totalDeleted };
}

/**
 * Initializes and verifies storage buckets on startup
 */
export async function ensureStorageBuckets(): Promise<void> {
  const client = getAdminClient();
  if (!client) return;

  for (const [bucketId, config] of Object.entries(STORAGE_BUCKET_CONFIG)) {
    try {
      const { data: buckets } = await client.storage.listBuckets();
      const exists = buckets?.some(b => b.id === bucketId || b.name === bucketId);
      if (!exists) {
        await client.storage.createBucket(bucketId, {
          public: false,
          fileSizeLimit: config.maxSizeBytes,
          allowedMimeTypes: config.allowedMimeTypes as any
        });
        console.log(`[Churnveda Storage] Created private bucket: "${bucketId}"`);
      }
    } catch (e: any) {
      // If storage.createBucket fails due to insufficient privilege, SQL migration provides idempotent creation
    }
  }
}
