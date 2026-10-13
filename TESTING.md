# Test version 2.0.28

## Release status

The local build recognizes English and Chinese controls and the primary control icons captured from ChatGPT on October 1.
The automated tests check localized controls, one sound request per response, cancellation, conversation creation, reconnection, and listener cleanup.
Version 2.0.25 passed live Chrome checks for the existing tab, a temporary chat, and user cancellation.
Version 2.0.26 added response status detection and stricter audio confirmation.
The user then reported a Brave page crash with both store version 2.0.23 and unpacked version 2.0.26.
Version 2.0.27 removed page UI insertion and passed the Brave page-load and manual playback checks.
Its first-response test failed because the detector discarded the response during conversation creation.
Version 2.0.28 repairs that navigation sequence.
The user reported a quick ding in Brave after the repeated cloud-facts response test with version 2.0.28.
The user also confirmed that Stop caused no false ding and that a longer image generation produced a sound after a tab change.
The user also heard the completion sound in a normal Brave chat with the Traditional Chinese interface after a tab change.
The user then reported that the Traditional Chinese test worked in Chrome.
The inspected Chrome tab was a Temporary Chat and showed a completed response with the Chinese Send control.
The user then reported success after reloading Chat Dinger, keeping the Chrome chat open, and requesting an image without a page refresh.
This supplies live evidence for reconnection after an extension reload and Chrome image alerts in a background tab.
A direct Chrome Web Store update from version 2.0.23 remains untested.
The user reported submitting version 2.0.28 to the Chrome Web Store on October 1, 2026.
The recorded release status is submitted and awaiting review. Approval and publication have not been confirmed.

## Dot messages reported after submission

The user reported missed sounds for dot replies and later messages sent without another prompt.
The inspected Chrome page used a `/dots/ID` route and a `Message` text box.
The idle Send button had an English label, no element ID, and no `data-testid`.
The page also contained `#chat-dinger-mute-btn` with the label `Disable Chat Dinger alerts`.
The user then confirmed that this dot test used the Chrome Web Store version, not the unpacked development version.
That explains the old mute control. This report does not establish a dot failure in version 2.0.28.
The current detector tracks known response activity followed by a known idle state.
It has no separate detector for newly delivered dot messages.
Dot replies and later incoming messages were not part of the completed release tests.
No dot messages were sent during inspection, and no runtime code or release package was changed.

## October 1 Brave first-response repair

The 2.0.27 diagnostic report recorded a response start, followed 249 milliseconds later by a history push.
That push changed the history entry key but kept the home pathname unchanged.
The detector reset its active response and blocked the remaining busy control as previous-page state.
ChatGPT then replaced the home URL with a `/uc/` conversation URL. The detector classified that path as `other`.
When Send returned, the detector showed ready but had no tracked response. It never requested sound.
The user confirmed the `/uc/` path separately. The tests use a placeholder conversation ID.

Version 2.0.28 recognizes `/uc/` as a conversation path.
It preserves the first same-home history push during the first 12 seconds of conversation creation.
The change needs an active or submitted first response and does not apply to blocked navigation.
A second same-home push, a later push, Browser Back, and New chat still discard the previous response.
The page-isolation repair stays in place. The extension does not insert page controls or a review dialog.
The exact reported sequence sends no sound request with the packaged 2.0.27 scripts.
The repaired scripts send one sound request and handle the simulated audio-start confirmation.
This is an automated browser simulation. It does not establish audible playback in Brave.
All 263 automated tests passed before package creation.
The user then reloaded version 2.0.28 and reported a quick ding during the repeated Brave cloud-facts test.
This supplies live playback evidence for the repaired response sequence.
The user then confirmed that Stop caused no false ding in Brave.
The user also completed a longer image generation, selected a different tab, and heard a sound.
The user then confirmed a completion sound after a tab change with the Traditional Chinese interface in a normal Brave chat.
The page showed the completed text response and the Traditional Chinese Voice control.
The original Auto detect language setting was restored, and the interface returned to English.
This check does not establish support for every language or layout.
The user then reported success in Chrome with the Traditional Chinese interface.
The inspected URL included `temporary-chat=true`, and the page showed a completed response with a disabled Chinese Send control.
The extension popup showed `Ready for the next reply`.
The original Auto detect setting was restored in Chrome, and the interface returned to English.
The user then completed the extension reload and Chrome image-response check and reported that it worked.
The requested sequence kept the chat open without a page refresh and selected another tab during image generation.
This does not establish a direct Chrome Web Store update from version 2.0.23.
The release ZIP passed another integrity check and matched all 35 packaged source files after these live tests.

