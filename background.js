importScripts('shared.js');

const {
  DEFAULT_SETTINGS,
  SOUND_FILES,
  applyCompletionToMetrics,
  clampVolume,
  normalizeSettings,
  validateSelectorConfig
} = ChatDingerShared;

const CHATGPT_URL_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const SELECTOR_URL = 'https://chatdinger.com/selectors.json';
const SELECTOR_ALARM = 'updateSelectorsAlarm';
const SELECTOR_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const RECOVERY_COOLDOWN_MS = 60 * 1000;
const SELECTOR_FETCH_TIMEOUT_MS = 8000;
const SELECTOR_RESPONSE_LIMIT_BYTES = 32 * 1024;
const UNINSTALL_SURVEY_URL = 'https://chatdinger.com/uninstall/';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const DIAGNOSTIC_URL = 'https://chatdinger.com/api/dinger-health';
// Page UI is disabled while the renderer compatibility repair is tested.
const REVIEW_PROMPT_ENABLED = false;
const REVIEW_THRESHOLD = 7;
const NOTIFICATION_LIFETIME_MS = 7000;
const SOUND_VALUES = Object.freeze(SOUND_FILES.map(sound => sound.value));

let offscreenCreationPromise = null;
let selectorFetchPromise = null;
let selectorRecoveryPromise = null;
let diagnosticPromise = null;
let metricsWriteQueue = Promise.resolve();
let uninstallUrlQueue = Promise.resolve();
const notificationTabs = new Map();
const notificationClearTimers = new Map();
const tabConnections = new Map();

const extensionVersion = chrome.runtime.getManifest().version;
function updateUninstallUrl() {
  uninstallUrlQueue = uninstallUrlQueue.then(async () => {
    let diagnosticsEnabled;
    let lastDetectionFailure;
    try {
      ({ diagnosticsEnabled, lastDetectionFailure } = await chrome.storage.local.get(
        ['diagnosticsEnabled', 'lastDetectionFailure']
      ));
    } catch (_error) {
      // Keep the version-only uninstall page available if local storage is unavailable.
    }
    const url = new URL(UNINSTALL_SURVEY_URL);
    url.searchParams.set('version', extensionVersion);
    const record = lastDetectionFailure;
    const validRecord = diagnosticsEnabled === true
      && isPlainObject(record)
      && HEALTH_CODES.has(record.code)
      && typeof record.selectorRevision === 'string'
      && /^[a-f0-9]{8}$/.test(record.selectorRevision)
      && typeof record.extensionVersion === 'string'
      && /^\d{1,4}(?:\.\d{1,4}){0,3}$/.test(record.extensionVersion)
      && Number.isSafeInteger(record.occurredAt)
      && record.occurredAt > 0
      && record.occurredAt <= Date.now();
    if (validRecord) {
      url.searchParams.set('failure_code', record.code);
      url.searchParams.set('failure_revision', record.selectorRevision);
      url.searchParams.set('failure_version', record.extensionVersion);
      url.searchParams.set('failure_at', String(record.occurredAt));
    }
    await chrome.runtime.setUninstallURL(url.toString());
  }).catch(error => {
    console.error('Chat Dinger: Failed to set the uninstall page.', error);
  });
  return uninstallUrlQueue;
}

updateUninstallUrl();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.diagnosticsEnabled || changes.lastDetectionFailure)) {
    updateUninstallUrl();
  }
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isChatGPTUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com');
  } catch (_error) {
    return false;
  }
}

function isExtensionSender(sender) {
  return sender?.id === chrome.runtime.id
    && (!sender.tab || sender.url === chrome.runtime.getURL('onboarding.html'));
}

function isContentSender(sender) {
  return sender?.id === chrome.runtime.id
    && Number.isInteger(sender.tab?.id)
    && isChatGPTUrl(sender.url || sender.tab.url);
}

