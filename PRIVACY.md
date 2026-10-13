# Chat Dinger Privacy Notice

Effective date: September 25, 2026

Chat Dinger detects when ChatGPT finishes a response. It then plays the sound that you select.

## Data that stays in Chrome

Chat Dinger stores these items in `chrome.storage.local`:

- Your settings, such as the selected sound and volume.
- Whether you said that you heard the test sound during setup.
- Local use totals, response times, streaks, and achievement state.
- Whether the store review popup has appeared and whether the review link was clicked.
- A cached list of ChatGPT interface selectors.
- The time of the last selector update.
- The latest detection failure and the time of the latest repair request.
- Your error-report setting and the time of the latest report attempt.

Settings and statistics stay in Chrome. Optional error reports include only the fields listed below.
You can reset the settings and statistics from the extension popup.

## Network request

Chat Dinger requests `https://chatdinger.com/selectors.json` at install, browser start, and about once each hour. This file helps the extension adapt when ChatGPT changes its interface.
If detection fails, Chat Dinger also requests a repair. These requests have a time-based cache key, with no user identifier.

The request does not include your chats, prompts, responses, settings, or local statistics. As with a normal website request, the server or hosting provider can receive technical request data. This data can include an IP address, a user agent, and a request time.

## Optional error reports

Error reports are off by default. You can set **Send error reports** to on or off in Settings.
If this setting is on, Chat Dinger can report a detection failure after two repair attempts.
It sends the extension version, a fixed error code, and a fingerprint of the active selector list.
It does not send chat text, page URLs, email addresses, account identifiers, or a persistent installation identifier.
The setting also allows the uninstall URL to include the latest fixed error code, selector fingerprint, extension version, and failure time.
The failure time lets the uninstall page show the age of the saved record. The snapshot can be old when you uninstall.
Chat Dinger removes these fields from the uninstall URL when you turn error reports off.

Reports go to `https://chatdinger.com/api/dinger-health` over HTTPS.
The alert service uses Cloudflare to group reports and send an email to the developer.
Cloudflare can receive the technical request data listed above. The application does not store IP addresses in its report records.
The application keeps report groups for up to 24 hours. Cloudflare can retain operational logs and storage backups separately.
The extension limits report attempts to one each 15 minutes. After success, it suppresses the same report for six hours.

The **Report problem** button opens a GitHub issue draft with an error code and version data.
The button does not submit the issue. You control the text that you submit.

## Chat content

Chat Dinger checks ChatGPT page controls to detect response state. It does not read, store, or send your prompt text or response text.

## Local snapshots and copied diagnostics

The camera button creates a PNG with your total wait time, total dings, and featured milestone.
The extension creates the image on your device and downloads it when you click the button.
You control where you share that image.

The **Copy diagnostics** button copies recent detection events, sound results, and extension version data.
These events stay in the page memory until the page closes or refreshes.
The report contains no chat text, chat URLs, or conversation identifiers.
The button copies the report to your clipboard. It does not send the report to a server.

## Uninstall page

Chrome opens `https://chatdinger.com/uninstall/` after you uninstall Chat Dinger. The URL includes the installed extension version.
When **Send error reports** is on and a valid failure record exists, the URL also includes its fixed error code, selector fingerprint, extension version, and time.

The page can show an optional uninstall form. If you submit the form, the site receives your selected reason and optional text.

The uninstall URL does not include your chats, settings, or local statistics. The server can receive the standard technical request data described above.

## Permissions

- `scripting` starts Chat Dinger in open ChatGPT tabs after installation.
- `storage` saves settings and statistics on your device.
- `notifications` shows a system notification when a response finishes.
- `offscreen` plays the selected sound in a background document.
- `alarms` schedules selector updates.
- Access to `chatgpt.com` and `chat.openai.com` lets Chat Dinger detect response state on those sites.

## Data removal

Use **Reset settings and stats** in the popup to remove your settings and statistics. Chat Dinger then restores its default settings.

Chrome also removes extension local storage when you uninstall the extension.

## Changes and questions

This notice can change when Chat Dinger changes. The effective date above identifies the current notice.

For a question, open an issue in the [Chat Dinger repository](https://github.com/rumblelab/chatdinger/issues).