1. Keep the store version disabled in Brave.
2. Reload the unpacked extension from `/Users/moo/Documents/claude-dinger`.
3. Make sure the unpacked extension shows version **2.0.28**.
4. Refresh ChatGPT before the first-response test.
5. Open a new ChatGPT chat.
6. Send the cloud-facts prompt again.
7. Select a different browser tab during the response.
8. Make sure one sound occurs after the response completes.
9. If no sound occurs, copy diagnostics from that chat without a page refresh.

## October 1 Brave page crash

The user reported that ChatGPT goes dark with Chat Dinger enabled in Brave.
The page loads with the extension disabled.
The user reproduced this with store version 2.0.23 and unpacked version 2.0.26.
The screenshot names ChatGPT's `unauth-mweb` renderer and a null `firstChild` error.
These results implicate the extension but do not establish the exact failing renderer operation.

Version 2.0.27 removes the composer mute button, its styles, its maintenance observer, and the in-page review dialog.
The existing popup keeps the alert switch and review link.
Remote control selectors still apply. The content script ignores remote mute-placement selectors.
The detector, sound, cancellation, and response-status logic remain unchanged.
Seven new tests failed before the change because the extension changed the page DOM.
They pass after the change and check node order, keyboard focus, drafts, selector updates, settings, completion, and page restoration.
All 251 automated tests passed, and the release ZIP passed the archive checks.
These tests do not reproduce the actual Brave renderer crash.
The user then confirmed that ChatGPT stayed visible in Brave with unpacked version 2.0.27 enabled.
The user also confirmed that the popup's Test sound action played a sound in Brave.
These results pass the initial page-load and manual playback checks.
The next Brave response test failed. The user reported no completion sound and no console output.
The requested test used 30 numbered facts about clouds and a different selected browser tab during generation.
The diagnostic report showed a tracked response followed by a navigation reset and no sound request.
Do not treat version 2.0.27 as release-ready.
Response alerts, cancellation, and localized interface checks remain necessary.

1. Keep the store version disabled in Brave.
2. Reload the unpacked extension from `/Users/moo/Documents/claude-dinger`.
3. Make sure the unpacked extension shows version **2.0.27**.
4. Enable only the unpacked copy.
5. Refresh the ChatGPT page to clear the previous crash and injected controls.
6. Make sure the page stays visible for at least 15 seconds.
7. Make sure the text box accepts a draft without an error.
8. Do these checks while signed out and while signed in.
9. Do the response, temporary-chat, and Stop checks below.

The initial crash check needs a page refresh. The separate extension-update check still uses an open page without a refresh.

## October 1 reliability repairs

The live ChatGPT page has a response status with `role="status"` and `aria-busy="true"`.
It is inside the latest `[data-turn-key]` in `[data-thread-find-target="conversation"]`.
Version 2.0.26 uses this signal without reading its text or translated labels.
It can detect a response when the Stop control is unknown and prevent early completion while the response status stays busy.
It still requires a known idle control before it sends a completion alert.
Navigation keeps the previous response blocked until its busy controls have cleared.

The tests exposed an early completion when an unknown control retained `data-composer-submit`.
The repair removes that attribute as proof of an idle state.
The tests also exposed false success from an audio reply without playback confirmation.
The content script and background now require `audioStarted: true` before recording playback success.
Chrome's explicit missing-receiver error permits one retry. An ambiguous closed reply port does not permit a retry.
All 251 automated tests passed after these changes.

The package command now runs the full checks before ZIP creation.
The package test compares the archived scripts with the source files.
The public error-report endpoint returned HTTP 404 during this inspection.
The owner alert service needs deployment and a received test email before it can provide failure alerts.
No automated live ChatGPT monitor is active.

## October 1 repair results

The attached rejection says the reviewer could not reproduce the completion sound.
It does not identify a browser language or chat type.
The current local package before this repair was version 2.0.24.
The customer report identifies version 2.0.23 and the Traditional Chinese Voice label `開始語音對話`.
Ten new regression cases failed before the repair. All 234 automated tests passed after the repair.
The tests include a Chinese first response across temporary and saved conversation URLs.
That test produced one sound request and one completion record.

The archive comparison used the packaged content scripts and simulated Chrome APIs.
Version 2.0.23 sent no sound request for the English temporary-chat or Traditional Chinese sequence.
Version 2.0.24 sent one sound request for the English sequence and none for the Chinese sequence.
Version 2.0.25 sent one sound request for each sequence.
The final ZIP contains the same source files that passed the tests.
These results do not establish actual audio playback in Chrome or Brave.

