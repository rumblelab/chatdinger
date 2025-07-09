console.log('Chat Dinger: Content script loaded. By discofish.');

let soundPlayCount = 0;
let hasShownPopup = false;
const askThreshold = 7;
let lastUserInteraction = 0;

let settings = {
  enabled: true,
  volume: 0.7,
  selectedSound: 'cryptic.wav'
};
let canPlayAlertSound = true;

let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true;
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;

const SITE = (() => {
  const hostname = window.location.hostname;
  if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
    return 'CHATGPT';
  }
  return 'UNKNOWN';
})();

// Logging utility
async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id||!chrome.storage?.local) {
    // The context has been invalidated, so we can't use any chrome.* APIs.
    // Silently return to prevent the error.
    return;
  }
  try {
    const { isDevMode } = await chrome.storage.local.get(['isDevMode']);
    if (isDevMode) {
      switch (level) {
        case 'log':
          console.log('Chat Dinger:', ...args);
          break;
        case 'warn':
          console.warn('Chat Dinger:', ...args);
          break;
        case 'error':
          console.error('Chat Dinger:', ...args);
          break;
      }
    }
  } catch (e) {
    console.error('Chat Dinger: Failed to check dev mode for logging:', e.message);
  }
}

function resetDingerStateForTesting() {
  logIfDev('log', 'Resetting Chat Dinger state...');
  soundPlayCount = 0;
  hasShownPopup = false;
  saveSoundCount().then(() => {
    logIfDev('log', 'Chat Dinger state has been reset. The popup will show on the next alert (after threshold is met).');
  });
}

window.addEventListener('run_dinger_test', () => {
  logIfDev('log', 'Test event received. Running alert.');
  playAlert();
});

window.addEventListener('run_dinger_reset', () => {
  logIfDev('log', 'Reset event received. Resetting state.');
  resetDingerStateForTesting();
});

async function loadSoundCount() {
  try {
    const result = await chrome.storage.local.get(['soundPlayCount', 'hasShownPopup']);
    soundPlayCount = result.soundPlayCount || 0;
    hasShownPopup = result.hasShownPopup || false;
    await logIfDev('log', `Loaded sound count: ${soundPlayCount}, hasShownPopup: ${hasShownPopup}`);
  } catch (error) {
    console.error('Chat Dinger: Failed to load sound count:', error);
  }
}

async function saveSoundCount() {
  try {
    if (!chrome.runtime?.id) {
      await logIfDev('warn', 'Extension context invalidated, cannot save sound count');
      return false;
    }
    await chrome.storage.local.set({
      soundPlayCount: soundPlayCount,
      hasShownPopup: hasShownPopup
    });
    await logIfDev('log', `Saved sound count: ${soundPlayCount}, hasShownPopup: ${hasShownPopup}`);
    return true;
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      // The context is gone, so don't use a Chrome API-dependent logger.
      // A simple console.warn is safe.
      console.warn('Chat Dinger: Could not save sound count, context was invalidated.');
      return false;
    }
    console.error('Chat Dinger: Failed to save sound count:', error);
    return false;
}
}

