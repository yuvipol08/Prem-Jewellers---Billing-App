/**
 * Firebase REST contract tests.
 *
 * globalThis.fetch is replaced with a scripted stub, so the real sign-in,
 * write, read-back, pagination and chunked-archive code all execute and are
 * checked against the exact requests Firestore expects — no live project needed.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const cloud = await import('../../dist-electron/shared-cloud.mjs').catch(() => null);
const {
  ARCHIVE_CHUNK_BYTES, checksum, clearCloudSession, documentId, getArchive,
  getRecord, isCloudConfigured, listRecords, putArchive, putRecord, testCloudConnection,
} = cloud ?? (await import('../../dist-electron/electron/main/services/cloud.js'));

const settings = {
  projectId: 'prem-test', apiKey: 'AIzaTESTKEY', email: 'shop@example.com',
  password: 'secret', namespace: 'prem-jewellers', enabled: true,
};

/** Firestore stores what we PATCH, so the stub behaves like a tiny real Firestore. */
function createFirestoreStub({ failSignIn = false, expiresIn = '3600' } = {}) {
  const store = new Map();
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });

    if (href.includes('signInWithPassword')) {
      if (failSignIn) {
        return new Response(JSON.stringify({ error: { message: 'INVALID_PASSWORD' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ idToken: 'token-abc', expiresIn }), { status: 200 });
    }

    const path = href.split('/documents/')[1]?.split('?')[0] ?? '';
    const decoded = decodeURIComponent(path);

    if (init.method === 'PATCH') {
      store.set(decoded, JSON.parse(init.body));
      return new Response(JSON.stringify({ name: `projects/x/documents/${decoded}` }), { status: 200 });
    }

    // Collection listing (no document id in the path).
    if (!decoded.includes('/')) {
      const documents = [...store.entries()]
        .filter(([key]) => key.startsWith(`${decoded}/`))
        .map(([key, value]) => ({ name: `projects/x/documents/${key}`, ...value }));
      const pageSize = 300;
      const token = new URL(href).searchParams.get('pageToken');
      const start = token ? Number(token) : 0;
      const slice = documents.slice(start, start + pageSize);
      const next = start + pageSize < documents.length ? String(start + pageSize) : undefined;
      return new Response(JSON.stringify({ documents: slice, nextPageToken: next }), { status: 200 });
    }

    const found = store.get(decoded);
    if (!found) {
      return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
    }
    return new Response(JSON.stringify({ name: `projects/x/documents/${decoded}`, ...found }), { status: 200 });
  };

  return { store, calls, restore: () => { globalThis.fetch = original; } };
}

let active = null;
afterEach(() => { active?.restore(); active = null; clearCloudSession(); });

// ------------------------------------------------------------------ helpers

test('configuration is only complete when every credential is present', () => {
  assert.equal(isCloudConfigured(settings), true);
  assert.equal(isCloudConfigured({ ...settings, enabled: false }), false);
  assert.equal(isCloudConfigured({ ...settings, projectId: '' }), false);
  assert.equal(isCloudConfigured({ ...settings, apiKey: '  ' }), false);
  assert.equal(isCloudConfigured({ ...settings, password: '' }), false);
});

test('document ids strip the characters Firestore forbids', () => {
  assert.equal(documentId('PJ/25-26/0001'), 'PJ_25-26_0001');
  assert.equal(documentId('a.b#c$d[e]f'), 'a_b_c_d_e_f');
  assert.equal(documentId(''), 'unnamed');
  assert.ok(documentId('x'.repeat(500)).length <= 120, 'ids stay within the length limit');
});

test('checksums are stable and detect any change', () => {
  assert.equal(checksum({ a: 1 }), checksum({ a: 1 }));
  assert.notEqual(checksum({ a: 1 }), checksum({ a: 2 }));
});

// ------------------------------------------------------------------- auth

test('sign-in posts the credentials Firebase expects and reuses the token', async () => {
  active = createFirestoreStub();
  await putRecord(settings, 'invoices', 'PJ/25-26/0001', { total: 100 });
  await putRecord(settings, 'invoices', 'PJ/25-26/0002', { total: 200 });

  const signIns = active.calls.filter((c) => c.url.includes('signInWithPassword'));
  assert.equal(signIns.length, 1, 'the token is cached, not re-fetched per write');
  assert.ok(signIns[0].url.includes(`key=${settings.apiKey}`));
  const body = JSON.parse(signIns[0].body);
  assert.equal(body.email, settings.email);
  assert.equal(body.returnSecureToken, true);

  const writes = active.calls.filter((c) => c.method === 'PATCH');
  assert.equal(writes[0].headers.Authorization, 'Bearer token-abc');
});

