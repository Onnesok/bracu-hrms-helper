const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = {Date, Map, Set, Number, String, Math, RegExp};
vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'dist', 'core.js'), 'utf8'), sandbox);
const H = sandbox.HRMS;

const row30 = `100039\nEmployee\nResearch Assistant\nCSE\n30-10-2026\n09:00 AM\n05:30 PM\n07:21 AM\n01:01 PM\n5 hr 40.62 min\n5.68\nWP`;

test('parses the HRMS row and treats .62 suffix as seconds', () => {
  const r = H.parseText(row30)[0];
  assert.equal(r.date, '2026-10-30');
  assert.equal(r.status, 'WP');
  assert.equal(r.checkIn, '07:21 AM');
  assert.equal(r.checkOut, '01:01 PM');
  assert.equal(r.workedSeconds, 5 * 3600 + 41 * 60 + 2);
  assert.equal(r.estimated, false);
});

test('decimal minute mode is explicitly selectable', () => {
  assert.equal(H.parseDuration('5 hr 40.62 min', 'decimal'), 5 * 3600 + 40 * 60 + 37);
  assert.equal(H.parseDuration('8 hr 56.68 min', 'mmss'), 8 * 3600 + 57 * 60 + 8);
});

test('parses several copy-pasted records with 0 and nonzero hours', () => {
  const txt = `${row30}\n\n100039\nEmployee\n29-10-2026\n09:00 AM\n05:30 PM\n12:14 PM\n09:41 PM\n9 hr 27.00 min\n9.45\nP\n\n28-10-2026\n0 hr 0.00 min\n0\nW`;
  const records = H.parseText(txt);
  assert.equal(records.length, 3);
  assert.equal(records[0].date, '2026-10-30');
  assert.equal(records[1].workedSeconds, 9 * 3600 + 27 * 60);
  assert.equal(records[2].workedSeconds, 0);
  assert.equal(records[2].status, 'W');
});

test('WFH punch-time estimate used only if HRMS duration zero', () => {
  const r = H.parseText('19-09-2026 09:00 AM 05:30 PM 08:00 AM 10:00 PM 0 hr 0.00 min 0 WFH')[0];
  assert.equal(r.workedSeconds, 14 * 3600);
  assert.equal(r.estimated, true);
  const p = H.parseText('20-09-2026 09:00 AM 05:30 PM 08:00 AM 10:00 PM 0 hr 0.00 min 0 P')[0];
  assert.equal(p.workedSeconds, 0);
  assert.equal(p.estimated, false);
});

test('invalid dates and missing statuses are rejected', () => {
  assert.equal(H.parseText('31-02-2026 1 hr 0.00 min P').length, 0);
  assert.equal(H.parseText('30-10-2026 1 hr 0.00 min').length, 0);
});

test('calendar weekly forward carry is not counted as actual monthly time', () => {
  const fake = (day, seconds) => ({date: `2026-10-${String(day).padStart(2, '0')}`, status: 'P', workedSeconds: seconds, sourceDuration:'', checkIn:'', checkOut:'', estimated: false});
  const sum = H.summarizeMonth([fake(1, 41*3600+24*60), fake(9, 39*3600), fake(16,44*3600)], '2026-10', 17);
  assert.equal(sum.totalSeconds, 124 * 3600 + 24 * 60);
  assert.equal(sum.targetSeconds, 136*3600);
  assert.equal(sum.remainingSeconds, 11*3600+36*60);
  assert.equal(sum.weeks.length, 5);
  assert.equal(sum.weeks[0].extraForwardSeconds, 1*3600+24*60);
  assert.equal(sum.weeks[1].carryInSeconds, 1*3600+24*60);
  assert.equal(sum.weeks[1].extraForwardSeconds, 24*60);
  assert.equal(sum.weeks[2].carryInSeconds, 24*60);
  assert.equal(sum.weeks[2].extraForwardSeconds, 4*3600+24*60);
});

