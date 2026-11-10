import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { renderReport } from '../core/report.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/report-data.json', import.meta.url));
const CLI = fileURLToPath(new URL('../make-report.mjs', import.meta.url));
const data = () => readJson(FIXTURE);
const opts = { env: 'uat', generatedAt: '2026-11-10T00:00:00Z' };

const section = (md, title) => {
  const start = md.indexOf(`## ${title}`);
  assert.ok(start >= 0, `missing section ${title}`);
  const next = md.indexOf('\n## ', start + 1);
  return md.slice(start, next < 0 ? undefined : next);
};
const line = (s, prefix) => s.split('\n').find((l) => l.startsWith(prefix));

test('renders sections in order', () => {
  const md = renderReport(data(), null, opts);
  const heads = ['# Topology uat', '## Services theo Domain/Layer', '## Phụ thuộc', '## Dữ liệu',
    '## Gap đang mở', '## Thay đổi so với lần trước'];
  const idx = heads.map((h) => md.indexOf(h));
  idx.forEach((i, k) => assert.ok(i >= 0, `missing ${heads[k]}`));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
  assert.ok(md.startsWith('# Topology uat'));
  assert.match(md, /2026-11-10T00:00:00Z/);
});

test('services table has the right columns, capability names and coverage', () => {
  const s = section(renderReport(data(), null, opts), 'Services theo Domain/Layer');
  assert.match(s, /\| Service \| Domain \| Layer \| Summary \| Capabilities \| Độ phủ \|/);
  assert.match(s, /\| Hủy đơn hàng, Tạo đơn hàng \|/);
  assert.match(s, /38\/40/);
  assert.ok(line(s, '| pay-svc').trim().endsWith('| — |'), line(s, '| pay-svc'));
});

test('coverage stored as a JSON string (as ArcadeDB returns it) is parsed', () => {
  const d = data();
  for (const s of d.services) if (s.coverage && typeof s.coverage === 'object') s.coverage = JSON.stringify(s.coverage);
  const s = section(renderReport(d, null, opts), 'Services theo Domain/Layer');
  assert.match(s, /38\/40/);
});

test('unclassified service listed under (chưa phân loại)', () => {
  const s = section(renderReport(data(), null, opts), 'Services theo Domain/Layer');
  const misc = line(s, '| misc-svc');
  assert.ok(misc.includes('(chưa phân loại)'), misc);
  assert.ok(s.indexOf('| misc-svc') > s.indexOf('| pay-svc'), 'unclassified sorted last');
});

test('table cells escape pipes and newlines', () => {
  const s = section(renderReport(data(), null, opts), 'Services theo Domain/Layer');
  assert.match(s, /Quản lý đơn hàng \\\| tạo và hủy<br>dòng hai/);
});

test('matrix cell shows protocol×callCount, endpoint count, async and low-confidence markers', () => {
  const s = section(renderReport(data(), null, opts), 'Phụ thuộc');
  assert.equal(line(s, '| Caller'), '| Caller | ext:bank | ext:smtp | pay-svc |');
  assert.equal(line(s, '| order-svc'), '| order-svc |  | channel,http×2 (async) | http×3 · 1 ep |');
  assert.equal(line(s, '| pay-svc'), '| pay-svc | http×1? |  |  |');
  const d = data();
  Object.assign(d.dependencies[1], { endpointsUsed: ['a', 'b'], confidence: 'low' });
  const s2 = section(renderReport(d, null, opts), 'Phụ thuộc');
  assert.equal(line(s2, '| order-svc'), '| order-svc |  | channel,http×2 · 2 ep (async)? | http×3 · 1 ep |');
});

test('data table lists location, owners and readers', () => {
  const s = section(renderReport(data(), null, opts), 'Dữ liệu');
  assert.match(s, /\| DataStore \| Location \| Owner \| Readers \|/);
  assert.match(s, /\| ds:orders \(postgres\) \| db1 \| order-svc \| misc-svc, pay-svc \|/);
  assert.match(s, /\| ds:ledger \(mongo\) \|  \|  \|  \|/);
});