The live Chrome test captured the current Send, Stop, and Voice icons.
The installed store extension showed `Alerts are temporarily unavailable` after a temporary-chat response.
This establishes a failure in the installed version. It does not establish the store reviewer's exact test conditions.
The browser security policy blocked access to extension management, so the user loaded the unpacked version 2.0.25.
The existing ChatGPT tab connected without a page refresh.
Its first regular-chat response ended with the popup showing `Ready for the next reply`.
The user confirmed one Soft tap sound during the live checks.
A temporary-chat response increased the ding count from 28 to 29 and returned the popup to the ready state.
The temporary-chat response ran while a different Chrome tab was selected.
The next response used the Stop control. The ding count stayed at 29, and the popup returned to the ready state.
These checks used Chrome on this Mac. No live Brave or Traditional Chinese interface test was completed.
Loading an unpacked extension does not test a Chrome Web Store update with the same extension ID.

The current primary control icons do not depend on language.
The detector also has English and Chinese label fallbacks.
Some secondary checks still use English labels, including `Working` and image-generation labels.
The automated tests establish the reported Chinese control repair, but do not establish support for every language and layout.

## Release acceptance

1. Load version **2.0.28** with the procedure below.
2. Open Chat Dinger **Settings**.
3. Select **Test sound**.
4. Make sure you hear the sound.
5. Open a new ChatGPT chat.
6. Send a prompt that takes several seconds to complete.
7. Open a different browser tab.
8. Make sure one sound occurs after the response completes.
9. Do steps 5 through 8 with a temporary chat.
10. Do steps 5 through 9 with the Traditional Chinese interface.
11. Do steps 5 through 10 in Brave.
12. Do the Stop and extension update checks below.

The diagnostics must show detector build `creation-history-7` and content build `passive-page-4`.
The sound events must show `requested` and `started` for each completed test response.
The idle popup must show `Ready for the next reply`.
The acceptance checks must pass before store submission.

## Load the test extension

1. Open `chrome://extensions`.
2. Disable the Chrome Web Store copy of Chat Dinger.
3. Set **Developer mode** to on.
4. Click **Load unpacked**.
5. Select `/Users/moo/Documents/claude-dinger`.
6. Make sure the test extension shows version **2.0.28**.
7. Keep the existing ChatGPT tab open without a page refresh.

If the unpacked copy is already installed, use its **Reload** button after source changes.
The update handler must connect the new extension code without a page refresh.
Selector updates also apply without a page refresh.

## Check an update from version 2.0.23

Use an isolated Chrome test profile and one unpacked extension directory for these checks.
Keep the same extension ID through the update.

1. Load version 2.0.23 in the test extension directory.
2. Open ChatGPT.
3. Send a test prompt.
4. Record whether the response produces a ding.
5. Put a short draft in the ChatGPT text box.
6. Replace the test extension files with version 2.0.28.
7. Select **Reload** for the test extension on `chrome://extensions`.
8. Keep the ChatGPT tab open without a page refresh.
9. Make sure the draft remains in the text box.
10. Open Chat Dinger **Settings**.
11. Set **Enable Chat Dinger** to off.
12. Set **Enable Chat Dinger** to on.
13. Send the draft.
14. Open a different tab before the response completes.
15. Make sure one ding occurs after the response.
16. Wait at least 35 seconds without extension activity.
17. Send one more prompt.
18. Make sure one ding occurs after the response.

For a fresh-install check, open ChatGPT before installation and keep the tab open without a page refresh.
The existing tab must detect the next response after installation.

## Live finding on 29 September 2026

The installed Chrome Web Store version was 2.0.23.
A new temporary chat used `aria-label="Send"` for its disabled submit button.
Version 2.0.23 did not recognize that idle control.
The live diagnostic report showed `controls_missing` before and after the response.
The detector recorded the response start and preserved both conversation URL changes.
After completion, its sound event list stayed empty. The ding count stayed at 217.
The regression test failed before the repair and passed after it.
Version 2.0.24 recognizes this control without reading response text.

The archived-package comparison used the same `Send -> Stop -> Send` sequence and the current live selector configuration.
Version 2.0.21 sent one sound request. Versions 2.0.22 and 2.0.23 sent none. Version 2.0.24 sent one.
Adding an explicit `button[aria-label="Send"]` remote selector to version 2.0.23 still produced no sound request.
The selector finds the element, but the packaged state check rejects its label.
These checks use a simulated page and Chrome API. They do not replace the live Chrome check.
Version 2.0.21 also skips activation of open tabs after an extension update. A rollback retains that limitation.