test('new scan replaces rows from same date but retains other dates', () => {
  const fake = (date, seconds) => ({date, status:'P',workedSeconds:seconds,sourceDuration:'1 hr 0.00 min',checkIn:'',checkOut:'',estimated:false});
  const current = [fake('2026-10-29',3600), fake('2026-10-30',3600)];
  const incoming = [fake('2026-10-30',7200)];
  const result = H.mergeByDate(current,incoming);
  assert.equal(result.length, 2);
  assert.equal(result.find(x=>x.date==='2026-10-30').workedSeconds,7200);
});

test('CSV includes rows and estimated marker', () => {
  const r = H.parseText(row30);
  const csv = H.exportCSV(r);
  assert.match(csv, /Worked seconds/);
  assert.match(csv, /2026-10-30/);
  assert.match(csv, /"WP"/);
});


test('table-cell parser respects blank actual punches and WFH estimates', () => {
  const row = ['100039','Employee','Research Assistant','CSE','30-10-2026','09:00 AM','05:30 PM','','','0 hr 0.00 min','0','WFH'];
  const missing = H.parseCells(row);
  assert.equal(missing.checkIn, '');
  assert.equal(missing.workedSeconds, 0);
  const present = H.parseCells([...row.slice(0,7),'08:00 AM','10:00 PM',...row.slice(9)]);
  assert.equal(present.workedSeconds, 14 * 3600);
  assert.equal(present.estimated, true);
});

test('auto monthly target counts scheduled Sun–Thu weekdays, not recorded attendance days', () => {
  const config = { weekdays:[0,1,2,3,4], excludedDates:[], includedDates:[], overrideDays:null };
  const plan = H.calculateWorkingDays('2026-10', [], config);
  assert.equal(plan.calendarDays, 21);
  assert.equal(plan.workingDays, 21);
  assert.equal(plan.estimated, true);
  assert.equal(H.summarizeMonth([], '2026-10', plan.workingDays).targetSeconds, 168 * 3600);
});

test('HRMS H/W holidays and user changes adjust auto working-day count, WP does not', () => {
  const row = (date, status) => ({date, status, workedSeconds:0, sourceDuration:'0 hr 0.00 min', checkIn:'', checkOut:'', estimated:false});
  const rows = [row('2026-10-04', 'H'),row('2026-10-05','W'),row('2026-10-09','WP')];
  const config = {weekdays:[0,1,2,3,4], excludedDates:['2026-10-06'], includedDates:['2026-10-09'], overrideDays:null};
  const plan = H.calculateWorkingDays('2026-10', rows, config);
  assert.equal(plan.calendarDays, 21);
  assert.equal(plan.statusExcluded, 2);
  assert.equal(plan.manuallyExcluded, 1);
  assert.equal(plan.manuallyIncluded, 1);
  assert.equal(plan.workingDays, 19);
  assert.equal(H.summarizeMonth(rows, '2026-10', plan.workingDays).targetSeconds, 152 * 3600);
});

test('known October count stays 17, manual confirmation wins, automatic mode can be restored', () => {
  const rules = {weekdays:[0,1,2,3,4], excludedDates:[], includedDates:[], overrideDays:17};
  const overridden = H.calculateWorkingDays('2026-10', [], rules);
  assert.equal(overridden.workingDays, 17);
  assert.equal(overridden.overrideUsed, true);
  assert.equal(H.summarizeMonth([], '2026-10', overridden.workingDays).targetSeconds, 136 * 3600);
  const auto = H.calculateWorkingDays('2026-10', [], {...rules,overrideDays:null});
  assert.equal(auto.workingDays,21);
  assert.equal(auto.overrideUsed,false);
});

test('monthly calendar dynamically updates for leap February and year boundaries', () => {
  const rules = {weekdays:[0,1,2,3,4], excludedDates:[], includedDates:[], overrideDays:null};
  const feb2028 = H.calculateWorkingDays('2028-02', [], rules);
  assert.equal(feb2028.calendarDays, 21);
  assert.equal(feb2028.workingDays*8, 168);
  assert.throws(() => H.calculateWorkingDays('2028-13', [], rules), /Invalid month/);
});
