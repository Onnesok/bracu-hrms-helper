/** Popup UI: displays only cached local attendance data, no network calls. */
(() => {
  interface Settings {
    /** Per-month confirmed count. Existing v0.1 settings are migrated without loss. */
    targets: Record<string, number>;
    weekdays: number[];
    excludedDates: string[];
    includedDates: string[];
  }
  interface Store {records: HRMS.AttendanceRow[]; settings: Settings; lastSync: string | null; minuteMode: HRMS.MinuteMode}
  const DEFAULT_SETTINGS: Settings = {
    targets: {"2026-10": 17}, // User-confirmed Oct 2026: 17 x 8 = 136h
    weekdays: [0, 1, 2, 3, 4], // Bangladesh default Sunday–Thursday; user-editable
    excludedDates: [],
    includedDates: [],
  };
  let state: Store = {records: [], settings: structuredClone(DEFAULT_SETTINGS), lastSync: null, minuteMode: "mmss"};

  function el<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }
  function escapeHtml(v: string | number): string {
    return String(v).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
  }
  function month(): string {return el<HTMLInputElement>("month").value;}
  function monthName(iso: string): string {
    const [y,m,d] = iso.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('en-GB', {day: '2-digit',month: 'short'});
  }
  function shortTime(seconds: number): string {
    const h = Math.floor(Math.max(0, seconds) / 3600);
    const m = Math.floor((Math.max(0, seconds) % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  function settingDays(m: string): number | null {
    const value = state.settings.targets[m];
    return Number.isInteger(value) && value >= 0 && value <= 31 ? value : null;
  }
  async function load() {
    const saved = await chrome.storage.local.get(["records", "settings", "lastSync", "minuteMode"]);
    state = {
      records: Array.isArray(saved.records) ? saved.records : [],
      settings: {
        targets: {...DEFAULT_SETTINGS.targets, ...(saved.settings?.targets || {})},
        weekdays: Array.isArray(saved.settings?.weekdays) ? saved.settings.weekdays.filter((d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6) : [...DEFAULT_SETTINGS.weekdays],
        excludedDates: Array.isArray(saved.settings?.excludedDates) ? saved.settings.excludedDates : [],
        includedDates: Array.isArray(saved.settings?.includedDates) ? saved.settings.includedDates : [],
      },
      lastSync: saved.lastSync || null,
      minuteMode: saved.minuteMode === "decimal" ? "decimal" : "mmss"
    };
    render();
  }
  function dayNumbers(dates: string[], selectedMonth: string): string {
    return dates.filter(date => date.startsWith(selectedMonth + '-'))
      .map(date => String(Number(date.slice(-2)))).join(', ');
  }
  function workingDayPlan(): HRMS.WorkingDayResult {
    return HRMS.calculateWorkingDays(month(), state.records, {
      weekdays: state.settings.weekdays,
      excludedDates: state.settings.excludedDates,
      includedDates: state.settings.includedDates,
      overrideDays: settingDays(month()),
    });
  }
  function render() {
    const plan = workingDayPlan();
    const summary = HRMS.summarizeMonth(state.records, month(), plan.workingDays);
    el("total").textContent = shortTime(summary.totalSeconds);
    el("target").textContent = summary.targetSeconds === null ? "Not set" : shortTime(summary.targetSeconds);
    el("remaining").textContent = summary.remainingSeconds === null ? "—" : shortTime(summary.remainingSeconds);
    el('target-method').textContent = `${plan.workingDays} days × 8h · ${plan.overrideUsed ? 'confirmed' : 'auto estimate'}`;
    el("days").textContent = String(summary.dayCount);
    el("count").textContent = String(state.records.length);
    el("remaining-sub").textContent = summary.targetSeconds === null ? "Set a monthly target" :
      summary.excessSeconds && summary.excessSeconds > 0 ? `+${shortTime(summary.excessSeconds)} over target` : "To reach target";
    const percent = summary.targetSeconds ? Math.round(summary.totalSeconds / summary.targetSeconds * 100) : 0;
    el("progress").style.width = `${Math.max(0, Math.min(100, percent))}%`;
    el("progress-label").textContent = `${shortTime(summary.totalSeconds)} of ${shortTime(summary.targetSeconds || 0)}`;
    el("percentage").textContent = summary.targetSeconds === null ? "—" : `${percent}%`;

    el("week-rows").innerHTML = summary.weeks.map(w => `<tr>
      <td>${escapeHtml(w.label)}</td>
      <td>${escapeHtml(shortTime(w.actualSeconds))}</td>
      <td class="${w.carryInSeconds ? '' : 'muted'}">${w.carryInSeconds ? '+' : ''}${escapeHtml(shortTime(w.carryInSeconds))}</td>
      <td class="${w.extraForwardSeconds ? 'extra' : 'muted'}">${w.extraForwardSeconds ? '+' : ''}${escapeHtml(shortTime(w.extraForwardSeconds))}</td>
    </tr>`).join('');

    const statusText = Object.entries(summary.statusCounts).map(([k,v]) => `${k}: ${v}`).join(' · ');
    const lastSync = state.lastSync ? new Date(state.lastSync).toLocaleString('en-GB') : "Never";
    el("last-sync").textContent = `${statusText || 'No attendance records yet'} · Last page sync: ${lastSync}. Extra is carried only to the next calendar week; never added again to monthly actual.`;
    el("daily-rows").innerHTML = summary.rows.length ? summary.rows.map(row => `<div class="record">
      <div><div class="record-date">${escapeHtml(monthName(row.date))} <span class="status-chip">${escapeHtml(row.status)}</span></div>
      <div class="record-sub">${escapeHtml(row.checkIn || '—')} → ${escapeHtml(row.checkOut || '—')}</div></div>
      <div class="record-right"><div class="record-time">${escapeHtml(shortTime(row.workedSeconds))}${row.estimated ? '*' : ''}</div>
      <div class="record-sub">${escapeHtml(row.sourceDuration)}</div></div>
    </div>`).join('') : `<div class="empty">No records for ${escapeHtml(month())}.<br>Use Sync or Paste Import to add attendance.</div>`;
    el<HTMLInputElement>("working-days").value = plan.overrideUsed ? String(plan.workingDays) : '';
    el<HTMLInputElement>("working-days").placeholder = `Automatic: ${plan.workingDays}`;
    el('auto-target').textContent = plan.overrideUsed ? 'Use auto' : 'Auto on';
    el<HTMLButtonElement>('auto-target').disabled = !plan.overrideUsed;
    el('calendar-explanation').textContent = plan.overrideUsed
      ? `Confirmed override: ${plan.workingDays} × 8 = ${plan.workingDays * 8}h. Calendar estimate would start at ${plan.calendarDays} weekdays; you can return to automatic anytime.`
      : `Automatic: ${plan.calendarDays} scheduled weekdays − ${plan.statusExcluded} HRMS H/W off-days − ${plan.manuallyExcluded} exclusions + ${plan.manuallyIncluded} added days = ${plan.workingDays} days × 8 = ${plan.workingDays * 8}h. An estimate until all holidays are known.`;
    document.querySelectorAll<HTMLInputElement>('input[name="workweek"]').forEach(input => {
      input.checked = state.settings.weekdays.includes(+input.value);
    });
    el<HTMLInputElement>('excluded-days').value = dayNumbers(state.settings.excludedDates, month());
    el<HTMLInputElement>('included-days').value = dayNumbers(state.settings.includedDates, month());
    el<HTMLSelectElement>("minute-mode").value = state.minuteMode;
  }

  function openTab(name: string) {
    document.querySelectorAll<HTMLButtonElement>(".tab").forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll<HTMLElement>("[data-panel]").forEach(panel => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }
  function feedback(id: string, text: string, warning = false) {
    el(id).textContent = text;
    el(id).classList.toggle('warn', warning);
  }
  async function syncVisible() {
    const button = el<HTMLButtonElement>("scan");
    button.disabled = true;
    feedback('scan-status', 'Reading visible attendance rows…');
    try {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.startsWith("https://hrms.bracu.ac.bd/")) {
        feedback('scan-status', 'Open BRACU HRMS in the active tab, navigate to attendance, then retry.', true);
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, {type: 'HRMS_SCAN'});
      if (response?.error) throw new Error(response.error);
      if (!response?.count) {
        feedback('scan-status', 'No attendance rows detected. Try the attendance table page or paste its copied rows below.', true);
        return;
      }
      feedback('scan-status', `Synced ${response.count} visible row(s); ${response.total} unique cached row(s). For paginated results, sync each page.`);
      await load();
    } catch (error) {
      feedback('scan-status', `Could not scan HRMS. Refresh its page and try again, or paste the data. (${String(error)})`, true);
    } finally {button.disabled = false;}
  }
  async function importRows() {
    const value = el<HTMLTextAreaElement>("pasted").value;
    const parsed = HRMS.parseText(value, state.minuteMode);
    if (!parsed.length) {
      feedback('import-status', 'No complete row found. Each record needs a date (DD-MM-YYYY), worked duration (H hr M.SS min), and status (P/W/WP/H/WFH).', true);
      return;
    }
    const merged = HRMS.mergeByDate(state.records, parsed);
    await chrome.storage.local.set({records: merged});
    const latest = parsed.map(r => r.date.slice(0,7)).sort().at(-1);
    if (latest) el<HTMLInputElement>('month').value = latest;
    await load();
    feedback('import-status', `Imported ${parsed.length} row(s); ${merged.length} cached. Dates in this import replace older entries for those same dates.`);
  }
  async function saveDays() {
    const raw = el<HTMLInputElement>('working-days').value.trim();
    const maxDay = new Date(+month().slice(0, 4), +month().slice(5, 7), 0).getDate();
    if (raw === '' || !/^\d+$/.test(raw) || +raw > maxDay) {
      feedback('import-status', `Enter a whole working-day count from 0 to ${maxDay}.`, true);
      return;
    }
    state.settings.targets[month()] = +raw;
    await chrome.storage.local.set({settings: state.settings});
    render();
    feedback('import-status', `Confirmed ${raw} scheduled working days: monthly target automatically recalculated to ${+raw * 8} hours.`);
  }
  async function useAutomatic() {
    delete state.settings.targets[month()];
    // Remove the built-in Oct 2026 default permanently after opting into auto.
    // A null overrides legacy defaults during the migration merge.
    (state.settings.targets as Record<string, number | null>)[month()] = null;
    await chrome.storage.local.set({settings: state.settings});
    render();
    feedback('import-status', `Automatic calendar estimate enabled for ${month()}.`);
  }
  function parseDayNumbers(raw: string): string[] | null {
    const maxDay = new Date(+month().slice(0, 4), +month().slice(5, 7), 0).getDate();
    if (!raw.trim()) return [];
    const parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (parts.some(part => !/^\d{1,2}$/.test(part) || +part < 1 || +part > maxDay)) return null;
    return [...new Set(parts.map(day => `${month()}-${String(+day).padStart(2, '0')}`))];
  }
  async function saveCalendar() {
    const excluded = parseDayNumbers(el<HTMLInputElement>('excluded-days').value);
    const included = parseDayNumbers(el<HTMLInputElement>('included-days').value);
    if (!excluded || !included) {
      feedback('import-status', 'Use valid day numbers for the selected month, separated by commas (example: 5, 12, 21).', true);
      return;
    }
    const weekdays = [...document.querySelectorAll<HTMLInputElement>('input[name="workweek"]')]
      .filter(input => input.checked).map(input => +input.value);
    // Month-specific exceptions are replaced for just the selected month.
    state.settings.excludedDates = state.settings.excludedDates.filter(date => !date.startsWith(month() + '-')).concat(excluded);
    state.settings.includedDates = state.settings.includedDates.filter(date => !date.startsWith(month() + '-')).concat(included);
    state.settings.weekdays = weekdays;
    await chrome.storage.local.set({settings: state.settings});
    render();
    feedback('import-status', 'Calendar rules saved. The monthly target was recalculated; confirmed monthly overrides still take priority.');
  }
  async function changeMode(mode: string) {
    state.minuteMode = mode === 'decimal' ? 'decimal' : 'mmss';
    await chrome.storage.local.set({minuteMode: state.minuteMode});
    feedback('import-status', 'Minute format saved. Re-sync or reimport existing records to recalculate them.');
  }
  async function deleteMonth() {
    const selected = month();
    if (!confirm(`Delete all locally saved HRMS attendance for ${selected}?`)) return;
    state.records = state.records.filter(row => !row.date.startsWith(selected + '-'));
    await chrome.storage.local.set({records: state.records});
    render();
    feedback('import-status', `Deleted attendance data for ${selected}.`);
  }
  function exportCsv() {
    const rows = HRMS.summarizeMonth(state.records, month(), settingDays(month())).rows;
    const blob = new Blob(["\uFEFF", HRMS.exportCSV(rows)], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bracu-hrms-attendance-${month()}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    el<HTMLInputElement>('month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
      tab.addEventListener('click', () => openTab(tab.dataset.tab || 'overview'));
    });
    el<HTMLInputElement>('month').addEventListener('change', render);
    el('scan').addEventListener('click', syncVisible);
    el('import').addEventListener('click', importRows);
    el('save-target').addEventListener('click', saveDays);
    el('auto-target').addEventListener('click', useAutomatic);
    el('save-calendar').addEventListener('click', saveCalendar);
    el<HTMLSelectElement>('minute-mode').addEventListener('change', e => changeMode((e.target as HTMLSelectElement).value));
    el('clear-month').addEventListener('click', deleteMonth);
    el('export-csv').addEventListener('click', exportCsv);
    chrome.storage.onChanged.addListener((_changes: any, area: string) => {
      if (area === 'local') load().catch(console.error);
    });
    await load();
  });
})();
