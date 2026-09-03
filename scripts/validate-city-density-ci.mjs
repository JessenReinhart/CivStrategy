#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';

const reportPath = resolve(process.argv[2] ?? 'profile-city-results.json');
const MIN_AVG_FPS = 5;
const MAX_P95_FRAME_MS = 250;

function fail(message, report) {
  console.error(`[city-density-ci] FAIL: ${message}`);
  if (report) {
    console.error('[city-density-ci] measured:', JSON.stringify({
      sampleCount: report.sampleCount,
      avgFps: report.avgFps,
      minFps: report.minFps,
      p95FrameMs: report.p95FrameMs,
      ambient: report.ambient,
      errors: report.errors,
      product60FpsTargetPass: report.pass,
      note: report.note,
    }, null, 2));
  }
  process.exit(1);
}

if (!fs.existsSync(reportPath)) {
  fail(`missing profiler report at ${reportPath}`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`invalid profiler report: ${error.message}`);
}

const finiteMetrics = [report.sampleCount, report.avgFps, report.minFps, report.p95FrameMs]
  .every((value) => typeof value === 'number' && Number.isFinite(value));

if (!finiteMetrics || report.sampleCount < 1) {
  fail('profiler did not emit finite post-warmup performance samples', report);
}

if (report.ambient?.ok !== true) {
  fail('dense-city ambient population isolation / near-LOD invariant failed', report);
}

if (Array.isArray(report.errors) && report.errors.length > 0) {
  fail('browser/runtime errors were observed during the dense-city run', report);
}

if (report.avgFps < MIN_AVG_FPS || report.p95FrameMs > MAX_P95_FRAME_MS) {
  fail(
    `catastrophic headless-runtime stall proxy failed (avg FPS must be >= ${MIN_AVG_FPS}, p95 frame time <= ${MAX_P95_FRAME_MS} ms)`,
    report,
  );
}

console.log(
  `[city-density-ci] PASS: runtime stayed above the catastrophic-stall proxy ` +
  `(avg ${report.avgFps} FPS, p95 ${report.p95FrameMs} ms, ${report.sampleCount} samples).`,
);

if (report.pass === true) {
  console.log('[city-density-ci] The measured run also met the product 60 FPS / 16.67 ms target.');
} else {
  console.log(
    '[city-density-ci] Residual performance debt: this headless run did not prove the product 60 FPS / 16.67 ms target. ' +
    'Keep the profiler metrics as evidence and verify the absolute target on representative accelerated hardware.',
  );
}
