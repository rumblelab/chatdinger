console.log('Chat Dinger: Content script loaded. By discofish.');

// ===== GLOBAL VARIABLES =====
let soundPlayCount = 0;
let hasShownPopup = false;
const askThreshold = 7;
let lastUserInteraction = 0;

let settings = {
  enabled: true,
  isMuted: false, // Dedicated property for the mute button
  volume: 0.7,
  selectedSound: 'cryptic.wav',
  notifyOnActiveTab: true,
  enableNotifications: true,
};

let canPlayAlertSound = true;

// Button monitoring variables
let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true;
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;

// Global generation tracking (for GPT-5 Pro / thinking pane behaviour)
let globalGenerationObserver = null;
let lastGenerationStartTime = 0;
const MIN_GENERATION_DURATION_MS = 1500;

// Composer mute toggle variables
let composerMuteToggle = null;
let composerObserver = null;

// ===== SITE DETECTION =====
const SITE = (() => {
  const hostname = window.location.hostname;
  if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
    return 'CHATGPT';
  }
  return 'UNKNOWN';
})();

// ===== SELECTORS =====
const CHATGPT_BUTTON_SELECTORS = [
  '#composer-submit-button',
  'button[data-testid$="send-button"]',
  'button[data-testid$="stop-button"]'
];

let currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];

// ===== UTILITY FUNCTIONS =====
async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id || !chrome.storage?.local) {
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

function trackUserInteraction() {
  lastUserInteraction = Date.now();
  logIfDev('log', 'User interaction detected');
}

// ===== STORAGE FUNCTIONS =====
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
      console.warn('Chat Dinger: Could not save sound count, context was invalidated.');
      return false;
    }
    console.error('Chat Dinger: Failed to save sound count:', error);
    return false;
  }
}

async function loadSettings() {
  try {
    if (!chrome.runtime?.id) { return; }
    const result = await chrome.storage.local.get(['chatAlertSettings', 'customSelectors']);
    
    if (result.chatAlertSettings) {
      settings = { ...settings, ...result.chatAlertSettings };
    }
    
    if (result.customSelectors && result.customSelectors.length > 0) {
      currentChatGptSelectors = [...result.customSelectors, ...CHATGPT_BUTTON_SELECTORS];
    } else {
      currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];
    }
    
    await logIfDev('log', 'Loaded settings:', settings);
  } catch (error) {
    if (!error.message.includes('Extension context invalidated')) {
      console.error('Chat Dinger: Failed to load settings:', error);
    }
  }
}

// ===== POPUP FUNCTIONS =====
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
      <h2 style="margin: 0; color: #333; font-size: 20px;">Quick deal?</h2>
      <p style="color: #666; margin: 16px 0; line-height: 1.4;">
        No more annoying popups. Just a simple handshake between us.
      </p>
      <img style="display: block; margin: 0 auto 16px; width: 100%; max-width: 200px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
      <p style="color: #666; margin: 16px 0; line-height: 1.4;">
        Tell one friend about ChatDinger. That's it. Do that, and I'll never bug you with another popup again.
      </p>
    </div>
    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
      <button id="deal" style="background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">🤝 Deal</button>
    </div>
    <p style="color: #666; margin: 16px 0; line-height: 1.4; font-size: 10px">
      This is your one and only popup. You'll still hear the ding, but you might hear guilt if you don't share. 😉
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

// ===== AUDIO FUNCTIONS =====
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
    console.error(`Chat Dinger: HTML5 Audio file playback failed for ${soundFile}: ${e.message}`);
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

  if (selectedSoundSetting === 'coin' && !selectedSoundSetting.endsWith('.wav')) {
    effectiveSoundFile = 'cryptic.wav';
  }
  
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

  await logIfDev('warn', `In-page audio failed for ${effectiveSoundFile}. Using background notification fallback.`);
  return await requestBackgroundNotification('Chat Dinger', `Response ready! (Sound: ${effectiveSoundFile.split('.')[0]})`);
}