A later live comparison used the installed store version 2.0.23 in a regular chat.
After the response, that page restored its `Start Voice` control.
The diagnostic report recorded one response completion and sound outcomes `requested` and `started`.
The popup showed `Ready for the next reply`, with no audio failure.
The temporary chat kept the unsupported `Send` control after its response and did not request sound.
This comparison confirms a layout-specific failure. It does not establish that the failure occurs only in temporary chats or explains all uninstall reports.

## Check the sound and response alerts

1. Open Chat Dinger.
2. Open **Settings**.
3. Click **Test sound**.
4. Make sure you hear the sound.
5. Click ChatGPT **New chat**.
6. Send a prompt that takes several seconds to complete.
7. Make sure you hear one ding after the first response completes.
8. Send another prompt.
9. Open another browser tab before the response completes.
10. Make sure you hear one ding after the response completes.
11. Start a response that takes several seconds to complete.
12. Click ChatGPT **Stop** before the response completes.
13. Make sure no completion ding occurs.
14. Open ChatGPT **Images**.
15. Request an image.
16. Make sure the first image produces one ding after it completes in its new chat.

## First-response repair

The updated test build keeps the first response active through temporary and saved conversation URLs.
It treats `/c/new` as a new conversation.
It uses Chrome's navigation event type to separate URL creation from Browser Back and Forward.
The detector remembers a new conversation when ChatGPT assigns its temporary URL before the Stop control appears.
It waits up to 12 seconds for a response to start in that history entry.
Later URL replacements in that entry keep the response active.
It also monitors image creation before the Images page changes to a conversation.
Browser Back and Forward still discard the previous conversation's active response.
The tests reproduce these transitions. The browser checks must confirm the actual ChatGPT behavior.

## Local diagnostic report

The report contains detection events and sound results. It contains no chat text, chat URLs, or conversation IDs.
Chat Dinger keeps the last 100 detection events in the tab. A page refresh clears these events.
The **Copy diagnostics** button does not send the report to a server.
The popup build marker is `update-reconnect-1`. The content build marker is `passive-page-4`.
The detector build marker is `creation-history-7`. This build recognizes the current response status, Chinese labels, and primary control icons.

1. If the first response has no ding, keep the ChatGPT tab open.
2. Open Chat Dinger **Settings**.
3. Click **Copy diagnostics**.
4. Paste the report into the support conversation.

If Chrome cannot copy the report, the popup shows the report in a text box.
Copy the selected text from that text box.

## Dashboard

The dashboard uses the existing local totals. Opening it does not reset statistics or change the stored achievement history.
Wait time is the combined duration of responses that produced a ding. Chats that run together each add to this total.
Milestones use those totals. Their display order does not show the date when the user reached them.

1. Open **metrics**.
2. Make sure the dashboard shows the existing wait time and ding count.
3. Click **View all**.
4. Make sure the reached milestones agree with the totals.
5. Click the camera button.
6. Open the downloaded `chat-dinger-snapshot.png`.
7. Make sure the image contains the displayed totals and milestone.

The local preview uses sample totals. Run `node scripts/preview-popup.mjs`, then open `http://127.0.0.1:4318`.
The preview also supports `?scenario=empty`, `?scenario=large`, and `?scenario=error`.
The preview script is excluded from the extension ZIP.

## Soft tap and setup theme — September 29, 2026

The local 2.0.24 package includes Soft tap in setup and Settings.
New installs use Soft tap. Existing users keep their saved sound.
The setup page uses the popup colors, type style, and yellow controls.

All 219 automated tests passed after these changes.
The setup preview played the approved 0.30-second WAV with no media error.
The preview showed no horizontal overflow at a 320-pixel viewport width.
The packaged sound matches the approved listening preview byte for byte.

The preview uses simulated Chrome APIs. It does not test extension installation or ChatGPT response detection.
The live 2.0.24 Chrome test is still pending.
The browser tool blocks automated access to extension management.

The local setup preview is available through `node scripts/preview-onboarding.mjs` at `http://127.0.0.1:4320`.
The preview supports `?scenario=existing` and `?scenario=missing`.
The preview script is excluded from the extension ZIP.

## Release limits

Automated tests use simulated Chrome APIs and page controls.
They check state changes, repair requests, sound failure reports, and owner alert scheduling.
The browser test checks real ChatGPT controls and audible sound on this computer.
A successful browser test does not cover every ChatGPT account or future layout.

The owner alert service still requires deployment and a received test email.
Error reports remain off unless the user enables them.
No scheduled test against a signed-in ChatGPT account is active.
The public selector file remains compatible with version 2.0.21.