async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id || !chrome.storage?.local) {
    return;
  }

  try {
    const { isDevMode } = await chrome.storage.local.get('isDevMode');
    if (!isDevMode) {
      return;
    }
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logger('Chat Dinger:', ...args);
  } catch (error) {
    console.error('Chat Dinger: Failed to read the development flag.', error);
  }
}

async function getSettings() {
  const { chatAlertSettings } = await chrome.storage.local.get('chatAlertSettings');
  return normalizeSettings(chatAlertSettings);
}

async function migrateSettings() {
  const { chatAlertSettings } = await chrome.storage.local.get('chatAlertSettings');
  const settings = normalizeSettings(chatAlertSettings || DEFAULT_SETTINGS);
  await chrome.storage.local.set({ chatAlertSettings: settings });
  return settings;
}

async function setDevelopmentFlag() {
  const isDevMode = !chrome.runtime.getManifest().update_url;
  await chrome.storage.local.set({ isDevMode });
}

function connectChatGPTTab(tabId) {
  if (!tabConnections.has(tabId)) {
    const connection = (async () => {
      const tab = await chrome.tabs.get(tabId);
      if (!isChatGPTUrl(tab.url) || tab.discarded) {
        throw new Error('The ChatGPT tab is not available.');
      }
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['shared.js', 'detector.js', 'content.js'],
        world: 'ISOLATED'
      });
      const status = await chrome.tabs.sendMessage(tabId, { action: 'getStatus' }, { frameId: 0 });
      if (!status?.success) throw new Error('The listener did not answer.');
      return status;
    })().finally(() => tabConnections.delete(tabId));
    tabConnections.set(tabId, connection);
  }
  return tabConnections.get(tabId);
}

async function activateOpenChatGPTTabs() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URL_PATTERNS });
  await Promise.all(tabs.filter(tab => Number.isInteger(tab.id)
    && !tab.discarded && isChatGPTUrl(tab.url)).map(async tab => {
    try {
      await connectChatGPTTab(tab.id);
    } catch (error) {
      // A closed tab or a navigation must not prevent other tabs from starting.
      // The popup can try the connection again if this tab is not available.
      console.warn('Chat Dinger: Could not activate an open ChatGPT tab.', error);
    }
  }));
}

async function handleReconnectTab(message, sender, sendResponse) {
  if (!isExtensionSender(sender) || !Number.isInteger(message.tabId)) {
    sendResponse({ success: false });
    return;
  }
  try {
    sendResponse(await connectChatGPTTab(message.tabId));
  } catch (_error) {
    sendResponse({ success: false, code: 'connection_unavailable' });
  }
}

chrome.runtime.onInstalled.addListener(details => {
  return Promise.all([setDevelopmentFlag(), migrateSettings()])
    .then(async () => {
      setupRemoteSelectorFetching(true);
      // Connect the new extension context to pages that are already open.
      if (details.reason === 'install' || details.reason === 'update') {
        // A failed tab query must not hide the first-install sound test.
        try {
          await activateOpenChatGPTTabs();
        } catch (error) {
          console.warn('Chat Dinger: Could not activate open tabs.', error);
        }
        if (details.reason === 'install') {
          await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
        }
      }
    })
    .catch(error => console.error('Chat Dinger: Extension setup failed.', error));
});

chrome.runtime.onStartup.addListener(() => {
  migrateSettings()
    .then(() => setupRemoteSelectorFetching(true))
    .catch(error => console.error('Chat Dinger: Startup setup failed.', error));
});

async function handleToggleEnabled(sendResponse) {
  try {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await chrome.storage.local.set({ chatAlertSettings: settings });
    sendResponse({ success: true, enabled: settings.enabled });
  } catch (error) {
    console.error('Chat Dinger: Failed to change the alert state.', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some(client => client.url === offscreenUrl);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play a notification sound when the ChatGPT tab is hidden.'
    }).finally(() => {
      offscreenCreationPromise = null;
    });
  }

  await offscreenCreationPromise;
}