async function playAlert() {
  await logIfDev('log', `playAlert: enabled=${settings.enabled}, isMuted=${settings.isMuted}, canPlayAlertSound=${canPlayAlertSound}`);
  
  if (!settings.enabled || settings.isMuted) {
    await logIfDev('log', 'Alerts disabled or muted');
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
    
    if (soundPlayCount % 3 === 0) {
      await saveSoundCount();
    }
  } else {
    await logIfDev('warn', 'Sound playing failed for this alert.');
  }
  
  setTimeout(() => {
    canPlayAlertSound = true;
    logIfDev('log', 'canPlayAlertSound reset to true');
  }, 2000);
}

// ===== GLOBAL GENERATION / GPT-5 PRO HELPERS =====
//
// GPT-5 Pro briefly turns the composer send button into a Stop button, then
// replaces it with a "Use voice mode" button while the real Stop control
// moves into the side "thinking" pane. To avoid a false "done" ding after
// ~1 second, we treat generation as in-progress if EITHER the main composer
// indicates it OR a visible thinking-pane Stop button exists.

/**
 * Heuristic to decide if a button is the GPT-5 Pro thinking-pane Stop button.
 * Uses text content, icon path and standard ChatGPT button classes.
 */
function isThinkingStopButton(button) {
  if (!button || button.tagName !== 'BUTTON') return false;
  if (!(button.offsetWidth > 0 && button.offsetHeight > 0)) return false;

  const text = (button.textContent || '').trim();
  const hasStopText = /\bstop\b/i.test(text);

  const pathEl = button.querySelector('svg path');
  const d = pathEl ? (pathEl.getAttribute('d') || '') : '';
  // Square stop icon path observed in GPT-5 Pro thinking pane.
  const looksLikeSquareStop = d.startsWith('M4.5 5.75C4.5 5.05964 5.05964 4.5');

  const cls = button.className || '';
  const hasBtnClass = cls.includes('btn') && cls.includes('btn-secondary') && cls.includes('flex');

  return hasStopText && (looksLikeSquareStop || hasBtnClass);
}

/**
 * Finds a visible "Stop" button in the Pro thinking pane (or similar UI).
 */
function findThinkingStopButton() {
  try {
    // Narrow first: common ChatGPT button styling
    const candidates = document.querySelectorAll('button.btn.btn-secondary, button');
    for (const btn of candidates) {
      if (isThinkingStopButton(btn)) {
        return btn;
      }
    }
  } catch (error) {
    logIfDev('error', 'Error while scanning for thinking Stop button', error);
  }
  return null;
}

/**
 * Returns the combined "generation in progress" state considering both the
 * main composer button and any global thinking-pane Stop controls.
 */
function getGlobalGenerationState(buttonElement) {
  const buttonState = buttonElement
    ? getChatGPTButtonState(buttonElement)
    : { isGenerating: false, method: 'no-button' };

  const thinkingStop = findThinkingStopButton();
  const hasThinkingStop = !!thinkingStop;

  const isGenerating = buttonState.isGenerating || hasThinkingStop;
  const method = hasThinkingStop
    ? `${buttonState.method || 'unknown'}+thinking-stop`
    : (buttonState.method || 'unknown');

  return { isGenerating, method };
}

// ===== BUTTON DETECTION FUNCTIONS =====
function getChatGPTButtonState(button) {
  if (!button || typeof button.getAttribute !== 'function') {
    return { isGenerating: false, method: 'invalid-element' };
  }
  const testId = button.getAttribute('data-testid') || '';
  const isDisabled = button.disabled;
  const svgPathData = button.querySelector('svg path')?.getAttribute('d') || '';

  // Method 1: data-testid (Highest confidence)
  if (testId.endsWith('stop-button') || testId.includes('stop')) {
    return { isGenerating: true, method: `testid-stop: ${testId}` };
  }
  if (testId.endsWith('send-button')) {
    // When the "send" button is disabled, generation is in progress.
    return { isGenerating: isDisabled, method: `testid-send: ${testId}` };
  }

  // Method 2: SVG path data (Good language-agnostic fallback)
  // The "stop" square icon has a very simple path.
  if (svgPathData.length < 100 && isDisabled) { 
    return { isGenerating: true, method: 'svg-stop-icon' };
  }
  
  // Final Fallback: The most basic check is if the button is disabled.
  return { isGenerating: isDisabled, method: 'disabled-fallback' };
}