function showThanksPopup() {
  const overlay = document.createElement('div');
  overlay.id = 'chat-dinger-popup-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.7); z-index: 10001; display: flex;
    align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  const popup = document.createElement('div');
  popup.style.cssText = `
    background: white; border-radius: 12px; padding: 24px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3); max-width: 400px;
    text-align: center; position: relative; animation: slideIn 0.3s ease-out;
  `;
  const style = document.createElement('style');
  style.textContent = `@keyframes slideIn { from { transform: translateY(-50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
  document.head.appendChild(style);
  popup.innerHTML = `
    <div style="margin-bottom: 16px;">
      <div style="font-size: 48px; margin-bottom: 8px;"></div>
      <h2 style="margin: 0; color: #333; font-size: 20px;">Quick deal?</h2>
      <p style="color: #666; margin: 16px 0; line-height: 1.4;">
        No more annoying popups. Just a simple handshake between us.
      </p>
      <img style="display: block; margin: 0 auto 16px; width: 100%; max-width: 200px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
      <p style="color: #666; margin: 16px 0; line-height: 1.4;">
        Tell one friend about ChatDinger. That’s it. Do that, and I’ll never bug you with another popup again.
      </p>
    </div>
    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
      <button id="deal" style="background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">🤝 Deal</button>
    </div>
    <p style="color: #666; margin: 16px 0; line-height: 1.4; font-size: 10px">
      This is your one and only popup. You’ll still hear the ding, but you might hear guilt if you don’t share. 😉
    </p>
  `;
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  const dealButton = popup.querySelector('#deal');
  if (dealButton) {
    dealButton.addEventListener('click', () => {
      hasShownPopup = true;
      saveSoundCount();
      overlay.remove();
      document.head.removeChild(style);
    });
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); document.head.removeChild(style); }
  });
  const handleEscape = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handleEscape); document.head.removeChild(style); }
  };
  document.addEventListener('keydown', handleEscape);
}

async function loadSettings() {
  try {
    if (!chrome.runtime?.id) { return; }
    const result = await chrome.storage.local.get(['chatAlertSettings', 'customSelectors']);
    if (result.chatAlertSettings) {
      settings = { ...settings, ...result.chatAlertSettings };
    }
    if (result.customSelectors && result.customSelectors.length > 0) {
      currentChatGptSelectors = result.customSelectors;
    } else {
      currentChatGptSelectors = [...DEFAULT_CHATGPT_SELECTORS];
    }
    await logIfDev('log', 'Loaded settings:', settings, 'Selectors:', currentChatGptSelectors);
  } catch (error) {
    if (!error.message.includes('Extension context invalidated')) {
      console.error('Chat Dinger: Failed to load settings:', error);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!chrome.runtime?.id) {
    sendResponse({ status: 'Extension context invalidated', success: false });
    return false;
  }
  logIfDev('log', 'Received message:', message);
  switch (message.action) {
    case 'settingsUpdated':
      settings = { ...settings, ...message.settings };
      logIfDev('log', 'Settings updated:', settings);
      sendResponse({ status: 'Settings updated in content script', success: true });
      break;
    case 'testSound':
      logIfDev('log', 'Processing testSound message');
      playSound(message.soundFile || settings.selectedSound, message.volume || settings.volume, true)
        .then(success => sendResponse({ status: success ? 'Test sound processed by content script' : 'Test sound failed in content script', success }))
        .catch(error => sendResponse({ status: 'Test sound error in content script', success: false, error: error.message }));
      return true;
    default:
      sendResponse({ status: 'Unknown action in content script', success: false });
  }
  return true;
});

function trackUserInteraction() {
  lastUserInteraction = Date.now();
  logIfDev('log', 'User interaction detected');
}

['click', 'keydown', 'touchstart', 'mousedown'].forEach(eventType => {
  document.addEventListener(eventType, trackUserInteraction, { passive: true, capture: true });
});

async function playAudioFile(soundFile, volume) {
  try {
    if (!chrome.runtime?.id) {
      await logIfDev('warn', 'Extension context invalidated');
      return false;
    }
    const soundUrl = chrome.runtime.getURL(`sounds/${soundFile}`);
    await logIfDev('log', `Playing sound: ${soundUrl}`);
    if (!soundUrl) {
      console.error('Chat Dinger: Could not get URL for sound file:', soundFile);
      return false;
    }
    const audio = new Audio(soundUrl);
    audio.volume = Math.min(Math.max(0, parseFloat(volume) || 0.7), 1.0);
    audio.preload = 'auto';
    if (Date.now() - lastUserInteraction > 10000) {
      await logIfDev('warn', 'No recent user interaction, HTML5 audio play might be blocked.');
    }
    await audio.play();
    await logIfDev('log', 'Audio played successfully');
    return true;
  } catch (e) {
    console.error(`Chat Dinger: HTML5 Audio file playback failed for ${soundFile}: ${e.message} (Name: ${e.name})`);
    return false;
  }
}

async function requestBackgroundNotification(title, messageText) {
  if (!chrome.runtime?.id) {
    await logIfDev('warn', 'Cannot request background notification, extension context invalid.');
    return false;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'playNotificationSound',
      title: title,
      message: messageText
    });
    await logIfDev('log', 'Background notification response:', response);
    return response?.success || false;
  } catch (e) {
    if (!e.message.includes("Could not establish connection")) {
      console.error("Chat Dinger: Error messaging background for notification:", e);
    } else {
      await logIfDev('warn', 'Could not connect to background for notification. It might be restarting.');
    }
    return false;
  }
}

async function playSound(soundFile = null, volume = null, isTest = false) {
  await logIfDev('log', `playSound: soundFile=${soundFile || settings.selectedSound}, volume=${volume || settings.volume}, isTest=${isTest}, document.hidden=${document.hidden}`);
  if (!settings.notifyOnActiveTab && !document.hidden && !isTest) {
    await logIfDev('log', 'Skipping sound due to active tab setting');
    return;
  }
  const selectedSoundSetting = soundFile || settings.selectedSound;
  const audioVolume = volume !== null ? volume : settings.volume;
  let effectiveSoundFile = selectedSoundSetting;

  if (selectedSoundSetting === 'coin' && !selectedSoundSetting.endsWith('.wav')) effectiveSoundFile = 'cryptic.wav';
  
  if (!effectiveSoundFile || typeof effectiveSoundFile !== 'string' || !effectiveSoundFile.includes('.')) {
    console.error('Chat Dinger: Invalid sound file, using cryptic.wav:', effectiveSoundFile);
    effectiveSoundFile = 'cryptic.wav';
  }

  if (document.hidden || document.visibilityState !== 'visible') {
    await logIfDev('log', 'Requesting background notification due to hidden tab');
    return await requestBackgroundNotification('ChatDinger', `Your ChatGPT response is ready!`);
  }

  const audioPlayedInPage = await playAudioFile(effectiveSoundFile, audioVolume);
  if (audioPlayedInPage) {
    return true;
  }

  await logIfDev('warn', `In-page audio failed for ${effectiveSoundFile} (page visible). Using background notification fallback.`);
  return await requestBackgroundNotification('Chat Dinger', `Response ready! (Sound: ${effectiveSoundFile.split('.')[0]})`);
}

async function playAlert() {
  await logIfDev('log', `playAlert: enabled=${settings.enabled}, notifyOnActiveTab=${settings.notifyOnActiveTab}, document.hidden=${document.hidden}, canPlayAlertSound=${canPlayAlertSound}`);
  if (!settings.enabled) {
    await logIfDev('log', 'Alerts disabled');
    return;
  }
  if (!settings.notifyOnActiveTab && !document.hidden) {
    await logIfDev('log', 'Not notifying on active tab');
    return;
  }
  if (!canPlayAlertSound) {
    await logIfDev('log', 'Cannot play alert due to cooldown');
    return;
  }
  canPlayAlertSound = false;

  const soundPlayed = await playSound();
  await logIfDev('log', `playAlert: soundPlayed=${soundPlayed}`);

  if (soundPlayed) {
    soundPlayCount++;
    await logIfDev('log', `Sound play count: ${soundPlayCount}`);
    if (soundPlayCount >= askThreshold && !hasShownPopup) {
      await logIfDev('log', 'Showing thanks popup');
      setTimeout(showThanksPopup, 1000);
    }
    if (soundPlayCount % 3 === 0 || soundPlayed) {
      await saveSoundCount();
    }
  } else {
    await logIfDev('warn', 'All sound playing methods seemed to fail for this alert.');
  }
  setTimeout(() => {
    canPlayAlertSound = true;
    logIfDev('log', 'canPlayAlertSound reset to true');
  }, 2000);
}

const DEFAULT_CHATGPT_SELECTORS = [
  'button[data-testid$="send-button"]',
  'button[data-testid$="stop-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]:has(svg)',
  'button[aria-label="Stop streaming"]:has(svg)',
  'button[aria-label="Cancel generation"]:has(svg)' // Added for robustness
];

let currentChatGptSelectors = [...DEFAULT_CHATGPT_SELECTORS];

function getChatGPTButtonState(button) {
  if (!button || !button.getAttribute) {
    logIfDev('log', 'No button or invalid button');
    return { isGenerating: false, ariaLabel: '', textContent: '', isDisabled: true, hasSendIndicator: false, hasStopIndicator: false };
  }
  const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
  const textContent = (button.textContent || '').toLowerCase().trim();
  const isDisabled = button.disabled;
  const hasStopIndicator = ['stop', 'cancel', 'interrupt', 'cancel generation'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword));
  const hasSendIndicator = ['send', 'submit', 'prompt'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword));
  const isGenerating = hasStopIndicator || (isDisabled && !hasSendIndicator);
  logIfDev('log', `Button state: ariaLabel=${ariaLabel}, textContent=${textContent}, isDisabled=${isDisabled}, hasStopIndicator=${hasStopIndicator}, hasSendIndicator=${hasSendIndicator}, isGenerating=${isGenerating}`);
  return { isGenerating, ariaLabel, textContent, isDisabled, hasSendIndicator, hasStopIndicator, svgPathData: '' };
}

function processChatGPTButtonState(buttonElement) {
  const currentState = getChatGPTButtonState(buttonElement);
  logIfDev('log', `Processing state: firstCheck=${chatgptFirstGenerationCheck}, wasGenerating=${chatgptIsGenerating}, nowGenerating=${currentState.isGenerating}`);
  if (chatgptFirstGenerationCheck && !currentState.isGenerating && chatgptIsGenerating) {
    logIfDev('log', 'Triggering alert (first check case)');
    playAlert();
    chatgptFirstGenerationCheck = false;
  } else if (!chatgptFirstGenerationCheck && chatgptIsGenerating && !currentState.isGenerating) {
    logIfDev('log', 'Triggering alert (state transition case)');
    playAlert();
  } else if (chatgptFirstGenerationCheck && currentState.isGenerating) {
    logIfDev('log', 'Setting first check to false (initially generating)');
    chatgptFirstGenerationCheck = false;
  } else if (!chatgptIsGenerating && currentState.isGenerating) {
    logIfDev('log', 'Setting first check to false (started generating)');
    chatgptFirstGenerationCheck = false;
  }
  chatgptIsGenerating = currentState.isGenerating;
}

function addChatGPTClickListener(button) {
  if (!button || button.dataset.chatgptListener === 'true') return;
  button.dataset.chatgptListener = 'true';
  button.addEventListener('click', trackUserInteraction, { passive: true });
}

function cleanupChatGPTObservers() {
  if (chatgptAttributeChangeObserver) chatgptAttributeChangeObserver.disconnect();
  if (chatgptButtonRemovedObserver) chatgptButtonRemovedObserver.disconnect();
  chatgptAttributeChangeObserver = null;
  chatgptButtonRemovedObserver = null;
}

function handleChatGPTButtonRemoved() {
  logIfDev('log', `Button removed, was generating: ${chatgptIsGenerating}`);
  if (chatgptIsGenerating) playAlert();
  cleanupChatGPTObservers();
  chatgptButtonInstance = null;
  chatgptIsGenerating = false;
  chatgptFirstGenerationCheck = true;
  observeForChatGPTButton();
}

function startMonitoringChatGPTButton(button) {
  if (!button) {
    observeForChatGPTButton();
    return;
  }
  if (chatgptButtonInstance === button && chatgptAttributeChangeObserver) return;
  cleanupChatGPTObservers();
  chatgptButtonInstance = button;
  addChatGPTClickListener(button);
  chatgptFirstGenerationCheck = true;
  const initialState = getChatGPTButtonState(chatgptButtonInstance);
  chatgptIsGenerating = initialState.isGenerating;
  if (chatgptIsGenerating) chatgptFirstGenerationCheck = false;
  chatgptAttributeChangeObserver = new MutationObserver(() => {
    if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
      processChatGPTButtonState(chatgptButtonInstance);
    }
  });
  chatgptAttributeChangeObserver.observe(chatgptButtonInstance, { attributes: true, childList: true, subtree: true, characterData: true });
  const parentElement = chatgptButtonInstance.parentElement;
  if (parentElement) {
    chatgptButtonRemovedObserver = new MutationObserver(() => {
      if (!document.contains(chatgptButtonInstance)) handleChatGPTButtonRemoved();
    });
    chatgptButtonRemovedObserver.observe(parentElement, { childList: true });
  }
}

function findChatGPTButton() {
  for (const selector of currentChatGptSelectors) {
    logIfDev('log', `Trying selector: ${selector}`);
    let buttons;
    try {
      buttons = document.querySelectorAll(selector);
      logIfDev('log', `Found ${buttons.length} buttons for ${selector}`);
    } catch {
      logIfDev('error', `Selector ${selector} failed`);
      continue;
    }
    if (!buttons.length) continue;
    for (const button of buttons) {
      logIfDev('log', `Checking button visibility: ${button.outerHTML}`);
      if (button.offsetWidth && button.offsetHeight) {
        logIfDev('log', `Visible button found: ${selector}`);
        return button;
      }
    }
  }
  logIfDev('log', 'No visible button found');
  return null;
}

function observeForChatGPTButton() {
  if (chatgptInitialButtonFinderObserver) chatgptInitialButtonFinderObserver.disconnect();
  const button = findChatGPTButton();
  if (button) {
    startMonitoringChatGPTButton(button);
    return;
  }
  chatgptInitialButtonFinderObserver = new MutationObserver(() => {
    const foundButton = findChatGPTButton();
    if (foundButton) {
      if (chatgptInitialButtonFinderObserver) chatgptInitialButtonFinderObserver.disconnect();
      chatgptInitialButtonFinderObserver = null;
      startMonitoringChatGPTButton(foundButton);
    }
  });
  chatgptInitialButtonFinderObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function startChatGPTMaintenance() {
  setInterval(() => {
    logIfDev('log', 'Checking for button presence');
    if (!chatgptButtonInstance || !document.contains(chatgptButtonInstance)) {
      observeForChatGPTButton();
    }
  }, 7000);
}

async function init() {
  logIfDev('log', `Initializing Chat Dinger, SITE=${SITE}, readyState=${document.readyState}`);
  if (SITE === 'UNKNOWN') {
    logIfDev('log', 'Not a ChatGPT page, exiting');
    return;
  }
  await loadSettings();
  await loadSoundCount();
  if (SITE === 'CHATGPT') {
    logIfDev('log', 'Starting button observation');
    observeForChatGPTButton();
    startChatGPTMaintenance();
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  logIfDev('log', 'Waiting for DOMContentLoaded');
  window.addEventListener('DOMContentLoaded', init);
}