async function playSoundInOffscreen(soundFile, volume) {
  if (!SOUND_VALUES.includes(soundFile)) {
    throw new Error('The sound file is not permitted.');
  }

  const request = {
    target: 'offscreen',
    action: 'playOffscreenAudio',
    soundFile,
    volume: clampVolume(volume)
  };
  await ensureOffscreenDocument();
  let response;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch (error) {
    // No receiver means playback did not start. A closed reply port is ambiguous.
    if (!String(error?.message).includes('Receiving end does not exist')) throw error;
    await ensureOffscreenDocument();
    response = await chrome.runtime.sendMessage(request);
  }

  if (response?.success !== true || (response.skipped !== true && response.audioStarted !== true)) {
    throw new Error(response?.error || 'The offscreen player did not start the sound.');
  }
  return response;
}

async function handleTestSound(message, sender, sendResponse) {
  if (!isExtensionSender(sender)) {
    sendResponse({ success: false, error: 'This sender cannot test a sound.' });
    return;
  }

  try {
    const settings = await getSettings();
    const soundFile = SOUND_VALUES.includes(message.soundFile)
      ? message.soundFile
      : settings.selectedSound;
    const volume = message.volume === undefined ? settings.volume : clampVolume(message.volume);
    const result = await playSoundInOffscreen(soundFile, volume);
    if (result.skipped === true) {
      sendResponse({ success: true, skipped: true, skipReason: 'superseded', audioStarted: false,
        status: 'Another sound replaced the test sound.' });
      return;
    }
    sendResponse({ success: true, audioStarted: true, status: 'The test sound started.' });
  } catch (error) {
    console.error('Chat Dinger: The test sound failed.', error);
    sendResponse({ success: false, code: 'audio_failed', audioStarted: false,
      status: 'The test sound failed.', error: error.message });
  }
}

function makeNotificationId(tabId) {
  const sourceTab = Number.isInteger(tabId) ? tabId : 0;
  const nonce = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `chat-dinger-${sourceTab}-${Date.now()}-${nonce}`;
}

function forgetNotification(notificationId) {
  const timeoutId = notificationClearTimers.get(notificationId);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    notificationClearTimers.delete(notificationId);
  }
  notificationTabs.delete(notificationId);
}

function scheduleNotificationClear(notificationId) {
  const timeoutId = setTimeout(async () => {
    notificationClearTimers.delete(notificationId);
    notificationTabs.delete(notificationId);
    try {
      await chrome.notifications.clear(notificationId);
    } catch (error) {
      console.warn('Chat Dinger: Failed to clear an old notification.', error);
    }
  }, NOTIFICATION_LIFETIME_MS);
  notificationClearTimers.set(notificationId, timeoutId);
}

async function createBackgroundNotification(title, message, sourceTabId) {
  const notificationId = makeNotificationId(sourceTabId);
  const options = {
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title,
    message,
    priority: 2,
    silent: true,
    requireInteraction: false
  };

  await chrome.notifications.create(notificationId, options);
  if (Number.isInteger(sourceTabId)) {
    notificationTabs.set(notificationId, sourceTabId);
  }
  scheduleNotificationClear(notificationId);
  return notificationId;
}

// An active tab in a background browser window is still away from the user.
async function isViewingChatGPT(sender) {
  if (!Number.isInteger(sender.tab?.id)) return true;
  try {
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!isChatGPTUrl(tab.url)) return true;
    if (!tab.active) return false;
    const window = await chrome.windows.get(tab.windowId);
    return window.focused === true && window.state !== 'minimized';
  } catch (_error) {
    // Do not show an unexpected desktop notification when focus is unknown.
    return true;
  }
}

