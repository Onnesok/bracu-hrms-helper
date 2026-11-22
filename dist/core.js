"use strict";
/**
 * BRACU HRMS Helper — shared, zero-dependency attendance logic.
 * This file intentionally uses a TypeScript namespace so the compiled output can
 * be loaded as a classic MV3 content script, with no bundler and no network calls.
 */
var HRMS;
(function (HRMS) {
    const DATE_PATTERN = /\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/g;
    const DURATION_PATTERN = /\b(\d{1,3})\s*(?:hr|hrs|hour|hours)\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*(?:min|mins|minute|minutes)\b/i;
    const TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s*(?:AM|PM)?\b/gi;
    const STATUS_PATTERN = /\b(WFH|WP|P|W|H|L|A|CL|SL|EL|ML|LOP|HD)\b/gi;
    function normalizeDate(input) {
        const value = input.trim();
        let year, month, day;
        const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
        const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
        if (iso) {
            year = +iso[1];
            month = +iso[2];
            day = +iso[3];
        }
        else if (dmy) {
            day = +dmy[1];
            month = +dmy[2];
            year = +dmy[3];
        }
        else
            return null;
        const candidate = new Date(year, month - 1, day);
        if (year < 2000 || year > 2100 || candidate.getFullYear() !== year ||
            candidate.getMonth() !== month - 1 || candidate.getDate() !== day)
            return null;
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    HRMS.normalizeDate = normalizeDate;
    /** HRMS typically formats 'MM.SS min' (e.g. 40.62 = 40min 62sec).
     * A decimal-minutes alternative is provided because the page format hasn't been
     * verified against its authenticated source code.
     */
    function parseDuration(input, mode = "mmss") {
        const match = DURATION_PATTERN.exec(input);
        if (!match)
            return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const fractional = match[3] || "0";
        const seconds = mode === "mmss"
            ? Number(fractional.padEnd(2, "0"))
            : Math.round(Number(`0.${fractional}`) * 60);
        return hours * 3600 + minutes * 60 + seconds;
    }
    HRMS.parseDuration = parseDuration;
    function parseClock(text) {
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(text.trim());
        if (!match)
            return null;
        let hour = +match[1];
        const minute = +match[2];
        const second = +(match[3] || 0);
        if (minute > 59 || second > 59)
            return null;
        if (match[4]) {
            if (hour < 1 || hour > 12)
                return null;
            hour = hour % 12 + (match[4].toUpperCase() === "PM" ? 12 : 0);
        }
        else if (hour > 23)
            return null;
        return hour * 3600 + minute * 60 + second;
    }
    /** Parse ONE HRMS table record; never infer normal working hours from a status. */
    function parseRecord(text, mode = "mmss") {
        const flattened = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        const dates = [...flattened.matchAll(DATE_PATTERN)];
        if (dates.length !== 1)
            return null;
        const dateMatch = dates[0];
        const date = normalizeDate(dateMatch[0]);
        if (!date)
            return null;
        const afterDate = flattened.slice((dateMatch.index || 0) + dateMatch[0].length);
        const durationMatch = DURATION_PATTERN.exec(afterDate);
        if (!durationMatch)
            return null;
        const sourceDuration = durationMatch[0].trim();
        let workedSeconds = parseDuration(sourceDuration, mode);
        if (workedSeconds === null)
            return null;
        const beforeDuration = afterDate.slice(0, durationMatch.index);
        const afterDuration = afterDate.slice(durationMatch.index + durationMatch[0].length);
        const statuses = [...afterDuration.matchAll(STATUS_PATTERN)];
        if (!statuses.length)
            return null;
        const status = statuses[statuses.length - 1][0].toUpperCase();
        const timeMatches = [...beforeDuration.matchAll(TIME_PATTERN)].map(x => x[0].replace(/\s+/g, " ").trim());
        // The first two times normally represent duty hours; last two actual punches.
        // With only two time values, they may be scheduled duty hours, not punches.
        // Refuse to infer actual punches from those ambiguous values.
        const actualTimes = timeMatches.length >= 4 ? timeMatches.slice(2, 4) : [];
        const checkIn = actualTimes[0] || "";
        const checkOut = actualTimes[1] || "";
        let estimated = false;
        // Some WFH records have zero HRMS duration although actual punch times exist.
        // Only use these punches for WFH, visibly marking the result as estimated.
        if (status === "WFH" && workedSeconds === 0 && checkIn && checkOut) {
            const start = parseClock(checkIn), end = parseClock(checkOut);
            if (start !== null && end !== null) {
                const diff = (end - start + 86400) % 86400;
                if (diff > 0 && diff <= 20 * 3600) {
                    workedSeconds = diff;
                    estimated = true;
                }
            }
        }
        return { date, status, workedSeconds, sourceDuration, checkIn, checkOut, estimated };
    }
    HRMS.parseRecord = parseRecord;
    function signature(row) {
        return [row.date, row.status, row.checkIn, row.checkOut, row.sourceDuration, row.workedSeconds].join("|");
    }
    function deduplicate(rows) {
        const seen = new Map();
        for (const row of rows)
            seen.set(signature(row), row);
        return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date) || a.checkIn.localeCompare(b.checkIn));
    }
    HRMS.deduplicate = deduplicate;
    /** Supports pasted HRMS text where columns each occupy their own line,
     * and ordinary table text with one record per row.
     */
    function parseText(input, mode = "mmss") {
        const text = input.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
        const matches = [...text.matchAll(DATE_PATTERN)];
        const parsed = [];
        for (let i = 0; i < matches.length; i++) {
            const begin = matches[i].index || 0;
            const end = i + 1 < matches.length ? (matches[i + 1].index || text.length) : text.length;
            // Last fields of the prior row should NOT be prepended to this record.
            const segment = text.slice(begin, end);
            const row = parseRecord(segment, mode);
            if (row)
                parsed.push(row);
        }
        return deduplicate(parsed);
    }
    HRMS.parseText = parseText;
    /** Use explicit table column positions to preserve empty punch cells.
     * Expected columns from date onwards: date, duty-in, duty-out, punch-in,
     * punch-out, worked duration, decimal hours, status.
     */
    function parseCells(cells, mode = "mmss") {
        const values = cells.map(c => c.replace(/\u00a0/g, " ").trim());
        const dateIndex = values.findIndex(v => normalizeDate(v) !== null);
        if (dateIndex < 0)
            return null;
        const durationIndex = values.findIndex((v, i) => i > dateIndex && DURATION_PATTERN.test(v));
        if (durationIndex < 0)
            return null;
        const base = parseRecord(values.join(" "), mode);
        if (!base)
            return null;
        if (durationIndex >= dateIndex + 5) {
            const punchIn = values[dateIndex + 3] || "";
            const punchOut = values[dateIndex + 4] || "";
            base.checkIn = parseClock(punchIn) !== null ? punchIn : "";
            base.checkOut = parseClock(punchOut) !== null ? punchOut : "";
            // Recompute using exact punch columns; scheduled hours must never count.
            base.estimated = false;
            base.workedSeconds = parseDuration(base.sourceDuration, mode) || 0;
            if (base.status === "WFH" && base.workedSeconds === 0 && base.checkIn && base.checkOut) {
                const from = parseClock(base.checkIn), to = parseClock(base.checkOut);
                if (from !== null && to !== null) {
                    const difference = (to - from + 86400) % 86400;
                    if (difference > 0 && difference <= 20 * 3600) {
                        base.workedSeconds = difference;
                        base.estimated = true;
                    }
                }
            }
        }
        return base;
    }
    HRMS.parseCells = parseCells;
    /** Extract visible table/grid rows only; a SPA may render pages virtually. */
    function parseDocument(doc, mode = "mmss") {
        const selectors = [
            "table tbody tr", "table tr", "[role='row']", ".ant-table-row",
            ".MuiDataGrid-row", ".ag-row", ".rt-tr", "mat-row"
        ];
        const elements = [...doc.querySelectorAll(selectors.join(","))];
        const parsed = [];
        for (const element of elements) {
            const cells = [...element.querySelectorAll(":scope > td, :scope > th, :scope > [role='cell'], :scope > [role='gridcell'], :scope > .ant-table-cell")]
                .map(cell => cell.innerText || cell.textContent || "");
            const row = (cells.length ? parseCells(cells, mode) : null) ||
                parseRecord(element.innerText || element.textContent || "", mode);
            if (row)
                parsed.push(row);
        }
        // Fallback for non-semantic layouts: only scan a small targeted container.
        if (!parsed.length) {
            const regions = [...doc.querySelectorAll("main, [role='main'], .table-responsive, .attendance-table")];
            for (const region of regions) {
                const found = parseText(region.innerText || region.textContent || "", mode);
                parsed.push(...found);
            }
        }
        return deduplicate(parsed);
    }
    HRMS.parseDocument = parseDocument;
    /** Newly scanned dates replace previously cached dates; other dates persist. */
    function mergeByDate(existing, incoming) {
        if (!incoming.length)
            return deduplicate(existing);
        const updatedDates = new Set(incoming.map(row => row.date));
        return deduplicate([...existing.filter(row => !updatedDates.has(row.date)), ...incoming]);
    }
    HRMS.mergeByDate = mergeByDate;
    function formatSeconds(seconds) {
        const amount = Math.max(0, Math.round(seconds));
        const h = Math.floor(amount / 3600);
        const m = Math.floor((amount % 3600) / 60);
        const s = amount % 60;
        return `${h}h ${String(m).padStart(2, "0")}m${s ? ` ${String(s).padStart(2, "0")}s` : ""}`;
    }
    HRMS.formatSeconds = formatSeconds;
    /** Calculate a month's target days from its recurring schedule and observed
     * H/W dates, with explicit calendar exceptions and optional confirmed override.
     * Never infer future/unloaded HRMS holidays: the automatic result is an estimate.
     * P/WP hours on a weekend do not silently change the scheduled-workday count.
     */
    function calculateWorkingDays(month, allRows, rules) {
        const parts = /^(\d{4})-(\d{2})$/.exec(month);
        if (!parts || +parts[2] < 1 || +parts[2] > 12)
            throw new Error("Invalid month");
        const year = +parts[1];
        const monthNumber = +parts[2];
        const maxDay = new Date(year, monthNumber, 0).getDate();
        const weekdays = new Set(rules.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6));
        const scheduled = new Set();
        for (let d = 1; d <= maxDay; d++) {
            const day = `${month}-${String(d).padStart(2, "0")}`;
            if (weekdays.has(new Date(year, monthNumber - 1, d).getDay()))
                scheduled.add(day);
        }
        const calendarDays = scheduled.size;
        const observedOff = new Set(allRows
            .filter(row => row.date.startsWith(month + "-") && ["H", "W"].includes(row.status.toUpperCase()))
            .map(row => row.date));
        let statusExcluded = 0;
        for (const date of observedOff) {
            if (scheduled.delete(date))
                statusExcluded++;
        }
        let manuallyExcluded = 0;
        for (const date of new Set(rules.excludedDates)) {
            if (date.startsWith(month + "-") && scheduled.delete(date))
                manuallyExcluded++;
        }
        let manuallyIncluded = 0;
        for (const date of new Set(rules.includedDates)) {
            if (date.startsWith(month + "-") && normalizeDate(date) === date && !scheduled.has(date)) {
                scheduled.add(date);
                manuallyIncluded++;
            }
        }
        const overrideUsed = rules.overrideDays !== null && Number.isInteger(rules.overrideDays) &&
            rules.overrideDays >= 0 && rules.overrideDays <= maxDay;
        return {
            workingDays: overrideUsed ? rules.overrideDays : scheduled.size,
            calendarDays,
            statusExcluded,
            manuallyExcluded,
            manuallyIncluded,
            overrideUsed,
            estimated: !overrideUsed,
        };
    }
    HRMS.calculateWorkingDays = calculateWorkingDays;
    function summarizeMonth(allRows, month, workingDays) {
        const rows = deduplicate(allRows.filter(row => row.date.startsWith(month + "-")));
        const totalSeconds = rows.reduce((sum, row) => sum + row.workedSeconds, 0);
        const dayCount = new Set(rows.map(row => row.date)).size;
        const statusCounts = {};
        for (const row of rows)
            statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
        const parts = /^([0-9]{4})-([0-9]{2})$/.exec(month);
        if (!parts || +parts[2] < 1 || +parts[2] > 12)
            throw new Error("Invalid month");
        const maxDay = new Date(+parts[1], +parts[2], 0).getDate();
        const weeks = [];
        let carry = 0;
        for (let start = 1; start <= maxDay; start += 7) {
            const end = Math.min(start + 6, maxDay);
            const inWeek = rows.filter(row => {
                const day = +row.date.slice(8);
                return day >= start && day <= end;
            });
            const actual = inWeek.reduce((sum, row) => sum + row.workedSeconds, 0);
            const effective = actual + carry;
            const nextCarry = Math.max(0, effective - 40 * 3600);
            weeks.push({
                label: `${start}–${end}`, fromDay: start, toDay: end,
                actualSeconds: actual, carryInSeconds: carry,
                effectiveSeconds: effective, extraForwardSeconds: nextCarry,
                shortfallSeconds: Math.max(0, 40 * 3600 - effective), rows: inWeek.length,
            });
            carry = nextCarry;
        }
        const validDays = workingDays !== null && Number.isInteger(workingDays) && workingDays >= 0 && workingDays <= 31;
        const targetSeconds = validDays ? workingDays * 8 * 3600 : null;
        return {
            month, totalSeconds, dayCount, statusCounts,
            workingDays: validDays ? workingDays : null, targetSeconds,
            remainingSeconds: targetSeconds === null ? null : Math.max(0, targetSeconds - totalSeconds),
            excessSeconds: targetSeconds === null ? null : Math.max(0, totalSeconds - targetSeconds),
            weeks, rows,
        };
    }
    HRMS.summarizeMonth = summarizeMonth;
    function exportCSV(rows) {
        const quote = (text) => `"${String(text).replace(/"/g, '""')}"`;
        const headings = ["Date", "Status", "Check in", "Check out", "Worked hours", "Worked seconds", "HRMS duration", "Estimated from punches"];
        return [headings.map(quote).join(","), ...deduplicate(rows).map(row => [
                row.date, row.status, row.checkIn, row.checkOut, formatSeconds(row.workedSeconds),
                row.workedSeconds, row.sourceDuration, row.estimated ? "Yes" : "No"
            ].map(quote).join(","))].join("\r\n");
    }
    HRMS.exportCSV = exportCSV;
})(HRMS || (HRMS = {}));
