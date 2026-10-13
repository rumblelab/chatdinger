(() => {
if (!globalThis.ChatDingerShared) return;
const chrome = globalThis.chrome;
const CONTENT_BUILD = 'passive-page-4';
const INSTANCE_EVENT = 'chat-dinger-context-replaced';
const previousInstance = globalThis.__chatDingerContentInstance;
// A previous extension context can remain in an open page after an update.
if (previousInstance?.build === CONTENT_BUILD && previousInstance.alive()) return;
previousInstance?.dispose();
globalThis.__chatDingerContentLoaded = true;
let disposed = false;

function contextAlive() {
  try {
    if (disposed || !chrome.runtime?.id) return false;
    chrome.runtime.getManifest?.();
    return true;
  } catch { return false; }
}

const Shared = globalThis.ChatDingerShared;
const DEFAULT_SETTINGS = Shared?.DEFAULT_SETTINGS || {
  enabled: true,
  volume: 0.7,
  selectedSound: 'soft-tap.wav',
  notifyOnActiveTab: true,
  showSystemNotification: true,
  markUnreadTab: true
};

const SITE = (() => {
  const hostname = window.location.hostname;
  return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com') || hostname === 'chat.openai.com'
    ? 'CHATGPT'
    : 'UNKNOWN';
})();

const CHATGPT_BUTTON_SELECTORS = [...(globalThis.ChatDingerDetector?.BUTTONS || [])];
const SELECTOR_LIMIT = 12;
const SELECTOR_LENGTH_LIMIT = 240;

let settings = normalizeSettings({});
let currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];
let detector = null;
let generationTimeStart = null;
let completionInFlight = false;
let completionQueue = Promise.resolve();
let audioFailed = false;
const soundEvents = [];
const UNREAD_MARK = '● ';
let unreadMarked = false;
let titleObserver = null;

const instance = { build: CONTENT_BUILD, alive: contextAlive, dispose };
globalThis.__chatDingerContentInstance = instance;
// Only an invalid context handles this event. Page scripts cannot stop a live copy.
function retireInvalidContext() { if (!contextAlive()) dispose(); }
window.dispatchEvent?.(new Event(INSTANCE_EVENT));
window.addEventListener(INSTANCE_EVENT, retireInvalidContext);

function dispose() {
  if (disposed) return;
  disposed = true;
  detector?.stop();
  window.removeEventListener('DOMContentLoaded', init);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('focus', clearUnreadTitle);
  // Restore the title before a new copy of the script takes over.
  clearUnreadTitle();
  window.removeEventListener(INSTANCE_EVENT, retireInvalidContext);
  try { chrome.runtime.onMessage.removeListener?.(onRuntimeMessage); } catch (_error) {}
  try { chrome.storage.onChanged.removeListener?.(onStorageChanged); } catch (_error) {}
  if (globalThis.__chatDingerContentInstance === instance) {
    delete globalThis.__chatDingerContentInstance;
    delete globalThis.__chatDingerContentLoaded;
  }
}

function recordSoundEvent(outcome) {
  soundEvents.push({ at: Date.now(), outcome });
  if (soundEvents.length > 12) soundEvents.shift();
}

function normalizeSettings(rawSettings) {
  if (Shared?.normalizeSettings) return Shared.normalizeSettings(rawSettings);
  return { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
}

async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id || !chrome.storage?.local) return;
  try {
    const { isDevMode } = await chrome.storage.local.get('isDevMode');
    if (!isDevMode) return;
    const logger = console[level] || console.log;
    logger('Chat Dinger:', ...args);
  } catch (error) {
    console.error('Chat Dinger: Failed to check developer mode:', error.message);
  }
}

function isSafeSelector(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > SELECTOR_LENGTH_LIMIT) return false;
  try {
    document.querySelector(value);
    return true;
  } catch {
    return false;
  }
}

function validatedSelectorList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, SELECTOR_LIMIT).filter(isSafeSelector))];
}

function applyCustomSelectors(rawSelectors) {
  const custom = Shared?.validateSelectorConfig?.(rawSelectors);
  if (!custom) {
    currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];
    return;
  }
  const mainButtonSelectors = validatedSelectorList(custom.mainButtonSelectors);
  currentChatGptSelectors = [...new Set([...mainButtonSelectors, ...CHATGPT_BUTTON_SELECTORS])];
}

