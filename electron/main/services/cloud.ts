/**
 * Firebase backup over the REST APIs.
 *
 * Deliberately no Firebase SDK: the REST endpoints do everything this app needs
 * (sign in, write, read back, list) and keep the packaged app small and the
 * startup instant — which matters more here than SDK conveniences.
 *
 * Records are stored as one JSON payload per document with a SHA-256 checksum
 * beside it, so a restore can prove the data came back byte-identical.
 */

import crypto from 'node:crypto';
import type { FirebaseSettings } from '../../../shared/types';

const AUTH_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const FIRESTORE_ROOT = 'https://firestore.googleapis.com/v1';

/** Firestore document ids may not contain '/', which invoice numbers do. */
export function documentId(value: string): string {
  return value.replace(/[/\\.#$[\]]/g, '_').slice(0, 120) || 'unnamed';
}

export function checksum(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function isCloudConfigured(settings: FirebaseSettings): boolean {
  return Boolean(
    settings.enabled &&
      settings.projectId.trim() &&
      settings.apiKey.trim() &&
      settings.email.trim() &&
      settings.password,
  );
}

interface AuthSession {
  idToken: string;
  expiresAt: number;
}

let cachedSession: AuthSession | null = null;
let cachedFor = '';

async function signIn(settings: FirebaseSettings): Promise<string> {
  const cacheKey = `${settings.projectId}:${settings.email}`;
  if (cachedSession && cachedFor === cacheKey && Date.now() < cachedSession.expiresAt) {
    return cachedSession.idToken;
  }

  const response = await fetch(`${AUTH_ENDPOINT}?key=${encodeURIComponent(settings.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: settings.email,
      password: settings.password,
      returnSecureToken: true,
    }),
  });

  const body = (await response.json()) as {
    idToken?: string;
    expiresIn?: string;
    error?: { message?: string };
  };

  if (!response.ok || !body.idToken) {
    throw new Error(`Firebase sign-in failed: ${body.error?.message ?? response.statusText}`);
  }

  const lifetimeSeconds = Number.parseInt(body.expiresIn ?? '3600', 10);
  cachedSession = {
    idToken: body.idToken,
    // Refresh a minute early so a long backup never expires mid-upload.
    expiresAt: Date.now() + (lifetimeSeconds - 60) * 1000,
  };
  cachedFor = cacheKey;
  return body.idToken;
}

export function clearCloudSession(): void {
  cachedSession = null;
  cachedFor = '';
}

function documentUrl(settings: FirebaseSettings, collection: string, id?: string): string {
  const base = `${FIRESTORE_ROOT}/projects/${encodeURIComponent(settings.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

async function firestoreRequest(
  settings: FirebaseSettings,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const token = await signIn(settings);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // Non-JSON error body: surface it as-is.
    }
    throw new Error(`Firestore error (${response.status}): ${detail}`);
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/**
 * Firestore caps a document at 1 MiB. Archives are split well under that so the
 * emergency backup keeps working as the shop's history grows — at roughly 670
 * bytes per invoice a single document would have failed at about 1,500 bills.
 */
export const ARCHIVE_CHUNK_BYTES = 600_000;

export interface CloudRecord {
  id: string;
  payload: unknown;
  checksum: string;
  updatedAt: string;
}

function collectionName(settings: FirebaseSettings, kind: string): string {
  const namespace = (settings.namespace || 'prem-jewellers').replace(/[^\w-]+/g, '-');
  return `${namespace}__${kind}`;
}

export async function putRecord(
  settings: FirebaseSettings,
  kind: string,
  id: string,
  payload: unknown,
): Promise<void> {
  const body = {
    fields: {
      payload: { stringValue: JSON.stringify(payload) },
      checksum: { stringValue: checksum(payload) },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };

  await firestoreRequest(
    settings,
    documentUrl(settings, collectionName(settings, kind), documentId(id)),
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

function parseDocument(doc: Record<string, unknown>): CloudRecord | null {
  const name = typeof doc.name === 'string' ? doc.name : '';
  const fields = doc.fields as Record<string, { stringValue?: string }> | undefined;
  const raw = fields?.payload?.stringValue;
  if (!raw) return null;

  try {
    return {
      id: name.split('/').pop() ?? '',
      payload: JSON.parse(raw),
      checksum: fields?.checksum?.stringValue ?? '',
      updatedAt: fields?.updatedAt?.stringValue ?? '',
    };
  } catch {
    return null;
  }
}

export async function getRecord(
  settings: FirebaseSettings,
  kind: string,
  id: string,
): Promise<CloudRecord | null> {
  try {
    const doc = await firestoreRequest(
      settings,
      documentUrl(settings, collectionName(settings, kind), documentId(id)),
      { method: 'GET' },
    );
    return parseDocument(doc);
  } catch (error) {
    if (error instanceof Error && /\(404\)/.test(error.message)) return null;
    throw error;
  }
}

/** Reads a whole collection, following Firestore's page tokens to the end. */
export async function listRecords(
  settings: FirebaseSettings,
  kind: string,
): Promise<CloudRecord[]> {
  const records: CloudRecord[] = [];
  let pageToken = '';

  do {
    const url = new URL(documentUrl(settings, collectionName(settings, kind)));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const page = await firestoreRequest(settings, url.toString(), { method: 'GET' });
    const documents = (page.documents as Record<string, unknown>[] | undefined) ?? [];

    for (const doc of documents) {
      const record = parseDocument(doc);
      if (record) records.push(record);
    }

    pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
  } while (pageToken);

  return records;
}

export interface ArchiveManifest {
  archiveId: string;
  parts: number;
  checksum: string;
  createdAt: string;
}

/**
 * Uploads a payload of any size as a numbered set of chunk documents plus a
 * manifest naming them. Splitting on the serialised string (not on records)
 * means one enormous invoice can never straddle the limit unnoticed.
 */
export async function putArchive(
  settings: FirebaseSettings,
  archiveId: string,
  payload: unknown,
): Promise<ArchiveManifest> {
  const serialised = JSON.stringify(payload);
  const parts: string[] = [];
  for (let offset = 0; offset < serialised.length; offset += ARCHIVE_CHUNK_BYTES) {
    parts.push(serialised.slice(offset, offset + ARCHIVE_CHUNK_BYTES));
  }
  // An empty payload still needs one part, so the manifest is never zero-length.
  if (parts.length === 0) parts.push('');

  for (let index = 0; index < parts.length; index += 1) {
    await putRecord(settings, 'archives', `${archiveId}__part${index}`, {
      archiveId,
      index,
      total: parts.length,
      chunk: parts[index],
    });
  }

  const manifest: ArchiveManifest = {
    archiveId,
    parts: parts.length,
    checksum: checksum(payload),
    createdAt: new Date().toISOString(),
  };

  // The manifest is written last, so a half-uploaded archive is never claimed
  // as complete by a later restore.
  await putRecord(settings, 'archives', archiveId, manifest);
  return manifest;
}

/** Reads every chunk back and reassembles the original payload, or null if incomplete. */
export async function getArchive(
  settings: FirebaseSettings,
  archiveId: string,
): Promise<unknown | null> {
  const manifestRecord = await getRecord(settings, 'archives', archiveId);
  if (!manifestRecord) return null;

  const manifest = manifestRecord.payload as ArchiveManifest;
  if (!manifest || typeof manifest.parts !== 'number') return null;

  let serialised = '';
  for (let index = 0; index < manifest.parts; index += 1) {
    const part = await getRecord(settings, 'archives', `${archiveId}__part${index}`);
    if (!part) return null;
    const chunk = (part.payload as { chunk?: string }).chunk;
    if (typeof chunk !== 'string') return null;
    serialised += chunk;
  }

  try {
    return JSON.parse(serialised);
  } catch {
    return null;
  }
}

/** Verifies credentials and write access without touching real data. */
export async function testCloudConnection(settings: FirebaseSettings): Promise<void> {
  if (!isCloudConfigured(settings)) {
    throw new Error('Add the Firebase project id, API key, email and password first.');
  }

  const probe = { checkedAt: new Date().toISOString() };
  await putRecord(settings, 'health', 'connection-check', probe);

  const readBack = await getRecord(settings, 'health', 'connection-check');
  if (!readBack || checksum(readBack.payload) !== checksum(probe)) {
    throw new Error('Cloud write succeeded but the read-back did not match.');
  }
}