function processChatGPTButtonState(buttonElement) {
  const now = Date.now();
  const currentState = getGlobalGenerationState(buttonElement);
  logIfDev(
    'log',
    `Generation Check -> Method: "${currentState.method}", `
      + `WasGenerating: ${chatgptIsGenerating}, NowGenerating: ${currentState.isGenerating}`
  );

  // Detect generation start
  if (!chatgptIsGenerating && currentState.isGenerating) {
    lastGenerationStartTime = now;
  }

  // Detect generation end
  if (chatgptIsGenerating && !currentState.isGenerating) {
    const elapsed = now - lastGenerationStartTime;
    if (elapsed < MIN_GENERATION_DURATION_MS) {
      // This guards against GPT-5 Pro's initial ~1s composer Stop flip.
      logIfDev('log', `Ignoring generation end (elapsed=${elapsed}ms) due to minimum duration threshold`);
    } else {
      logIfDev('log', `✅ Generation finished! Triggering alert. (Method: ${currentState.method})`);
      playAlert();
    }
  }

  chatgptIsGenerating = currentState.isGenerating;
}

function findChatGPTButton() {
  let fallbackButton = null;
  let fallbackSelectorIndex = -1;
  
  for (let i = 0; i < currentChatGptSelectors.length; i++) {
    const selector = currentChatGptSelectors[i];
    logIfDev('log', `Trying selector[${i}]: ${selector}`);
    
    try {
      const buttons = document.querySelectorAll(selector);
      logIfDev('log', `Found ${buttons.length} buttons for selector[${i}]`);
      
      for (const button of buttons) {
        if (button.offsetWidth > 0 && button.offsetHeight > 0) {
          const testId = button.getAttribute('data-testid');
          logIfDev('log', `Button visible with testId: ${testId}`);
          
          // Prioritize testid buttons
          if (testId && (testId.endsWith('send-button') || testId.endsWith('stop-button'))) {
            logIfDev('log', `✅ Found testid button: "${testId}" with selector[${i}]`);
            return button;
          }
          
          if (!fallbackButton) {
            fallbackButton = button;
            fallbackSelectorIndex = i;
            logIfDev('log', `Setting fallback button from selector[${i}]`);
          }
        }
      }
    } catch (error) {
      logIfDev('error', `Selector[${i}] failed: ${selector}`, error);
      continue;
    }
  }
  
  if (fallbackButton) {
    logIfDev('log', `⚠️ Using fallback button with selector[${fallbackSelectorIndex}]`);
    return fallbackButton;
  }
  
  logIfDev('log', 'No buttons found with any selector');
  return null;
}

// ===================================
// == COMPOSER MUTE TOGGLE INJECTOR ==
// ===================================