async function handleNotificationSound(message, sender, sendResponse) {
  if (!isContentSender(sender) && !isExtensionSender(sender)) {
    sendResponse({ success: false, error: 'This sender cannot play an alert.' });
    return;
  }

  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      sendResponse({ success: true, skipped: true, skipReason: 'disabled', status: 'Alerts are off.' });
      return;
    }

    const viewingChatGPT = await isViewingChatGPT(sender);
    if (viewingChatGPT && !settings.notifyOnActiveTab) {
      sendResponse({ success: true, skipped: true, skipReason: 'active_tab', status: 'Sound is off while you view ChatGPT.' });
      return;
    }
    const audioResult = await playSoundInOffscreen(settings.selectedSound, settings.volume);
    if (audioResult.skipped === true) {
      sendResponse({ success: true, skipped: true, skipReason: 'superseded', audioStarted: false,
        status: 'Another sound replaced the alert sound.' });
      return;
    }
    let notificationId = null;
    let notificationError = null;
    if (settings.showSystemNotification && !await isViewingChatGPT(sender)) {
      const title = typeof message.title === 'string' && message.title.trim()
        ? message.title.trim().slice(0, 80)
        : 'Chat Dinger';
      const body = typeof message.message === 'string' && message.message.trim()
        ? message.message.trim().slice(0, 240)
        : 'Your ChatGPT response is ready.';
      try {
        notificationId = await createBackgroundNotification(title, body, sender.tab?.id);
      } catch (error) {
        notificationError = error.message;
        console.warn('Chat Dinger: The sound played, but the notification failed.', error);
      }
    }

    sendResponse({
      success: true,
      audioStarted: audioResult.success,
      notificationShown: Boolean(notificationId),
      notificationError,
      status: notificationId ? 'The sound and notification started.' : 'The sound started.'
    });
  } catch (error) {
    console.error('Chat Dinger: The alert failed.', error);
    sendResponse({ success: false, code: 'audio_failed', audioStarted: false,
      status: 'The alert failed.', error: error.message });
  }
}