async function loadState() {
  const result = await chrome.storage.local.get(['chatAlertSettings', 'customSelectors']);
  settings = normalizeSettings(result.chatAlertSettings);
  applyCustomSelectors(result.customSelectors);
}

function markGenerationEnd() {
  if (!generationTimeStart) return 0;
  const duration = Math.max(0, Date.now() - generationTimeStart);
  generationTimeStart = null;
  return duration;
}

async function requestBackgroundNotification() {
  if (!contextAlive()) { dispose(); return false; }
  recordSoundEvent('requested');
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'playNotificationSound',
      title: 'Chat Dinger',
      message: 'Your ChatGPT response is ready.'
    });
    if (response?.success === true && response?.skipped === true) {
      const reason = ['disabled', 'active_tab', 'superseded'].includes(response.skipReason) ? response.skipReason : 'unknown';
      recordSoundEvent(`skipped_${reason}`);
      return false;
    }
    const played = response?.success === true && response.audioStarted === true;
    recordSoundEvent(played ? 'started' : 'failed');
    setAudioFailure(!played);
    return played;
  } catch (error) {
    recordSoundEvent('request_failed');
    console.error('Chat Dinger: Could not request a background alert:', error.message);
    setAudioFailure(true);
    return false;
  }
}

async function playAlert() {
  if (!settings.enabled) { recordSoundEvent('skipped_disabled'); return false; }
  return requestBackgroundNotification();
}

async function recordCompletion(duration, alertPlayed) {
  if (!contextAlive()) return { success: false };
  try {
    return await chrome.runtime.sendMessage({
      action: 'recordCompletion',
      duration,
      soundFile: settings.selectedSound,
      alertPlayed
    });
  } catch (error) {
    console.error('Chat Dinger: Could not record completion:', error.message);
    return { success: false };
  }
}

// Never create, replace, or remove page nodes. ChatGPT is a React app, and an
// earlier version crashed pages in Brave when it inserted nodes. The
// document.title setter removes the title's child nodes and adds a new Text
// node, which can detach a node React holds. So change only the nodeValue of
// the existing Text node. With no title or no Text node, do nothing.
function titleTextNode() {
  const node = document.querySelector('head > title')?.firstChild;
  return node?.nodeType === 3 ? node : null;
}

function applyUnreadMark() {
  const node = titleTextNode();
  if (node && !node.nodeValue.startsWith(UNREAD_MARK)) node.nodeValue = UNREAD_MARK + node.nodeValue;
}

