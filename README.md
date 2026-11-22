# BRACU HRMS Helper

A **local-only Chrome extension** that imports attendance from the authenticated HRMS website and computes fixed calendar weeks, carry-forward overtime, and month targets. No account password, API key, backend, or cloud service required.

## Install now (no build tools required)
1. Download/unzip this project.
2. Open `chrome://extensions` in desktop Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the inner **`dist`** folder (not the project root).
5. Sign in to `https://hrms.bracu.ac.bd/dashboard` normally. Navigate to your **attendance** table.
6. Click the **HRMS Helper** toolbar icon -> **Import / Settings** -> **Sync current HRMS page**. You can alternatively use the floating **HRMS Helper** button on the HRMS page.
7. If rows are not detected, copy the attendance table as plain text and paste it into **Import / Settings** -> **Import pasted rows**.
8. Sync additional pages individually if the HRMS table is paginated or virtualized. Syncing a date replaces older rows from that date.

## Open in Codex / VS Code
Open the **project root** in VS Code (`File > Open Folder`), then start Codex from that workspace. `AGENTS.md` explains the project structure and key assumptions. Ask Codex to adapt the DOM selectors to the authenticated HRMS attendance table, while keeping it read-only.

Build from source (TypeScript):
```sh
npm install
npm test
npm run build
```
The compiled load-unpacked extension is in `dist/`. After rebuilding, click **Reload** on `chrome://extensions`.

## Supported attendance row format
```text
100039
Employee Name
Research Assistant
Department of Computer Science and Engineering
30-10-2026
09:00 AM
05:30 PM
07:21 AM
01:01 PM
5 hr 40.62 min
5.68
WP
```
The parser accepts date formats DD-MM-YYYY / YYYY-MM-DD, both copied multiline text and conventional HTML tables (including many React data-grid structures). Import requires a date, duration string, and final status code. Actual duty and punch times may be missing. Official duration text is authoritative. WFH records with 0 duration and two actual punch times may be estimated and are visibly marked.

### Time convention — verify
The initial mode treats `40.62 min` as 40 minutes + 62 seconds, normalized to 41m 02s, matching a prior attendance conversation. There is an alternative **Decimal minutes** setting in case the website uses real fractions of minutes (40.62 min ≈ 40m 37s). The actual private HRMS implementation has not been verified. Changing the mode affects new imports; reimport dates to update older values.

## Attendance calculation policy
- Calendar weeks: 1–7, 8–14, 15–21, 22–28, 29–end.
- Each week's target: 40 hours; extra carries forward ONLY to the next week, not added again to month actual.
- Monthly goal: **calculated working-day count × 8 hours** for each selected month (never a universally fixed 136h).
- Default automatic calendar: Sunday–Thursday, editable in Import / Settings. Imported H and W dates on normally scheduled days are excluded; WP weekend overtime still contributes to actual hours, not scheduled days.
- The user can add/remove individual dates for holidays or special duty days, and optionally confirm a monthly workday count. October 2026 has a **user-confirmed override of 17 working days → 136h**; other months auto-estimate scheduled weekdays. Use **Use auto** to clear the October override.
- The automatic calendar estimate **cannot know future university holidays** unless visible in imported records or entered as an exception. The displayed estimate is labelled as such.
- No assumption that P, W, WP, H, or missing punches automatically mean 8 hours.

## Privacy and limitations
- Permissions are limited to `storage` and `activeTab`, with the content script restricted to `https://hrms.bracu.ac.bd/*`.
- No browser history, cookies, page network intercept, token scraping, background fetch or server uploads.
- Parsed attendance is stored in **Chrome local extension storage** on this device, not encrypted; avoid shared computers. You can delete a selected month's records from the extension.
- Browser-local data is not automatically synced between devices; Chrome may remove it if you uninstall the extension.
- This is an independent personal helper, **not an official BRAC University product**. Respect university IT/security and HR data policies before using or sharing it.
- The authenticated HRMS page structure could not be inspected remotely. The parser is best-effort and will likely require refinement in Codex after a real-page test.
- The extension only sees currently rendered rows. On virtualized/paginated tables, load/sync each page and verify totals against the original.

## Release
Version 0.2.0 — automatic month-specific target, calendar weekdays, holiday exceptions, user-confirmed overrides; source, prebuilt extension, offline tests and Codex handoff notes.
