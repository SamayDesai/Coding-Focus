# LeetCode Focus (Chrome extension)

A local-only Manifest V3 Chrome extension that combines:

- A daily LeetCode requirement, independent of the timer.
- Website blocking for ordinary HTTP(S) top-level navigations, with an editable allowlist.
- Importable problem collections (TXT, CSV, JSON, or pasted URLs/slugs).
- A Pomodoro timer with implementation and solution-review phases, short breaks, long breaks, autostart, notifications, sound, task labels, local statistics, themes, and a floating Picture-in-Picture window.
- A timed bypass that expires automatically and restores the currently applicable enforcement rules.

## Install in desktop Chrome

1. Download and unzip `leetcode-focus-extension.zip`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `leetcode-focus-extension` folder (the folder that contains `manifest.json`).
5. Pin **LeetCode Focus** in the Chrome toolbar.
6. Open the extension's Settings page to review the allowlist and import your own collection. The included *Starter Interview Set* is selected by default, so the daily gate has a problem immediately.

The extension requests access to all web hosts because blocking requires it to inspect/redirect navigation requests across sites. This is necessary for the feature to work; the code stores its settings and history in local Chrome storage and does not send this data to a server.

## How enforcement works

The extension blocks non-allowlisted top-level HTTP(S) navigations whenever either condition is active:

1. Daily gate: the exact assigned problem has not produced a detected Accepted result today.
2. Focus gate: the timer is in implementation or solution review. Pausing during those phases does not release the focus gate. Break phases do release the focus gate, but an unfinished daily gate remains active.

Gmail, Google Calendar, Google Account sign-in, Google consent pages, the root/`www` host for common regional Google Search domains, LeetCode, and extension pages are allowed by default. Google Search entries are exact-host rules; they do not broadly allow Drive or all Google subdomains. Add more sites under Settings → Website allowlist.

A temporary bypass overrides both gating modes until its expiry. When it expires, the extension calculates the correct state from the current date, daily completion, and timer phase instead of restoring a stale snapshot.

## Timer behavior

Defaults: 30 minutes implementation, 20 minutes solution review, 5 minutes short break after each completed problem cycle, 10 cycles per session, and a 30-minute long break after the session. All are configurable. A cycle completing means its timer phases finished; it does not require LeetCode submission acceptance.

The timer derives remaining time from saved timestamps, so it survives tab switching and service-worker suspension. Chrome alarms process transitions when the browser is running; alarms do not wake a sleeping computer. If Chrome only processes a timer transition long after the device wakes, that overdue phase is not credited as focus time in statistics. PiP uses Chrome's Document Picture-in-Picture API and may need to be reopened after a browser restart.

## Problem lists

The included Starter Interview Set contains commonly used interview problem slugs. You can import plain-text URLs/slugs, CSV rows that contain a LeetCode URL or slug, or JSON arrays/objects containing `slug`, `titleSlug`, `url`, `link`, or similar fields. Duplicate and invalid entries are skipped. Assignments and suggestions are randomized without repeating previously assigned/accepted items until the collection is exhausted.

## Completion detection and limitations

LeetCode does not provide this extension with a stable, public submission-completion API. The implementation watches the LeetCode problem page after a Submit click and looks for its visible Accepted result. If it misses a result, use **Recheck Accepted** in the toolbar popup while the exact problem page is open. The recheck requires a visible Accepted result and reports an error if it cannot find one.

Because this relies on LeetCode's page UI, a future site redesign may require updating the detector. The extension records accepted problems it observes while installed; it does not import your full historical solved list from your LeetCode account, so it may assign a problem you solved before installing it. It cannot enforce restrictions in other browsers, desktop apps, or Chrome internal pages, and users can disable or uninstall it.

Website blocking applies to main-frame HTTP(S) navigations, not every subresource or item of content inside an already-loaded page. The extension is a productivity aid, not a tamper-proof parental-control system.

## Project structure

- `manifest.json`: Manifest V3 configuration and permissions.
- `js/background.js`: persistent state coordination, blocking rules, assignments, bypass and timer transitions.
- `js/leetcode-content.js`: LeetCode Accepted-result detection and recheck.
- `popup.html` / `js/popup.js`: toolbar interface.
- `dashboard.html` / `js/dashboard.js`: timer dashboard and floating PiP controls.
- `options.html` / `js/options.js`: daily gate, collections, import/export, allowlist, and backup/restore.
- `blocked.html` / `js/blocked.js`: blocked-site recovery page.
- `css/app.css`: shared styling.

## Quick validation performed

- JavaScript syntax checks for every `.js` file (`node --check`).
- Manifest JSON validation.
- A mocked Chrome API smoke test for daily assignment, rule creation, bypass, completion, suggestion rotation, timer gating, pause behavior, phase transitions, and imports.

A full end-to-end submission test against a live LeetCode account still needs to be run in the user's Chrome profile, because it depends on LeetCode's current DOM and account session.
