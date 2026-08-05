#!/usr/bin/env node
import { readFileSync } from 'fs';

const filePath = process.argv[2];
if (!filePath) {
  console.log('Usage: node scripts/fallow-summary.mjs <fallow.json>');
  process.exit(0);
}

let data;
try {
  data = JSON.parse(readFileSync(filePath, 'utf8'));
} catch {
  console.log('⚠️  Fallow produced invalid JSON — skipping summary');
  process.exit(0);
}

const total = data.total_issues ?? 0;
if (total === 0) {
  console.log('✅ Fallow: no issues found');
  process.exit(0);
}

console.log(`\n🔍 Fallow report — ${total} issue${total === 1 ? '' : 's'}\n`);

for (const f of data.unused_files ?? []) {
  console.log(`📁 Unused: ${f.path}${f.line ? ':' + f.line : ''}`);
}
if (data.unused_files?.length) console.log();

for (const e of data.unused_exports ?? []) {
  console.log(`📤 Unused export: ${e.path}:${e.line} — ${e.export_name}`);
}
if (data.unused_exports?.length) console.log();

for (const m of data.unused_class_members ?? []) {
  const cls = m.class_name ? `${m.class_name}.` : '';
  console.log(`🔧 Unused member: ${m.path}:${m.line} — ${cls}${m.member_name}`);
}
if (data.unused_class_members?.length) console.log();

for (const t of data.unused_types ?? []) {
  console.log(`🏷️  Unused type: ${t.path}:${t.line} — ${t.export_name ?? t.type_name}`);
}
if (data.unused_types?.length) console.log();

for (const u of data.unresolved_imports ?? []) {
  console.log(`❓ Unresolved: ${u.path}:${u.line} — "${u.specifier}"`);
}
if (data.unresolved_imports?.length) console.log();

const cycles = (data.circular_dependencies ?? []).slice(0, 5);
for (const c of cycles) {
  console.log(`🔄 Cycle: ${(c.files ?? []).join(' → ')} → …`);
}
if (cycles.length) console.log();

const deps = data.unused_dependencies ?? [];
for (const d of deps) {
  console.log(`📦 Unused dep: ${d.name ?? d.package_name}`);
}
if (deps.length) console.log();

console.log('💡 Suppress intentional dead code with:');
console.log('   // fallow-ignore-next-line <reason>');
console.log('   // fallow-ignore-file <reason>\n');
