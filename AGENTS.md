# Codex engineering notes — BRACU HRMS Helper

## Goal
Build a PRIVATE, READ-ONLY Chrome Manifest V3 helper for `https://hrms.bracu.ac.bd/*`, for tracking attendance and calculations, not a replacement login client. No backend, credentials, session inspection, page API replay, scraping beyond visible DOM, telemetry or external HTTP requests.

## Codebase
- `src/core.ts` — all parsing and calculations, global TypeScript `HRMS` namespace. No Chrome or DOM dependency in calculation functions.
- `src/content.ts` — content script: read existing visible HRMS attendance rows only on user click, save parsed rows to `chrome.storage.local`, display small on-page control.
- `src/popup.ts` — popup, import, monthly target, weekly carry-forward, CSV export.
- `assets/` — load-unpacked HTML/CSS/manifest/icons copied to `dist/` by build.
- `dist/` — prebuilt unpacked Chrome extension; `chrome://extensions` -> Load unpacked.
- `tests/` — Node unit tests for calculations and parsing.

## User's ACTUAL row schema
One record: employee ID, name, role, department, date `30-10-2026`, duty start `09:00 AM`, duty end `05:30 PM`, actual in `07:21 AM`, actual out `01:01 PM`, worked string `5 hr 40.62 min`, numeric decimal hours `5.68`, status `WP`.
Statuses observed: `P`, `W`, `WP`, `H`, `WFH`. Punches may be blank; zero-hour records MUST remain zero unless intentionally estimated for WFH with valid actual punch times. Always prefer worked-duration string to shift time difference. The current default minute convention treats `.SS` as seconds and normalizes overflow; this needs confirmation from authentic HRMS data. Decimal-minutes mode exists.

## Attendance rules (must preserve)
1. Weeks are fixed calendar groups 1–7, 8–14, 15–21, 22–28, 29–month end, NOT ISO or rolling weeks.
2. Week target 40 hours, even the final partial calendar block, until user explicitly changes the requirement.
3. Carry only positive excess to the NEXT calendar week; display `actual`, `carry in`, `extra forward` separately. Never double-count carried hours in the monthly total.
4. Monthly goal is ALWAYS scheduled working days × 8 hours. `calculateWorkingDays` estimates scheduled weekdays (default Sun–Thu) minus observed `H`/`W` and user exceptions, plus added workdays, with optional per-month confirmed day count superseding estimates. October 2026's user-confirmed working days = 17 (136 hours); all other months default to auto estimates, explicitly labelled as provisional. Do NOT use attendance-entry count as working-day count. Never treat WP weekend work as automatically changing official scheduled working days.
5. Rows can contain 0 recorded hours, absent punch timestamps, or WFH time estimates. Mark estimated rows distinctly.

## Known limitation
Public HRMS `/dashboard` serves a JavaScript SPA that says `You need to enable JavaScript to run this app.` The authenticated attendance DOM/HTML has not been inspected. This is a BEST-EFFORT parser for conventional tables, MUI/AntD grids, and pasted text. Do not claim it is verified against live HRMS. Ask user to inspect visible table `tr` or `role=row` in DevTools (never passwords/tokens) if adaptation is required. DOM may virtualize/paginate. Sync each page.

## Next steps for Codex
- Test on actual signed-in attendance page. Refine selectors/column positions without accessing secrets or bypassing auth.
- Add regression fixture from anonymized, USER-APPROVED real row exports.
- Resolve whether `.62` truly means seconds or hundredths of a minute; update the default ONLY on verified evidence.
- Improve recognition for empty punch columns, pagination, same-day multiple shifts, leave codes.
- Add per-month target and optional summaries; keep everything browser-local.

## Commands
`npm install` then `npm test` / `npm run build`. For immediate usage, no npm needed: load `dist/` directly in Chrome.