function queueCompletion(message) {
  const duration = Number.isFinite(message.duration)
    && message.duration >= 0
    && message.duration <= 24 * 60 * 60 * 1000
    ? message.duration
    : null;
  const soundFile = SOUND_VALUES.includes(message.soundFile) ? message.soundFile : null;
  const occurredAt = Number.isFinite(message.occurredAt)
    && Math.abs(Date.now() - message.occurredAt) <= 10 * 60 * 1000
    ? message.occurredAt
    : Date.now();

  const operation = metricsWriteQueue
    .catch(error => {
      console.error('Chat Dinger: A previous metrics update failed.', error);
    })
    .then(async () => {
      const stored = await chrome.storage.local.get([
        'dingerMetrics',
        'reviewPromptShown',
        'hasShownPopup'
      ]);
      const metrics = applyCompletionToMetrics(stored.dingerMetrics, {
        duration,
        soundFile,
        occurredAt
      });
      const shouldAskReview = REVIEW_PROMPT_ENABLED && metrics.total >= REVIEW_THRESHOLD
        && stored.reviewPromptShown !== true
        && stored.hasShownPopup !== true;
      const update = { dingerMetrics: metrics };
      if (shouldAskReview) {
        update.reviewPromptShown = true;
        update.hasShownPopup = true;
      }
      await chrome.storage.local.set(update);
      return {
        metrics,
        shouldAskReview
      };
    });

  metricsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function handleRecordCompletion(message, sender, sendResponse) {
  if (!isContentSender(sender)) {
    sendResponse({ success: false, error: 'This sender cannot save a completion.' });
    return;
  }

  try {
    const result = await queueCompletion(message);
    sendResponse({ success: true, ...result });
  } catch (error) {
    console.error('Chat Dinger: Failed to save completion metrics.', error);
    sendResponse({ success: false, error: error.message });
  }
}

function queueDeleteLocalData() {
  const operation = metricsWriteQueue
    .catch(error => {
      console.error('Chat Dinger: A previous metrics update failed.', error);
    })
    .then(async () => {
      const isDevMode = !chrome.runtime.getManifest().update_url;
      const { reviewLinkClicked = false } = await chrome.storage.local.get('reviewLinkClicked');
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        reviewLinkClicked,
        chatAlertSettings: normalizeSettings(DEFAULT_SETTINGS),
        isDevMode
      });
      return { success: true };
    });

  metricsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function handleDeleteLocalData(sender, sendResponse) {
  if (!isExtensionSender(sender)) {
    sendResponse({ success: false, error: 'This sender cannot delete local data.' });
    return;
  }

  try {
    const result = await queueDeleteLocalData();
    const pendingSelectorFetch = selectorFetchPromise;
    if (pendingSelectorFetch) {
      pendingSelectorFetch.finally(() => fetchAndUpdateSelectors());
    } else {
      fetchAndUpdateSelectors();
    }
    sendResponse(result);
  } catch (error) {
    console.error('Chat Dinger: Failed to delete local data.', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSettingsUpdated(message, sender, sendResponse) {
  if (!isExtensionSender(sender) || !isPlainObject(message.settings)) {
    sendResponse({ success: false, error: 'The settings message has an incorrect format.' });
    return;
  }

  try {
    const settings = normalizeSettings(message.settings);
    await chrome.storage.local.set({ chatAlertSettings: settings });
    sendResponse({ success: true, status: 'acknowledged', settings });
  } catch (error) {
    console.error('Chat Dinger: Failed to save settings.', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function readLimitedJson(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error('The selector file is too large.');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new Error('The selector file is too large.');
    }
    return JSON.parse(text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('The selector file is too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function fetchAndUpdateSelectors({ recovery = false } = {}) {
  if (selectorFetchPromise) {
    return selectorFetchPromise;
  }

  selectorFetchPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SELECTOR_FETCH_TIMEOUT_MS);
    try {
      // A time bucket bypasses stale proxy entries without an installation ID.
      const url = recovery ? `${SELECTOR_URL}?refresh=${Math.floor(Date.now() / RECOVERY_COOLDOWN_MS)}` : SELECTOR_URL;
      const response = await fetch(url, {
        cache: recovery ? 'no-store' : 'no-cache',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Selector request failed with HTTP ${response.status}.`);
      }

      const config = validateSelectorConfig(
        await readLimitedJson(response, SELECTOR_RESPONSE_LIMIT_BYTES)
      );
      if (!config) {
        throw new Error('The selector file has an incorrect format.');
      }

      const { customSelectors } = await chrome.storage.local.get('customSelectors');
      const values = { lastSelectorRefresh: Date.now() };
      if (JSON.stringify(customSelectors) !== JSON.stringify(config)) values.customSelectors = config;
      await chrome.storage.local.set(values);
      await logIfDev('log', 'The selector file was updated.', config.version);
      return { success: true, config };
    } catch (error) {
      console.warn('Chat Dinger: Failed to update the selector file.', error);
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timeoutId);
      selectorFetchPromise = null;
    }
  })();

  return selectorFetchPromise;
}

async function handleRefreshSelectors(sender, sendResponse, recovery = false) {
  if (!isContentSender(sender) && !isExtensionSender(sender)) {
    sendResponse({ success: false, error: 'This sender cannot update selectors.' });
    return;
  }

  try {
    if (recovery) {
      if (!selectorRecoveryPromise) {
        selectorRecoveryPromise = (async () => {
          const { lastSelectorRecoveryAttempt = 0 } = await chrome.storage.local.get('lastSelectorRecoveryAttempt');
          const retryAfterMs = Math.max(0, lastSelectorRecoveryAttempt + RECOVERY_COOLDOWN_MS - Date.now());
          if (retryAfterMs) return { success: false, status: 'cooldown', retryAfterMs };
          await chrome.storage.local.set({ lastSelectorRecoveryAttempt: Date.now() });
          // Complete an ordinary fetch before making the recovery request.
          if (selectorFetchPromise) await selectorFetchPromise;
          const result = await fetchAndUpdateSelectors({ recovery: true });
          return { ...result, status: result.success ? 'updated' : 'failed', retryAfterMs: RECOVERY_COOLDOWN_MS };
        })().finally(() => { selectorRecoveryPromise = null; });
      }
      sendResponse(await selectorRecoveryPromise);
      return;
    }
    const { lastSelectorRefresh = 0 } = await chrome.storage.local.get('lastSelectorRefresh');
    if (Date.now() - lastSelectorRefresh < SELECTOR_REFRESH_COOLDOWN_MS) {
      sendResponse({ success: false, status: 'cooldown' });
      return;
    }

    const result = await fetchAndUpdateSelectors();
    sendResponse(result.success
      ? { success: true, status: 'updated' }
      : { success: false, status: 'failed', error: result.error });
  } catch (error) {
    console.error('Chat Dinger: Failed to update selectors.', error);
    sendResponse({ success: false, error: error.message });
  }
}

const HEALTH_STATES = new Set(['checking', 'recovering', 'unavailable', 'ready', 'generating', 'waiting', 'off']);
const HEALTH_CODES = new Set(['controls_missing', 'generation_unconfirmed', 'generation_stalled', 'audio_failed']);

async function handleDetectorHealth(message, sender, sendResponse) {
  if (!isContentSender(sender) || !isPlainObject(message.health)
    || !HEALTH_STATES.has(message.health.state)
    || (message.health.code !== null && !HEALTH_CODES.has(message.health.code))) {
    sendResponse({ success: false });
    return;
  }
  const health = {
    state: message.health.state, code: message.health.code,
    selectorRevision: /^[a-f0-9]{8}$/.test(message.health.selectorRevision) ? message.health.selectorRevision : 'unknown',
    attempts: Math.min(100, Math.max(0, Number(message.health.attempts) || 0)),
    extensionVersion, occurredAt: Date.now()
  };
  try {
    const broken = health.state === 'unavailable';
    // An old in-page mute or the popup switch can leave alerts off. Show it.
    const off = health.state === 'off';
    if (chrome.action) {
      await chrome.action.setBadgeText({ tabId: sender.tab.id, text: broken ? '!' : off ? 'OFF' : '' });
      await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: off ? '#8a8a8a' : '#dc7c42' });
      await chrome.action.setTitle({ tabId: sender.tab.id,
        title: broken ? 'Chat Dinger: alerts need attention' : off ? 'Chat Dinger: alerts are off' : 'Chat Dinger' });
    }
    if (broken) {
      // Store a fixed diagnostic record. Do not accept URLs or page text.
      await chrome.storage.local.set({ lastDetectionFailure: health });
      if (health.attempts >= 2 || health.code === 'audio_failed' || health.code === 'generation_stalled') {
        await reportDetectionFailure(health);
      }
    }
    sendResponse({ success: true });
  } catch (_error) {
    sendResponse({ success: false });
  }
}

function reportDetectionFailure(health) {
  if (diagnosticPromise) return diagnosticPromise;
  diagnosticPromise = (async () => {
    const { diagnosticsEnabled, lastDiagnosticAttempt = 0, lastDiagnosticReport } = await chrome.storage.local.get(
      ['diagnosticsEnabled', 'lastDiagnosticAttempt', 'lastDiagnosticReport']
    );
    if (diagnosticsEnabled !== true) return;
    const key = `${extensionVersion}:${health.code}:${health.selectorRevision}`;
    if (Date.now() - lastDiagnosticAttempt < 15 * 60 * 1000) return;
    if (lastDiagnosticReport?.key === key && Date.now() - lastDiagnosticReport.sentAt < 6 * 60 * 60 * 1000) return;
    await chrome.storage.local.set({ lastDiagnosticAttempt: Date.now() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(DIAGNOSTIC_URL, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ extensionVersion, code: health.code, selectorRevision: health.selectorRevision })
      });
      if (response.status === 202) {
        await chrome.storage.local.set({ lastDiagnosticReport: { key, sentAt: Date.now() } });
      }
    } catch (_error) {
      // A report failure must not stop local recovery.
    } finally {
      clearTimeout(timeout);
    }
  })().catch(() => {}).finally(() => { diagnosticPromise = null; });
  return diagnosticPromise;
}

function setupRemoteSelectorFetching(fetchAtStart = false) {
  chrome.alarms.get(SELECTOR_ALARM)
    .then(alarm => {
      if (!alarm) {
        return chrome.alarms.create(SELECTOR_ALARM, { periodInMinutes: 60 });
      }
      return undefined;
    })
    .catch(error => console.error('Chat Dinger: Failed to set the selector alarm.', error));
  if (fetchAtStart) {
    fetchAndUpdateSelectors();
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SELECTOR_ALARM) {
    fetchAndUpdateSelectors();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') {
    return false;
  }
  if (!isPlainObject(message) || typeof message.action !== 'string') {
    sendResponse({ success: false, error: 'The message has an incorrect format.' });
    return false;
  }

  switch (message.action) {
    case 'reconnectTab':
      handleReconnectTab(message, sender, sendResponse);
      return true;
    case 'toggleMute':
    case 'toggleEnabled':
      if (!isContentSender(sender) && !isExtensionSender(sender)) {
        sendResponse({ success: false, error: 'This sender cannot change the alert state.' });
        return false;
      }
      handleToggleEnabled(sendResponse);
      return true;
    case 'testSound':
      handleTestSound(message, sender, sendResponse);
      return true;
    case 'playNotificationSound':
      handleNotificationSound(message, sender, sendResponse);
      return true;
    case 'recordCompletion':
      handleRecordCompletion(message, sender, sendResponse);
      return true;
    case 'deleteLocalData':
      handleDeleteLocalData(sender, sendResponse);
      return true;
    case 'refreshSelectors':
      handleRefreshSelectors(sender, sendResponse, message.reason === 'recovery');
      return true;
    case 'detectorHealth':
      handleDetectorHealth(message, sender, sendResponse);
      return true;
    case 'settingsUpdated':
      handleSettingsUpdated(message, sender, sendResponse);
      return true;
    default:
      sendResponse({ success: false, error: 'The message action is not known.' });
      return false;
  }
});

function parseNotificationTabId(notificationId) {
  const match = /^chat-dinger-(\d+)-/.exec(notificationId);
  return match ? Number(match[1]) : null;
}

async function focusChatGPTTab(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isChatGPTUrl(tab.url)) {
      return false;
    }
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    return true;
  } catch (_error) {
    return false;
  }
}

chrome.notifications.onClicked.addListener(async notificationId => {
  if (!notificationId.startsWith('chat-dinger-')) {
    return;
  }

  try {
    const mappedTabId = notificationTabs.get(notificationId) || parseNotificationTabId(notificationId);
    if (!await focusChatGPTTab(mappedTabId)) {
      const tabs = await chrome.tabs.query({ url: CHATGPT_URL_PATTERNS });
      const target = tabs.sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
      if (!target || !await focusChatGPTTab(target.id)) {
        await chrome.tabs.create({ url: 'https://chatgpt.com/' });
      }
    }
  } catch (error) {
    console.error('Chat Dinger: Failed to open the source tab.', error);
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  } finally {
    forgetNotification(notificationId);
    chrome.notifications.clear(notificationId).catch(() => {});
  }
});

chrome.notifications.onClosed.addListener(notificationId => {
  forgetNotification(notificationId);
});

setupRemoteSelectorFetching(false);
