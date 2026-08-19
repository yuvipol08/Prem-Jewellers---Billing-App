import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { EMERGENCY_CONFIRMATION_PHRASE } from '../../../shared/api';
import type { BackupManifest, CloudStatus } from '../../../shared/types';
import {
  clearLocalData,
  countInvoicesChangedSince,
  createSnapshot,
  restoreSnapshot,
  type RestoreCounts,
  type Snapshot,
} from '../db/snapshot';
import { getSettings, getSyncValue, setSyncValue } from '../db/settings';
import {
  checksum,
  getArchive,
  isCloudConfigured,
  listRecords,
  putArchive,
  putRecord,
} from './cloud';

const LAST_CLOUD_BACKUP = 'last_cloud_backup_at';
const LAST_CLOUD_SYNC = 'last_cloud_sync_at';

function manifestFor(snapshot: Snapshot): BackupManifest {
  return {
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    shopName: snapshot.shopName,
    invoiceCount: snapshot.invoices.length,
    customerCount: snapshot.customers.length,
    checksum: checksum({ customers: snapshot.customers, invoices: snapshot.invoices }),
  };
}

function backupFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `prem-jewellers-backup-${stamp}.json`;
}

// ---------------------------------------------------------------- local files

export async function exportLocalBackup(
  parent: BrowserWindow | null,
): Promise<{ filePath: string; manifest: BackupManifest } | null> {
  const snapshot = createSnapshot();
  const manifest = manifestFor(snapshot);
  const { shop } = getSettings();

  const defaultPath = path.join(shop.localBackupFolder || os.homedir(), backupFileName());
  const options = {
    title: 'Save Offline Backup',
    defaultPath,
    filters: [{ name: 'Prem Jewellers Backup', extensions: ['json'] }],
  };

  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;

  fs.writeFileSync(result.filePath, JSON.stringify({ manifest, snapshot }, null, 2), 'utf8');
  return { filePath: result.filePath, manifest };
}

export async function importLocalBackup(
  parent: BrowserWindow | null,
): Promise<RestoreCounts | null> {
  const options = {
    title: 'Restore From Backup File',
    properties: ['openFile' as const],
    filters: [{ name: 'Prem Jewellers Backup', extensions: ['json'] }],
  };

  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;

  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  const parsed = JSON.parse(raw) as { manifest?: BackupManifest; snapshot?: Snapshot };
  const snapshot = parsed.snapshot ?? (parsed as unknown as Snapshot);

  // A mismatched checksum means the file was edited or truncated — refuse it
  // rather than importing a half-readable set of bills.
  if (parsed.manifest?.checksum) {
    const actual = checksum({ customers: snapshot.customers, invoices: snapshot.invoices });
    if (actual !== parsed.manifest.checksum) {
      throw new Error('This backup file is damaged — its contents do not match its checksum.');
    }
  }

  return restoreSnapshot(snapshot);
}

export async function chooseBackupFolder(parent: BrowserWindow | null): Promise<string | null> {
  const options = { title: 'Choose Backup Folder', properties: ['openDirectory' as const, 'createDirectory' as const] };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

// --------------------------------------------------------------------- cloud

export function cloudStatus(): CloudStatus {
  const { firebase } = getSettings();
  const lastBackupAt = getSyncValue(LAST_CLOUD_BACKUP);

  return {
    configured: isCloudConfigured(firebase),
    lastBackupAt,
    lastSyncAt: getSyncValue(LAST_CLOUD_SYNC),
    // A COUNT, not a snapshot: this runs every time the Settings screen opens,
    // and loading every invoice with its line items made that O(n) in disk reads.
    // Everything counts as pending until a backup has run at least once.
    pendingChanges: countInvoicesChangedSince(lastBackupAt),
  };
}

/** Uploads every invoice and customer, one document each, then records the time. */
export async function cloudBackup(): Promise<RestoreCounts> {
  const { firebase } = getSettings();
  if (!isCloudConfigured(firebase)) {
    throw new Error('Enable and configure Firebase in Settings before backing up to the cloud.');
  }

  const snapshot = createSnapshot();

  for (const customer of snapshot.customers) {
    await putRecord(firebase, 'customers', String(customer.id ?? customer.mobile), customer);
  }
  for (const invoice of snapshot.invoices) {
    await putRecord(firebase, 'invoices', invoice.invoiceNo, invoice);
  }
  await putRecord(firebase, 'manifests', 'latest', manifestFor(snapshot));

  setSyncValue(LAST_CLOUD_BACKUP, new Date().toISOString());
  setSyncValue(LAST_CLOUD_SYNC, new Date().toISOString());

  return { invoices: snapshot.invoices.length, customers: snapshot.customers.length };
}

export async function cloudRestore(): Promise<RestoreCounts> {
  const { firebase } = getSettings();
  if (!isCloudConfigured(firebase)) {
    throw new Error('Enable and configure Firebase in Settings before restoring from the cloud.');
  }

  const customers = await listRecords(firebase, 'customers');
  const invoices = await listRecords(firebase, 'invoices');

  const snapshot: Snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    shopName: getSettings().shop.shopName,
    customers: customers.map((record) => record.payload as Snapshot['customers'][number]),
    invoices: invoices.map((record) => record.payload as Snapshot['invoices'][number]),
    settings: getSettings(),
  };

  const counts = restoreSnapshot(snapshot);
  setSyncValue(LAST_CLOUD_SYNC, new Date().toISOString());
  return counts;
}

