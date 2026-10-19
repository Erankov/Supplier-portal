// Turns Playwright JSON results into a short Hebrew report (Markdown).
// Usage: node report.js <out.md> "<section title>=<results.json>" [...more sections]
const fs = require('fs');
const path = require('path');
const { siteVersion } = require('./specs/helpers');

const [out, ...sections] = process.argv.slice(2);
const icon = s => (s === undefined || s === 'skipped' ? '➖' : s === 'passed' ? '✅' : s === 'flaky' ? '⚠️' : '❌');
const firstLine = msg => String(msg || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find(l => l.trim()) || '';

// The lines that say where a failure happened (a timeout's first line alone says nothing).
const KEY = /^(Locator:|Expected|Received|waiting for|.*intercepts pointer events|.*element is (not|outside))/;
function detail(errors) {
  const lines = [];
  for (const e of errors || []) {
    const text = String(e.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map(l => l.trim().replace(/^- /, ''));
    for (const l of text.slice(1)) if (KEY.test(l) && !lines.includes(l)) lines.push(l.length > 160 ? l.slice(0, 160) + '…' : l);
    if (e.location) lines.push(`${path.basename(e.location.file)}:${e.location.line}`);
  }
  return lines.slice(0, 6).map(l => `\n    - \`${l.replace(/`/g, "'")}\``).join('');
}

const STATUS = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

// One row per test, one cell per screen size (Playwright lists each size separately).
function collect(suite, trail, rows) {
  const here = suite.title && !suite.title.endsWith('.spec.js') ? [...trail, suite.title] : trail;
  for (const spec of suite.specs || []) {
    const area = here[0] || '', name = [...here.slice(1), spec.title].join(' › ');
    let row = rows.find(r => r.area === area && r.name === name);
    if (!row) rows.push((row = { area, name, cells: {}, errors: [] }));
    for (const t of spec.tests) {
      const last = t.results[t.results.length - 1] || {};
      const status = STATUS[t.status] || 'failed';
      row.cells[t.projectName] = status;
      if (status === 'failed') row.errors.push(`${t.projectName}: ${firstLine(last.error && last.error.message)}${detail(last.errors)}`);
    }
  }
  for (const s of suite.suites || []) collect(s, here, rows);
  return rows;
}

let allOk = true;
const body = [];
for (const arg of sections) {
  const i = arg.lastIndexOf('=');
  const title = arg.slice(0, i), file = arg.slice(i + 1);
  if (!fs.existsSync(file)) {
    allOk = false;
    body.push(`## ${title}\n\n❌ הבדיקות לא רצו (לא נמצא קובץ תוצאות).\n`);
    continue;
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  for (const s of json.suites) collect(s, [], rows);
  const projects = [...new Set(rows.flatMap(r => Object.keys(r.cells)))];
  const failed = rows.filter(r => r.errors.length);
  const counted = rows.flatMap(r => Object.values(r.cells)).filter(s => s !== 'skipped');
  const passed = counted.filter(s => s !== 'failed').length;
  if (failed.length) allOk = false;

  body.push(`## ${title}\n`);
  body.push(`${failed.length ? '❌' : '✅'} עברו ${passed} מתוך ${counted.length} בדיקות.\n`);
  if (failed.length) {
    body.push('### מה נכשל\n');
    for (const r of failed) body.push(`- **${r.area} › ${r.name}**\n${r.errors.map(e => `  - ${e}`).join('\n')}`);
    body.push('');
  }
  body.push(`| אזור | בדיקה | ${projects.join(' | ')} |`);
  body.push(`|---|---|${projects.map(() => ':-:').join('|')}|`);
  for (const r of rows) body.push(`| ${r.area} | ${r.name} | ${projects.map(p => icon(r.cells[p])).join(' | ')} |`);
  body.push('');
}

const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
const head = [
  '# דוח בדיקות',
  '',
  `**${allOk ? '✅ הכל עובר' : '❌ יש בדיקות שנכשלו'}** · גרסה ${siteVersion()} · ${when}`,
  '',
  'הבדיקות עוברות על האתר כמו משתמש, בטלפון ובמחשב, על נתוני ההדגמה. אף הזמנה אמיתית לא נוצרת.',
  '',
];
const md = [...head, ...body].join('\n');
fs.writeFileSync(out, md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md.split('\n')[2]);
process.exitCode = allOk ? 0 : 1;