test('a token near expiry is refreshed rather than reused', async () => {
  active = createFirestoreStub({ expiresIn: '30' }); // shorter than the 60s safety margin
  await putRecord(settings, 'invoices', 'a', { v: 1 });
  await putRecord(settings, 'invoices', 'b', { v: 2 });
  assert.equal(active.calls.filter((c) => c.url.includes('signInWithPassword')).length, 2);
});

test('a wrong password surfaces the Firebase reason, not a generic failure', async () => {
  active = createFirestoreStub({ failSignIn: true });
  await assert.rejects(() => putRecord(settings, 'invoices', 'a', { v: 1 }),
    /INVALID_PASSWORD/);
});

// ------------------------------------------------------------ read / write

test('a record round-trips with its checksum intact', async () => {
  active = createFirestoreStub();
  const payload = { invoiceNo: 'PJ/25-26/0001', grandTotal: 61800 };
  await putRecord(settings, 'invoices', payload.invoiceNo, payload);

  const read = await getRecord(settings, 'invoices', payload.invoiceNo);
  assert.deepEqual(read.payload, payload);
  assert.equal(read.checksum, checksum(payload));
});

test('a missing document reads as null, not an exception', async () => {
  active = createFirestoreStub();
  assert.equal(await getRecord(settings, 'invoices', 'nope'), null);
});

test('records are namespaced so several shops can share one project', async () => {
  active = createFirestoreStub();
  await putRecord({ ...settings, namespace: 'shop-a' }, 'invoices', 'x', { v: 1 });
  assert.ok([...active.store.keys()][0].startsWith('shop-a__invoices/'));
});

test('listing follows page tokens to the end', async () => {
  active = createFirestoreStub();
  for (let i = 0; i < 705; i += 1) {
    await putRecord(settings, 'invoices', `INV-${i}`, { i });
  }
  const all = await listRecords(settings, 'invoices');
  assert.equal(all.length, 705, 'every page was followed');
});

test('an empty collection lists as an empty array', async () => {
  active = createFirestoreStub();
  assert.deepEqual(await listRecords(settings, 'invoices'), []);
});

// --------------------------------------------------------- chunked archives

test('an archive larger than a Firestore document is split and reassembled', async () => {
  active = createFirestoreStub();
  // Well past the 1 MiB document cap that a single-document archive hit.
  const big = { invoices: Array.from({ length: 4000 }, (_, i) => ({
    invoiceNo: `PJ/25-26/${i}`, customerName: 'Ramesh Dattatray Patil',
    customerAddress: 'Plot 42, Ring Road, Jalgaon 425001', grandTotal: 165244,
    items: [{ hsnCode: '7113', particulars: 'Gold Necklace 22K (Antique)', grossWeight: 25.5,
      netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450,
      gstRate: 3 }],
  })) };
  const raw = JSON.stringify(big);
  assert.ok(raw.length > 1_048_576, `fixture must exceed the cap, was ${raw.length}`);

  const manifest = await putArchive(settings, 'emergency-test', big);
  assert.ok(manifest.parts > 1, 'the archive was split');
  assert.equal(manifest.checksum, checksum(big));

  for (const [key, doc] of active.store) {
    const size = doc.fields.payload.stringValue.length;
    assert.ok(size < 1_048_576, `${key} is ${size} bytes, over the Firestore limit`);
  }

  const restored = await getArchive(settings, 'emergency-test');
  assert.deepEqual(restored, big);
  assert.equal(checksum(restored), checksum(big));
});

test('a small archive still round-trips', async () => {
  active = createFirestoreStub();
  const small = { invoices: [], customers: [] };
  await putArchive(settings, 'tiny', small);
  assert.deepEqual(await getArchive(settings, 'tiny'), small);
});

test('an archive with a missing chunk refuses to restore rather than returning half the books', async () => {
  active = createFirestoreStub();
  const payload = { invoices: Array.from({ length: 3000 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
  await putArchive(settings, 'broken', payload);

  const chunkKey = [...active.store.keys()].find((k) => k.endsWith('__part1'));
  assert.ok(chunkKey, 'fixture should have produced multiple chunks');
  active.store.delete(chunkKey);

  assert.equal(await getArchive(settings, 'broken'), null);
});

test('a manifest that was never written means no archive', async () => {
  active = createFirestoreStub();
  assert.equal(await getArchive(settings, 'never-uploaded'), null);
});

test('the connection test writes, reads back and compares', async () => {
  active = createFirestoreStub();
  await testCloudConnection(settings);
  const probe = [...active.store.keys()].find((k) => k.includes('health'));
  assert.ok(probe, 'a probe document was written');
});

test('the connection test refuses to run before it is configured', async () => {
  await assert.rejects(() => testCloudConnection({ ...settings, apiKey: '' }),
    /project id, API key, email and password/i);
});