test('service cards follow the table, grouped by domain, unclassified last', () => {
  const s = section(renderReport(data(), null, opts), 'Services theo Domain/Layer');
  const table = s.indexOf('| Service |');
  const order = s.indexOf('### order-svc (order-svc)');
  const pay = s.indexOf('### pay-svc (pay-svc)');
  const misc = s.indexOf('### misc-svc (misc-svc)');
  assert.ok(table >= 0 && order > table && pay > table && misc > table);
  assert.ok(pay < order && order < misc, 'payment, sales, then unclassified');
  const card = s.slice(order, misc);
  assert.match(card, /Quản lý đơn hàng \| tạo và hủy dòng hai/);
  assert.match(card, /\*\*Trách nhiệm\*\*\n- Tạo đơn/);
  assert.ok(!card.includes('**Không phụ trách**'), 'empty list omitted');
  assert.match(card, /\*\*Capabilities\*\*\n- Hủy đơn hàng\n- Tạo đơn hàng/);
  assert.match(card, /\*\*Độ phủ\*\*: 38\/40/);
  assert.match(card, /\*\*Layer\*\*: core-service/);
  assert.match(card, /\*\*Owner team\*\*: sales/);
  assert.match(card, /\*\*Tech stack\*\*: spring-boot/);
  const miscCard = s.slice(misc);
  assert.match(miscCard, /\*\*Domain\*\*: \(chưa phân loại\)/);
  assert.match(miscCard, /\*\*Độ phủ\*\*: —/);
  assert.ok(!miscCard.includes('**Capabilities**'));
  const withNot = data();
  withNot.services[1].notResponsibleFor = ['Lưu thẻ', 'Hoàn tiền'];
  const s2 = section(renderReport(withNot, null, opts), 'Services theo Domain/Layer');
  assert.match(s2, /\*\*Không phụ trách\*\*\n- Hoàn tiền\n- Lưu thẻ/);
});

test('gaps grouped by askWho, only open ones', () => {
  const s = section(renderReport(data(), null, opts), 'Gap đang mở');
  assert.ok(s.includes('### BA') && s.includes('### DevOps') && s.includes('### (chưa rõ)'));
  assert.ok(!s.includes('### Dev\n'));
  assert.ok(!s.includes('Đã trả lời'));
  const devops = s.slice(s.indexOf('### DevOps'));
  assert.match(devops, /URL của pay-svc ở uat\?.*uat:order-svc:service:order-svc/);
  assert.ok(s.indexOf('### (chưa rõ)') > s.indexOf('### DevOps'));
});

test('first report text when prev null', () => {
  const s = section(renderReport(data(), null, opts), 'Thay đổi so với lần trước');
  assert.match(s, /Lần đầu tạo report/);
});

test('diff section lists a removed dependency, added service and capability changes', () => {
  const prev = data();
  prev.dependencies.push({ from: 'pay-svc', to: 'ext:old', protocol: 'http', callCount: 1 });
  prev.services = prev.services.filter((x) => x.projectKey !== 'misc-svc');
  prev.services.push({ projectKey: 'legacy-svc', name: 'legacy-svc' });
  prev.services[0].capabilities = ['Tạo đơn hàng', 'Xuất hóa đơn'];
  const s = section(renderReport(data(), prev, opts), 'Thay đổi so với lần trước');
  assert.ok(!s.includes('Lần đầu tạo report'));
  assert.match(s, /Phụ thuộc bị mất[^#]*pay-svc→ext:old/);
  assert.match(s, /Service mới[^#]*misc-svc/);
  assert.match(s, /Service bị mất[^#]*legacy-svc/);
  assert.match(s, /Capability mới[^#]*order-svc: Hủy đơn hàng/);
  assert.match(s, /Capability bị mất[^#]*order-svc: Xuất hóa đơn/);
});

test('no changes vs identical prev', () => {
  const s = section(renderReport(data(), data(), opts), 'Thay đổi so với lần trước');
  assert.match(s, /Không có thay đổi/);
});

test('tolerates empty/missing input and is deterministic', () => {
  const md = renderReport({}, null, opts);
  assert.ok(md.includes('## Gap đang mở'));
  const shuffled = data();
  shuffled.services.reverse();
  shuffled.dependencies.reverse();
  shuffled.gaps.reverse();
  shuffled.dataOwnership.reverse();
  assert.equal(renderReport(shuffled, null, opts), renderReport(data(), null, opts));
});

test('CLI writes report and studio-queries.md, exits 2 on bad usage, 1 on error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  const out = join(dir, 'topology-report.md');
  const prevFile = join(dir, 'prev.json');
  writeFileSync(prevFile, JSON.stringify({ services: [] }));
  const r = spawnSync(process.execPath, [CLI, FIXTURE, out, '--env', 'uat', '--prev', prevFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /^# Topology uat/);
  assert.match(md, /Service mới/);
  const sq = join(dir, 'studio-queries.md');
  assert.ok(existsSync(sq));
  assert.match(readFileSync(sq, 'utf8'), /```cypher/);
  assert.match(readFileSync(sq, 'utf8'), /'uat'/);
  const bad = spawnSync(process.execPath, [CLI, FIXTURE, out, '--env', 'prod'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const missing = spawnSync(process.execPath, [CLI, join(dir, 'nope.json'), out, '--env', 'uat'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
});