// Creates the SVG for the button.
function createMuteSVG(isMuted) {
  const svgHeader = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" class="icon">`;
  const svgFooter = `</svg>`;
  if (isMuted) {
    const mutedIcon = `<path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
    return svgHeader + mutedIcon + svgFooter;
  } else {
    const unmutedIcon = `<path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>`;
    return svgHeader + unmutedIcon + svgFooter;
  }
}

// Updates the button's appearance based on the mute state.
function updateComposerMuteButton(button) {
  if (!button) return;
  const isMuted = settings.isMuted || false;
  button.innerHTML = createMuteSVG(isMuted);
  button.setAttribute('aria-label', isMuted ? 'Unmute alerts' : 'Mute alerts');
  button.title = isMuted ? 'Unmute alerts' : 'Mute alerts';
  button.style.color = isMuted ? '#ef4444' : 'currentColor'; // Red when muted
}

// Handles clicks on the mute button.
function handleMuteToggleClick(event) {
  event.stopPropagation();
  settings.isMuted = !settings.isMuted;
  logIfDev('log', `Mute toggled to: ${settings.isMuted}`);
  
  // Update the button visually right away.
  updateComposerMuteButton(this);
  
  // Save the new setting.
  chrome.storage.local.set({ chatAlertSettings: settings });
}

// This is the core function that finds the right spot and adds the button.
function injectComposerMuteToggle() {
  // Check if our button is already there to prevent duplicates.
  if (document.getElementById('chat-dinger-mute-btn')) {
    return;
  }

  // ** UPDATED STRATEGY: Use the specific data-testid for the trailing actions container **
  const targetContainer = document.querySelector('[data-testid="composer-trailing-actions"]');
  
  // If we didn't find the container, we can't inject.
  if (!targetContainer) {
    // Don't log a warning here, as the observer will call this frequently.
    return;
  }

  logIfDev('log', 'Injecting composer mute toggle into trailing actions container...');
  
  const button = document.createElement('button');
  button.id = 'chat-dinger-mute-btn';
  // Use the same classes as other buttons for consistent styling.
  button.className = "flex items-center justify-center rounded-full h-8 w-8 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800";
  
  updateComposerMuteButton(button);
  button.addEventListener('click', handleMuteToggleClick);
  
  // Add our button as the first item in the container so it appears before the send button.
  targetContainer.prepend(button);
  composerMuteToggle = button;
}

// This sets up the observer to watch for UI changes.
function initComposerMuteToggle() {
  if (composerObserver) composerObserver.disconnect();

  // Create an observer that watches the whole page for changes.
  composerObserver = new MutationObserver(() => {
    // Every time something changes, we simply try to inject our button.
    // The inject function is smart enough to not add duplicates.
    injectComposerMuteToggle();
  });

  // Start observing.
  composerObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Also run it once at the start, in case the page is already loaded.
  injectComposerMuteToggle();
}

// ===== BUTTON MONITORING =====
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

function startGlobalGenerationObserver() {
  if (globalGenerationObserver) return;

  globalGenerationObserver = new MutationObserver(() => {
    // Any structural or attribute change may indicate a change in generation
    // state, especially for GPT-5 Pro where the Stop button lives in a
    // separate thinking pane.
    if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
      processChatGPTButtonState(chatgptButtonInstance);
    } else {
      // Even if we haven't attached to a composer button yet, we still want
      // to pay attention to the thinking-pane Stop button.
      processChatGPTButtonState(null);
    }
  });

  globalGenerationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-testid', 'aria-label', 'class', 'disabled']
  });
}

function stopGlobalGenerationObserver() {
  if (globalGenerationObserver) {
    globalGenerationObserver.disconnect();
    globalGenerationObserver = null;
  }
}

function handleChatGPTButtonRemoved() {
  logIfDev('log', `Button removed, was generating: ${chatgptIsGenerating}`);
  // Do NOT treat composer removal as completion by itself; GPT-5 Pro moves the
  // Stop control into the thinking pane. Global generation detection will
  // handle the actual end-of-generation event.
  cleanupChatGPTObservers();
  chatgptButtonInstance = null;
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
  
  const initialState = getGlobalGenerationState(chatgptButtonInstance);
  chatgptIsGenerating = initialState.isGenerating;
  if (chatgptIsGenerating) {
    chatgptFirstGenerationCheck = false;
    lastGenerationStartTime = Date.now();
  }
  
  chatgptAttributeChangeObserver = new MutationObserver(() => {
    if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
      processChatGPTButtonState(chatgptButtonInstance);
    }
  });
  
  chatgptAttributeChangeObserver.observe(chatgptButtonInstance, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true
  });
  
  const parentElement = chatgptButtonInstance.parentElement;
  if (parentElement) {
    chatgptButtonRemovedObserver = new MutationObserver(() => {
      if (!document.contains(chatgptButtonInstance)) handleChatGPTButtonRemoved();
    });
    chatgptButtonRemovedObserver.observe(parentElement, { childList: true });
  }
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
  
  chatgptInitialButtonFinderObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function startChatGPTMaintenance() {
  setInterval(() => {
    logIfDev('log', 'Running periodic maintenance check...');
    // Check for the main send/stop button
    if (!chatgptButtonInstance || !document.contains(chatgptButtonInstance)) {
      observeForChatGPTButton();
    }
    // The robust MutationObserver for the mute toggle makes a periodic check unnecessary.
  }, 7000);
}

// ===== EVENT LISTENERS =====
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
      
      // Update composer toggle if it exists by finding it by ID for safety
      const muteButton = document.getElementById('chat-dinger-mute-btn');
      if (muteButton) {
        updateComposerMuteButton(muteButton);
      }
      
      sendResponse({ status: 'Settings updated in content script', success: true });
      break;
      
    case 'testSound':
      logIfDev('log', 'Processing testSound message');
      playSound(message.soundFile || settings.selectedSound, message.volume || settings.volume, true)
        .then(success => sendResponse({ 
          status: success ? 'Test sound processed by content script' : 'Test sound failed in content script', 
          success 
        }))
        .catch(error => sendResponse({ 
          status: 'Test sound error in content script', 
          success: false, 
          error: error.message 
        }));
      return true;
      
    default:
      sendResponse({ status: 'Unknown action in content script', success: false });
  }
  
  return true;
});

// Listen for settings changes from other parts of the extension (like the popup)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.chatAlertSettings) {
    const newSettings = changes.chatAlertSettings.newValue;
    logIfDev('log', 'Storage change detected, updating UI.');
    settings = { ...settings, ...newSettings };

    const muteButton = document.getElementById('chat-dinger-mute-btn');
    if (muteButton) {
      updateComposerMuteButton(muteButton);
    }
  }
});

// Track user interactions
['click', 'keydown', 'touchstart', 'mousedown'].forEach(eventType => {
  document.addEventListener(eventType, trackUserInteraction, { passive: true, capture: true });
});

// ===== TESTING FUNCTIONS =====
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

// Debug function for testing
function debugButtonDetection() {
  console.log('🔍 Debug - Current selectors:', currentChatGptSelectors);
  console.log('🔍 Debug - Total selectors:', currentChatGptSelectors.length);
  
  const button = findChatGPTButton();
  if (button) {
    const state = getGlobalGenerationState(button);
    const testId = button.getAttribute('data-testid');
    
    console.log('🔍 Debug - Button Detection:', {
      hasTestId: !!testId,
      testId: testId,
      detectionMethod: state.method,
      isGenerating: state.isGenerating,
      confidence: testId ? 'HIGH' : 'MEDIUM/LOW',
      element: button,
      ariaLabel: button.getAttribute('aria-label'),
      className: button.className
    });
    
    return state;
  } else {
    console.log('🔍 Debug - No button found');
    return null;
  }
}

// Additional debug function to test all selectors
function debugAllSelectors() {
  console.log('🔍 Testing all selectors:');
  currentChatGptSelectors.forEach((selector, index) => {
    try {
      const buttons = document.querySelectorAll(selector);
      console.log(`Selector[${index}]: ${selector} -> Found ${buttons.length} buttons`);
      
      buttons.forEach((button, btnIndex) => {
        const testId = button.getAttribute('data-testid');
        const ariaLabel = button.getAttribute('aria-label');
        const visible = button.offsetWidth > 0 && button.offsetHeight > 0;
        
        console.log(`  Button[${btnIndex}]: visible=${visible}, testId="${testId}", aria-label="${ariaLabel}"`);
      });
    } catch (error) {
      console.log(`Selector[${index}]: ${selector} -> ERROR: ${error.message}`);
    }
  });
}

// Make debug functions available for testing
window.debugChatDinger = debugButtonDetection;
window.debugAllSelectors = debugAllSelectors;

// ===== INITIALIZATION =====
async function init() {
  logIfDev('log', `Initializing Chat Dinger, SITE=${SITE}, readyState=${document.readyState}`);
  
  if (SITE === 'UNKNOWN') {
    logIfDev('log', 'Not a ChatGPT page, exiting');
    return;
  }
  
  await loadSettings();
  await loadSoundCount();
  
  if (SITE === 'CHATGPT') {
    logIfDev('log', 'Starting all observations');
    observeForChatGPTButton();
    initComposerMuteToggle(); // This now handles the mute button entirely
    startChatGPTMaintenance();
    startGlobalGenerationObserver(); // Track GPT-5 Pro thinking-pane Stop button as well
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  logIfDev('log', 'Waiting for DOMContentLoaded');
  window.addEventListener('DOMContentLoaded', init);
}
