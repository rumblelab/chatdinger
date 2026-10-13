# Chat Dinger 🔔

Chat Dinger gives you a sound alert when ChatGPT finishes a response or image. Switch tabs and return when your result is ready.

[Install Chat Dinger from the Chrome Web Store](https://chromewebstore.google.com/detail/chat-dinger-chatgpt-notif/kkpdpkhnioiapldpimpdlleonejkkddb).

## Features

- Plays one of nine sounds when a response ends.
- Works when the ChatGPT tab is hidden.
- Starts in existing ChatGPT tabs after installation or an extension update, without a page refresh.
- Opens a sound setup page on the first install, with a playback test and ChatGPT status.
- Keeps the alert switch in the extension popup, outside the ChatGPT page.
- Can show a desktop notification when the ChatGPT tab or window is not in the foreground.
- Lets users choose whether sound also plays while they view ChatGPT.
- Keeps the review link in the extension popup.
- Shows total wait time, total dings, and milestones from local statistics.
- Saves a metrics snapshot as a PNG when the user clicks the camera button.
- Gets a small selector file from `chatdinger.com` when the ChatGPT interface changes.
- Tries to repair detection when ChatGPT controls change.
- Shows the connection state and the next repair time in the popup.
- Offers optional error reports with no chat text.

## Privacy

Chat Dinger does not read or send prompt text or response text. It keeps settings and statistics in Chrome local storage.

The extension gets `https://chatdinger.com/selectors.json` about once each hour. Read [PRIVACY.md](PRIVACY.md) for the full data record.

## Detection and repair

Chat Dinger checks control attributes, primary control icons, and image progress controls. It observes page changes and checks again each second.
A ding needs an observed response start and a known idle state that lasts 900 milliseconds.
Missing controls, brief idle states, and a user Stop action do not cause a ding.
Selector updates keep the current response state.
The first response keeps its state when ChatGPT assigns a conversation URL.
Version 2.0.28 also recognizes `/uc/` chats and the initial history push that keeps the home pathname unchanged.
The detector preserves that first push during conversation creation. Later navigation still discards the previous response.
Image creation can start on Images before the new conversation opens.

After 12 seconds without usable controls, Chat Dinger requests fresh selectors and checks again.
Failed repairs cause more attempts, with increasing delays up to 15 minutes.
The background service limits repair requests across all tabs to one each minute.
The popup can request a repair without a page refresh. A missing extension connection has a separate **Reconnect** action.
Version 2.0.28 connects open tabs after an update. It uses the existing `scripting` permission.
It also recognizes the `Send` button used by ChatGPT temporary chats.
It recognizes Traditional Chinese and Simplified Chinese Send, Stop, and Voice labels.
Known primary control icons identify Send, Stop, and Voice without an English label.
Unknown icons do not establish an idle state. A new icon can require an extension update.
The current conversation's latest response status provides another signal without a language label.
An active response status prevents an early ding if the primary control returns to idle.
The detector ignores response status controls in older turns and outside the conversation.
Version 2.0.27 does not add controls, styles, or review dialogs to ChatGPT.
The content script reads the page and sends extension messages. It does not change the page DOM.
This removes a possible conflict with ChatGPT's page renderer.
The user confirmed that ChatGPT stayed visible in Brave with version 2.0.27 enabled.
Version 2.0.28 passed user-reported Brave checks for a text response, Stop without a false ding, and image generation in a background tab.
The user also confirmed a completion sound in a normal Brave chat with the Traditional Chinese interface after a tab change.
The user then reported success in a Chrome Temporary Chat with the Traditional Chinese interface.
The user also reported success after an extension reload without a chat refresh, followed by Chrome image generation in a background tab.
A direct Chrome Web Store update from version 2.0.23 remains untested.
A page refresh is necessary to clear a page that a previous version broke.

After 30 minutes of continued response activity, Chat Dinger shows that it cannot confirm completion.
It continues to monitor the response and request selector repairs. The time limit does not cause a ding.
The current tab shows a sound failure until a sound starts successfully. The popup offers a **Test sound** action.
The extension requires a playback-start confirmation before it records a ding.
It retries once when Chrome reports that the audio receiver does not exist.
It does not retry an ambiguous closed reply port, because playback might have started.
Muted alerts and alerts suppressed by the active-tab setting do not cause sound warnings.

These checks reduce dependence on one selector. A new ChatGPT layout can still need a selector or extension update.
The detector does not read chat text or intercept ChatGPT network requests.

Read [SELECTOR_UPDATES.md](SELECTOR_UPDATES.md) for selector repairs.
Read [the alert service guide](services/health-alerts/README.md) for owner email alerts.
The alert service is separate from the website and requires deployment.

## Install from source

1. Install Chrome 116+.

2. Clone this repository.

3. Open `chrome://extensions`.

4. Set **Developer mode** to on.

5. Click **Load unpacked**.

6. Select this repository folder.

## Checks

1. Install Node.js 20+.

2. Run `npm ci`.

3. Run `npm run check`.

The check command checks JavaScript syntax, the manifest, release files, and unit tests. The project uses no npm run-time packages.

## Make a store ZIP

1. Set the same version in `manifest.json`, `package.json`, and `package-lock.json`.

2. Run `npm run package`.

3. Get the ZIP from `dist/`.

The package command runs the full checks before ZIP creation. A failed check stops ZIP creation.
The package tests compare the archived scripts with the source files.

The Chrome Web Store update must include the new ZIP. A source change does not update installed extensions.
Read [TESTING.md](TESTING.md) for the browser test before release.

## Media rights

Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before a public release. Record the source and license for each sound and image.

## Contributing

Open an issue for a defect or a feature request. You can also send a pull request with tests.

## License

The source code uses the [MIT License](LICENSE). Media files can have different terms.