// --------------------------------------------------------- emergency wipe

export interface EmergencyReport {
  uploadedInvoices: number;
  uploadedCustomers: number;
  verified: boolean;
  archiveId: string;
  clearedLocalData: boolean;
}

/**
 * Emergency Backup & Clear Device.
 *
 * Order matters and is deliberate: upload, then read the archive back and
 * compare checksums, and only then erase the device. If any step fails the
 * function throws before anything is deleted, so a failed upload can never
 * cost the shop its records.
 */
export async function emergencyBackupAndClear(confirmation: string): Promise<EmergencyReport> {
  if (confirmation.trim().toUpperCase() !== EMERGENCY_CONFIRMATION_PHRASE) {
    throw new Error(`Type "${EMERGENCY_CONFIRMATION_PHRASE}" exactly to confirm.`);
  }

  const { firebase } = getSettings();
  if (!isCloudConfigured(firebase)) {
    throw new Error(
      'Cloud backup is not configured. Records can only be cleared once they are safely uploaded.',
    );
  }

  const snapshot = createSnapshot();
  if (snapshot.invoices.length === 0 && snapshot.customers.length === 0) {
    throw new Error('There is nothing stored on this device to back up.');
  }

  const archiveId = `emergency-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const expected = checksum(snapshot);

  // 1. Upload the complete archive (chunked, so size is not a limit) plus
  //    per-record copies for ordinary browsing and restore.
  await putArchive(firebase, archiveId, snapshot);
  for (const customer of snapshot.customers) {
    await putRecord(firebase, 'customers', String(customer.id ?? customer.mobile), customer);
  }
  for (const invoice of snapshot.invoices) {
    await putRecord(firebase, 'invoices', invoice.invoiceNo, invoice);
  }

  // 2. Verify by reading every chunk back, reassembling, and comparing checksums.
  const readBack = await getArchive(firebase, archiveId);
  const verified = Boolean(readBack && checksum(readBack) === expected);
  if (!verified) {
    throw new Error(
      'Upload could not be verified against the cloud copy. Nothing was deleted from this device.',
    );
  }

  await putRecord(firebase, 'manifests', archiveId, manifestFor(snapshot));

  // 3. Only now is it safe to erase.
  clearLocalData();
  setSyncValue(LAST_CLOUD_BACKUP, new Date().toISOString());
  setSyncValue(LAST_CLOUD_SYNC, new Date().toISOString());

  return {
    uploadedInvoices: snapshot.invoices.length,
    uploadedCustomers: snapshot.customers.length,
    verified: true,
    archiveId,
    clearedLocalData: true,
  };
}

/** Silent backup into the configured folder, used on exit when enabled. */
export function autoBackupToFolder(): string | null {
  const { shop } = getSettings();
  if (!shop.autoBackupOnExit || !shop.localBackupFolder) return null;

  try {
    fs.mkdirSync(shop.localBackupFolder, { recursive: true });
    const snapshot = createSnapshot();
    const filePath = path.join(shop.localBackupFolder, backupFileName());
    fs.writeFileSync(
      filePath,
      JSON.stringify({ manifest: manifestFor(snapshot), snapshot }, null, 2),
      'utf8',
    );
    return filePath;
  } catch {
    // Quitting must never be blocked by a backup problem.
    return null;
  }
}
