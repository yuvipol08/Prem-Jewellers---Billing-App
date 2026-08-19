/**
 * Runs the whole QA cycle and writes a machine-readable summary.
 *
 * Each Electron suite prints a [[SUMMARY]] line; those are collected here so the
 * production readiness report is generated from real results rather than
 * transcribed by hand.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'qa-results');
fs.mkdirSync(outDir, { recursive: true });

const headless = process.platform === 'linux' && !process.env.DISPLAY;
const electron = path.join(root, 'node_modules', '.bin', 'electron');

function runElectronSuite(name, extraArgs = []) {
  const args = [...extraArgs, path.join('tests', 'electron', `${name}.cjs`)];
  const command = headless ? 'xvfb-run' : electron;
  const commandArgs = headless ? ['-a', electron, '--no-sandbox', ...args] : args;

  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(path.join(outDir, `${name}.log`), output);

  const line = output.split('\n').find((l) => l.startsWith('[[SUMMARY]]'));
  if (!line) {
    return { suite: name, total: 0, passed: 0, failed: 1, failures: [{ name: 'suite did not report', note: 'no summary line — see the log' }] };
  }
  return JSON.parse(line.slice('[[SUMMARY]]'.length).trim());
}

function runUnitTests() {
  const files = fs.readdirSync(path.join(root, 'tests', 'unit'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => path.join('tests', 'unit', f));
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(path.join(outDir, 'unit.log'), output);

  const number = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output);
    return match ? Number(match[1]) : 0;
  };
  const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => ({ name: m[1], note: '' }));
  return { suite: 'unit', total: number('tests'), passed: number('pass'), failed: number('fail'), failures };
}

console.log('Building...');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

const summaries = [];
console.log('\nUnit tests...');
summaries.push(runUnitTests());

for (const [suite, args] of [['core', []], ['backup', []], ['security', []], ['ui', []], ['performance', ['--js-flags=--expose-gc']]]) {
  console.log(`Electron suite: ${suite}...`);
  summaries.push(runElectronSuite(suite, args));
}

const total = summaries.reduce((n, s) => n + s.total, 0);
const passed = summaries.reduce((n, s) => n + s.passed, 0);
const failed = summaries.reduce((n, s) => n + s.failed, 0);

const report = { generatedAt: new Date().toISOString(), total, passed, failed, suites: summaries };
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log('\n' + '='.repeat(64));
for (const s of summaries) {
  console.log(`  ${String(s.suite).padEnd(14)} ${String(s.passed).padStart(4)} / ${String(s.total).padEnd(4)} passed${s.failed ? `  ${s.failed} FAILED` : ''}`);
  for (const f of s.failures) console.log(`      FAIL ${f.name}${f.note ? ` — ${f.note}` : ''}`);
}
console.log('='.repeat(64));
console.log(`  TOTAL          ${String(passed).padStart(4)} / ${String(total).padEnd(4)} passed, ${failed} failed`);
console.log(`  Results written to qa-results/summary.json`);

process.exit(failed === 0 ? 0 : 1);
