#!/usr/bin/env node
// Compares the current per-tier coverage-summary.json files against the
// committed coverage-baseline.json. Fails if any metric drops by more
// than the TOLERANCE (0.5 pp), succeeds otherwise and prints the delta.

import fs from 'node:fs';
import path from 'node:path';

const TOLERANCE = 0.5; // percentage points
const METRICS = ['lines', 'branches', 'functions', 'statements'];

function loadSummary(tier) {
  const p = path.join('coverage', tier, 'coverage-summary.json');
  if (!fs.existsSync(p)) {
    console.error(`diff-vs-baseline: missing ${p} — run 'npm run test:coverage' first`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')).total;
}

if (!fs.existsSync('coverage-baseline.json')) {
  console.error('diff-vs-baseline: coverage-baseline.json missing — run capture-baseline.mjs');
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync('coverage-baseline.json', 'utf8'));

let regressed = false;
const report = [];
for (const tier of Object.keys(baseline).filter((k) => !k.startsWith('_'))) {
  const current = loadSummary(tier);
  const row = { tier, metrics: {} };
  for (const m of METRICS) {
    const was = baseline[tier][m];
    const now = current[m].pct;
    const delta = now - was;
    row.metrics[m] = { was, now, delta };
    if (delta < -TOLERANCE) regressed = true;
  }
  report.push(row);
}

function fmt(n) {
  return `${n.toFixed(2)}%`;
}
function fmtDelta(d) {
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}pp`;
}

for (const row of report) {
  console.log(`\n── ${row.tier}`);
  for (const m of METRICS) {
    const { was, now, delta } = row.metrics[m];
    const marker = delta < -TOLERANCE ? ' ✗ REGRESSED' : delta > TOLERANCE ? ' ↑' : '';
    console.log(`  ${m.padEnd(11)} ${fmt(was)} → ${fmt(now)} (${fmtDelta(delta)})${marker}`);
  }
}

if (regressed) {
  console.error(
    `\n✗ coverage regressed beyond tolerance (${TOLERANCE}pp). ` +
      `Fix the missing tests or update coverage-baseline.json intentionally ` +
      `(commit body must include 'cov-baseline: <reason>').`,
  );
  process.exit(1);
}
console.log(`\n✓ coverage within tolerance (${TOLERANCE}pp)`);
