/**
 * Environment check. Run `npm run doctor` when an install or build misbehaves —
 * it reports what is actually wrong instead of leaving you to read a node-gyp
 * stack trace.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

const root = process.cwd();
const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function fail(message) {
  throw new Error(message);
}

check('Node version is 22 or newer', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    fail(`found v${process.versions.node}. better-sqlite3 requires Node >= 22. Install the LTS from nodejs.org.`);
  }
  return `v${process.versions.node}`;
});

check('dependencies are installed', () => {
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    fail('node_modules is missing. Run: npm install');
  }
  return '';
});

check('no postinstall script is wired', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.scripts?.postinstall) {
    fail(
      `package.json has a postinstall script (${pkg.scripts.postinstall}). ` +
        'If it runs electron-builder install-app-deps it will try to compile ' +
        'better-sqlite3 from source and demand Python and Visual Studio Build Tools. ' +
        'Remove it.',
    );
  }
  return 'none — correct';
});

check('electron-builder is configured not to rebuild native modules', () => {
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  const missing = ['npmRebuild: false', 'nodeGypRebuild: false', 'buildDependenciesFromSource: false']
    .filter((flag) => !config.includes(flag));
  if (missing.length) fail(`electron-builder.yml is missing: ${missing.join(', ')}`);
  return 'all three flags set';
});

check('a prebuilt SQLite binary exists for this platform', () => {
  const target = `${process.platform}-${process.arch}.node`;
  const file = path.join(root, 'node_modules/better-sqlite3/prebuilds', target);
  if (!fs.existsSync(file)) {
    fail(
      `${target} not found in better-sqlite3/prebuilds. ` +
        'Reinstall with: rm -rf node_modules package-lock.json && npm install',
    );
  }
  const size = fs.statSync(file).size;
  return `${target} (${(size / 1024 / 1024).toFixed(1)} MB) — nothing to compile`;
});

check('SQLite loads without a rebuild', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a)');
  db.prepare('INSERT INTO t VALUES (?)').run(1);
  const row = db.prepare('SELECT a FROM t').get();
  db.close();
  if (row.a !== 1) fail('SQLite returned an unexpected result');
  return 'opened, wrote and read back';
});

check('the Electron binary is present', () => {
  const binary = require('electron');
  if (typeof binary !== 'string' || !fs.existsSync(binary)) {
    fail('Electron did not download. Run: npm install. Behind a proxy set ELECTRON_MIRROR.');
  }
  return path.basename(binary);
});

check('fonts are installed for the invoice', () => {
  const generated = path.join(root, 'shared/fonts.ts');
  if (!fs.existsSync(generated)) fail('shared/fonts.ts is missing. Run: npm run fonts');
  return '';
});

const width = Math.max(...results.map((r) => r.name.length));
console.log('\nPrem Jewellers Billing — environment check\n');
for (const r of results) {
  console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log('  Everything looks correct. npm run dev / npm run dist:win should work.\n');
  process.exit(0);
}
console.log(`  ${failed.length} problem(s) found — see the FAIL lines above.\n`);
process.exit(1);
