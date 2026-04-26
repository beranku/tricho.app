#!/usr/bin/env node
// Reads per-tier coverage-summary.json files and emits
// coverage-baseline.json at the repo root. Run after a successful
// `npm run test:coverage` with all tiers green.

import fs from 'node:fs';
import path from 'node:path';

const TIERS = ['unit', 'component', 'backend'];
const baseline = {};

for (const tier of TIERS) {
  const p = path.join('coverage', tier, 'coverage-summary.json');
  if (!fs.existsSync(p)) {
    console.error(`capture-baseline: missing ${p} — run 'npm run test:coverage' first`);
    process.exit(1);
  }
  const { total } = JSON.parse(fs.readFileSync(p, 'utf8'));
  baseline[tier] = {
    lines: total.lines.pct,
    branches: total.branches.pct,
    functions: total.functions.pct,
    statements: total.statements.pct,
  };
}

baseline._meta = {
  capturedAt: new Date().toISOString(),
  tool: 'capture-baseline.mjs',
};

fs.writeFileSync('coverage-baseline.json', JSON.stringify(baseline, null, 2) + '\n');
console.log('Wrote coverage-baseline.json:');
console.log(JSON.stringify(baseline, null, 2));