function markUnreadTitle() {
  if (!titleTextNode()) return;
  applyUnreadMark();
  unreadMarked = true;
  if (titleObserver) return;
  // ChatGPT rewrites the title when a conversation gets a name. Put the mark back.
  // The prefix check stops our own change from causing a loop.
  titleObserver = new MutationObserver(() => { if (unreadMarked) applyUnreadMark(); });
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function clearUnreadTitle() {
  unreadMarked = false;
  titleObserver?.disconnect();
  titleObserver = null;
  const node = titleTextNode();
  if (node?.nodeValue.startsWith(UNREAD_MARK)) node.nodeValue = node.nodeValue.slice(UNREAD_MARK.length);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') clearUnreadTitle();
}

// The user is not looking when the tab is hidden or its window has no focus.
function tabUnseen() {
  return document.visibilityState !== 'visible' || !(document.hasFocus?.() ?? true);
}

async function completeGeneration(reason) {
  if (completionInFlight) return;
  completionInFlight = true;
  const duration = markGenerationEnd();
  logIfDev('log', `Generation finished by ${reason}. Duration: ${duration}ms.`);

  try {
    // Mark the title first, so it works even when the sound fails.
    if (settings.enabled && settings.markUnreadTab && tabUnseen()) markUnreadTitle();
    const alertPlayed = await playAlert();
    if (!alertPlayed) return;
    await recordCompletion(duration, alertPlayed);
  } finally {
    completionInFlight = false;
  }
}

// Keep this script read-only with respect to the page DOM. ChatGPT's renderer
// owns the composer child nodes, including nodes used during hydration.
// Alert controls and review links belong in the extension popup.
function currentStatus() {
  detector?.check();
  return { success: true, state: 'checking', ...effectiveHealth(detector?.getStatus()), site: SITE, audioFailed,
    contentBuild: CONTENT_BUILD,
    selectorRevision: Shared.selectorFingerprint(currentChatGptSelectors),
    pageUi: 'popup-only' };
}

function effectiveHealth(health = {}) {
  return audioFailed && settings.enabled
    ? { ...health, state: 'unavailable', code: 'audio_failed' }
    : health;
}

function publishHealth(health = detector?.getStatus()) {
  if (!contextAlive()) { dispose(); return; }
  if (!health) return;
  const effective = effectiveHealth(health);
  try {
    chrome.runtime.sendMessage({ action: 'detectorHealth', health: {
      state: effective.state, code: effective.code, attempts: effective.attempts,
      nextRetryAt: effective.nextRetryAt,
      selectorRevision: Shared.selectorFingerprint(currentChatGptSelectors)
    } }).catch(() => {});
  } catch (_error) {}
}

function setAudioFailure(failed) {
  if (audioFailed === failed) return;
  audioFailed = failed;
  publishHealth();
}

function onRuntimeMessage(message, sender, sendResponse) {
  if (message?.target === 'offscreen') return false;
  if (message?.action === 'getStatus') {
    sendResponse(currentStatus());
    return false;
  }
  if (message?.action === 'getDiagnostics' && sender?.id === chrome.runtime.id && !sender.tab) {
    sendResponse({ success: true, status: currentStatus(),
      detector: detector?.getDiagnostics?.() || null,
      sound: { enabled: settings.enabled, notifyOnActiveTab: settings.notifyOnActiveTab,
        volume: settings.volume, failed: audioFailed, events: soundEvents.map(event => ({ ...event })) } });
    return false;
  }
  if (message?.action === 'setAudioHealth' && sender?.id === chrome.runtime.id
    && !sender.tab && typeof message.failed === 'boolean') {
    setAudioFailure(message.failed);
    sendResponse(currentStatus());
    return false;
  }
  if (message?.action === 'recoverDetection' && sender?.id === chrome.runtime.id) {
    if (!detector) {
      sendResponse({ success: false });
      return false;
    }
    detector.recover({ manual: true }).then(() => sendResponse(currentStatus()), () => sendResponse({ success: false }));
    return true;
  }
  return false;
}
chrome.runtime.onMessage.addListener(onRuntimeMessage);

function onStorageChanged(changes, namespace) {
  if (namespace !== 'local') return;
  if (changes.chatAlertSettings) {
    settings = normalizeSettings(changes.chatAlertSettings.newValue);
    detector?.setEnabled(settings.enabled);
    if (!settings.enabled || !settings.markUnreadTab) clearUnreadTitle();
  }
  if (changes.customSelectors) {
    applyCustomSelectors(changes.customSelectors.newValue);
    detector?.setSelectors(currentChatGptSelectors);
    detector?.check();
  }
}
chrome.storage.onChanged.addListener(onStorageChanged);

async function init() {
  if (!contextAlive()) return;
  if (SITE !== 'CHATGPT') return;
  if (!Shared?.getChatGPTButtonState || !Shared?.normalizeSettings || !globalThis.ChatDingerDetector) {
    console.error('Chat Dinger: The shared API did not load.');
    return;
  }
  try {
    await loadState();
  } catch (error) {
    console.error('Chat Dinger: Could not load settings:', error.message);
  }
  if (!contextAlive()) return;
  detector = globalThis.ChatDingerDetector.create({
    document, window, getButtonState: Shared.getChatGPTButtonState,
    refresh: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'refreshSelectors', reason: 'recovery' });
      if (result?.config) {
        applyCustomSelectors(result.config);
      }
      return result;
    },
    onHealth: publishHealth,
    onComplete: duration => {
      completionQueue = completionQueue.catch(() => {}).then(() => {
        if (!contextAlive()) return;
        generationTimeStart = Date.now() - duration;
        return completeGeneration('response controls returned to idle');
      }).catch(() => {});
    }
  });
  detector.setSelectors(currentChatGptSelectors);
  detector.setEnabled(settings.enabled);
  detector.start();
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', clearUnreadTitle);
}

function onPageHide() {
  detector?.stop();
}

function onPageShow(event) {
  if (!event.persisted || !contextAlive()) return;
  detector?.start();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

})();
