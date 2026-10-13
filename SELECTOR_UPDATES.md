# Selector updates

## October 1 signed-out conversation creation

Version 2.0.28 recognizes `/uc/` conversation paths and the first same-home history push during response creation.
The repair preserves the active response through the URL assignment.
These rules are packaged detection logic. A remote selector update cannot repair version 2.0.27's navigation reset.
The remote selector schema and file stay unchanged.

## October 1 page isolation repair

Version 2.0.27 does not insert a mute control or review dialog into ChatGPT.
The extension popup keeps the alert switch and review link.
Remote `mainButtonSelectors` still apply without a page refresh.
The file keeps `muteToggleSelectors` for older extension versions and schema compatibility.
Version 2.0.27 validates those fields but does not use them to change the page.
This repair needs the extension package. The remote selector file cannot disable the previous insertion code.

## October 1 localized controls

The reported Traditional Chinese control uses `aria-label="開始語音對話"` and the `bg-composer-primary` class.
The selector finds this button, but versions 2.0.23 and 2.0.24 reject its state.
The new regression test reproduced `controls_missing` before the repair.

Version 2.0.25 recognizes Chinese Send, Stop, and Voice labels.
It also uses exact primary control icon paths from the live October 1 ChatGPT page.
This method identifies the captured icons without an English label.
The icon check applies only to primary controls inside a composer.
Unknown icons do not establish an idle state.
The detector observes SVG path changes and distinguishes Voice clicks from prompt submissions.
It does not read prompt text or response text.

The repair needs the extension ZIP. A remote selector change cannot repair the packaged state check.
The local and hosted selector files do not need changes for this repair.
The capture script now includes the current composer and bounded SVG control paths for future bug reports.

Version 2.0.26 also recognizes the latest conversation turn's busy response status without a translated label.
It removes `data-composer-submit` alone as proof of an idle control, because ChatGPT retains it during generation.
This logic change also requires the extension package.

## September 29 Send control

The live temporary-chat test found a primary button with `aria-label="Send"`.
Version 2.0.23 found the button through its class but did not recognize its idle state.
It recorded the response start, then reported `controls_missing` after the response finished.
Version 2.0.24 adds this label to the control state check and built-in selectors.
The local selector file also includes the label within the existing 12-selector limit.
The label state repair requires the new extension ZIP. A remote selector update alone cannot repair version 2.0.23.
The live selector file has not changed as part of this repair.

## Signed-in composer repair

The user's September 25 HTML shows `[data-composer-footer-responsive]` as the composer footer.
The primary control has the `bg-composer-primary` class.
Its idle label is `Start Voice`. Its response label is `Stop`.
The previous label selectors did not include `Stop`.

The file now matches this control in its idle and response states.
The mute wrapper excludes buttons because the dictation button also has `flex` and `items-center` classes.

The version 2.0.21 content script passed local tests with the user's idle and response HTML.
Each simulated response caused one sound request, with a label change or a button replacement.
The user confirmed that version 2.0.21 played a ding after the local selector repair.

The version 2.0.21 popup can still show `Composer not found` when the response monitor operates.
That fixed check does not use the remote selector file. A Chrome Web Store update must repair that message.

The updated file is also at `/Users/moo/Documents/discofish/chatdinger.com/selectors.json`.
Local file changes do not publish the repair.
The user uploaded the file and purged the Cloudways cache.
The public URL matched the tested repair at 15:34 UTC on September 25, 2026.
Version 2.0.21 applies selector storage changes to open ChatGPT tabs without a reload.

The September 25, 2026 browser check found a different ChatGPT composer.
All four published main-button selectors matched zero elements on that page.
The new `button[data-composer-submit]` selector matched the send button and the stop button.
During the test response, the button had `aria-label="Stop generating"`.
After the response, it had `aria-label="Send message"` and the `hidden` attribute.
The current state detector recognizes these labels.

The mute control uses `[data-composer-trailing]` as its wrapper.
The anchor selector skips the hidden home-page dictation control.
The file also keeps the previous selectors for other ChatGPT layouts.

The browser check used ChatGPT without a signed-in account.
The check did not include extension audio playback or image generation.
The JSON passed the extension schema check and the selector length limits.
The `version` field is the schema version. Keep it at `1`.

## Publish the file

1. Replace the file at `https://chatdinger.com/selectors.json` with the repository's `selectors.json`.
2. If the host caches the file, purge that URL from the cache.
3. Make sure the URL returns the new JSON with `Content-Type: application/json` and `Access-Control-Allow-Origin: *`.

The extension requests the file about each hour while Chrome operates.
Version 2.0.22 also requests it when automatic repair starts.
Repair requests use a time-based query string to bypass an older cache entry.
The host must include the query string in its cache key or bypass its cache for this file.
This remote update does not need a Chrome Web Store release.
A local file change does not change the hosted file.
Changes to detection logic still need an extension release.

## Get the file immediately for a local check

1. Open `chrome://extensions`.
2. Set **Developer mode** to on.
3. Open Chat Dinger's **service worker** link.
4. Run `await fetchAndUpdateSelectors({ recovery: true })` in the Console.
5. Open the ChatGPT tab.
6. Send a test prompt.
7. Make sure the sound operates after the response.

Version 2.0.22 applies selectors in the open tab. It does not need a page refresh for a selector update.
An older extension can need a page refresh.

## Record DOM controls for the next repair

1. Open the ChatGPT tab in Chrome.
2. Open DevTools with **Command+Option+J** on a Mac.
3. Run the contents of `scripts/capture-chatgpt-controls.js` in the Console.
4. Send the JSON output to this task.
5. During a test response, run the script again.
6. Send that JSON output to this task.
7. After the response, run the script again.
8. Send that JSON output to this task.

The script records control attributes and their parent elements.
It does not record prompt text, response text, URLs, or input values.
The script makes no network requests and changes no page elements.
