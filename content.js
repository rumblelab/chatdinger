console.log('Chat Dinger: Content script loaded. By discofish.');

// ===== GLOBAL VARIABLES =====
let soundPlayCount = 0;
let hasShownPopup = false;
let generationTimeStart = null; // used by generation-time tracking
const askThreshold = 7;
let lastUserInteraction = 0;

let settings = {
  enabled: true,
  isMuted: false, 
  volume: 0.7,
  selectedSound: 'cryptic.wav',
  notifyOnActiveTab: true,
  enableNotifications: true,
}

let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true;
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;
let canPlayAlertSound = true;

// Composer mute toggle variables
let composerMuteToggle = null;
let composerObserver = null;

// ===== METRICS HELPERS (new) =====
function monthKey(d = new Date()) {
  return d.toISOString().slice(0,7); // "YYYY-MM"
}
function dayKey(d = new Date()) {
  return d.toISOString().slice(0,10); // "YYYY-MM-DD"
}
function timeBucketForHour(h) {
  if (h < 6) return 'lateNight';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
function isWeekend(d = new Date()) {
  const n = d.getDay(); // 0 = Sun, 6 = Sat
  return n === 0 || n === 6;
}
async function getMetrics() {
  const { dingerMetrics = {} } = await chrome.storage.local.get(['dingerMetrics']);
  return {
    // core counters
    total: dingerMetrics.total || 0,
    todayCount: dingerMetrics.todayCount || 0,
    lastDate: dingerMetrics.lastDate || null,
    streak: dingerMetrics.streak || 0,
    bestStreak: dingerMetrics.bestStreak || 0,
    achievements: Array.isArray(dingerMetrics.achievements) ? dingerMetrics.achievements : [],

    // new timing aggregates
    totalGenTime: dingerMetrics.totalGenTime || 0,        // ms across all completed gens
    avgGenTime: dingerMetrics.avgGenTime || 0,            // ms
    longestGenTime: dingerMetrics.longestGenTime || 0,    // ms
    shortestGenTime: dingerMetrics.shortestGenTime || 0,  // ms

    // usage breakdowns
    soundsUsed: dingerMetrics.soundsUsed || {},           // { 'cryptic.wav': 12, ... }
    timeBuckets: dingerMetrics.timeBuckets || {
      lateNight: 0, morning: 0, afternoon: 0, evening: 0
    },
    weekdayCount: dingerMetrics.weekdayCount || 0,
    weekendCount: dingerMetrics.weekendCount || 0,

    // monthly rollups for future leaderboards
    monthly: dingerMetrics.monthly || {
      // 'YYYY-MM': { count: 0, totalGenTime: 0 }
    }
  };
}
async function saveMetrics(m) {
  await chrome.storage.local.set({ dingerMetrics: m });
}

// ===== SITE DETECTION =====
const SITE = (() => {
  const hostname = window.location.hostname;
  if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
    return 'CHATGPT';
  }
  return 'UNKNOWN';
})();

const CHATGPT_BUTTON_SELECTORS = [
  '#composer-submit-button',
  'button[data-testid$="send-button"]',
  'button[data-testid$="stop-button"]'
];

const DEFAULT_MUTE_TOGGLE_SELECTORS = {
  dictateButton: 'button[aria-label="Dictate button"]',
  flexWrapper: '[class*="items-center"][class*="gap-1.5"]'
};

let currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];
let currentMuteToggleSelectors = { ...DEFAULT_MUTE_TOGGLE_SELECTORS };

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
}

// ===== STORAGE FUNCTIONS =====
async function loadSoundCount() {
  try {
    const result = await chrome.storage.local.get(['soundPlayCount', 'hasShownPopup']);
    soundPlayCount = result.soundPlayCount || 0;
    hasShownPopup = result.hasShownPopup || false;
  } catch (error) {
    console.error('Chat Dinger: Failed to load sound count:', error);
  }
}

async function saveSoundCount() {
  try {
    if (!chrome.runtime?.id) { return false; }
    await chrome.storage.local.set({ soundPlayCount, hasShownPopup });
    return true;
  } catch (error) {
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
    
    if (result.customSelectors?.mainButtonSelectors?.length > 0) {
      currentChatGptSelectors = [...result.customSelectors.mainButtonSelectors, ...CHATGPT_BUTTON_SELECTORS];
    } else {
      currentChatGptSelectors = [...CHATGPT_BUTTON_SELECTORS];
    }

    if (result.customSelectors?.muteToggleSelectors) {
      currentMuteToggleSelectors = { ...DEFAULT_MUTE_TOGGLE_SELECTORS, ...result.customSelectors.muteToggleSelectors };
    }
    
    await logIfDev('log', 'Loaded settings:', settings);
  } catch (error) {
    if (!error.message.includes('Extension context invalidated')) {
      console.error('Chat Dinger: Failed to load settings:', error);
    }
  }
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

// ===== GENERATION-TIME TRACKING (new) =====
function markGenerationStart() {
  generationTimeStart = Date.now();
}

async function markGenerationEnd() {
  if (!generationTimeStart) return;
  const duration = Date.now() - generationTimeStart; // ms
  generationTimeStart = null;
  const m = await getMetrics();

  // Update gen-time aggregates
  m.totalGenTime += duration;
  m.longestGenTime = Math.max(m.longestGenTime || 0, duration);
  m.shortestGenTime = m.shortestGenTime ? Math.min(m.shortestGenTime, duration) : duration;

  // avg over total responses (m.total is incremented by updateDingerMetrics when the sound plays)
  const denom = Math.max(m.total, 1);
  m.avgGenTime = Math.round(m.totalGenTime / denom);

  // time-of-day & weekend/weekday breakdowns
  const now = new Date();
  const bucket = timeBucketForHour(now.getHours());
  m.timeBuckets[bucket] = (m.timeBuckets[bucket] || 0) + 1;
  if (isWeekend(now)) m.weekendCount += 1; else m.weekdayCount += 1;

  // monthly rollup (time)
  const mk = monthKey(now);
  if (!m.monthly[mk]) m.monthly[mk] = { count: 0, totalGenTime: 0 };
  m.monthly[mk].totalGenTime += duration;
  await saveMetrics(m);
}

function processChatGPTButtonState(buttonElement) {
  const currentState = getChatGPTButtonState(buttonElement);
  logIfDev('log', `Button Check -> Method: "${currentState.method}", WasGenerating: ${chatgptIsGenerating}, NowGenerating: ${currentState.isGenerating}`);

  // Transition: idle -> generating (start stopwatch)
  if (!chatgptIsGenerating && currentState.isGenerating) {
    markGenerationStart();
  }

  if (chatgptIsGenerating && !currentState.isGenerating) {
    logIfDev('log', `✅ Generation finished! Triggering alert. (Method: ${currentState.method})`);
    // Stop stopwatch BEFORE dinging
    markGenerationEnd();
    playAlert();
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
    <h2 style="margin: 0; color: #333; font-size: 20px;">Hey, real quick...</h2>
    <p style="color: #666; margin: 16px 0; line-height: 1.4;">
      When you get a second, will you <a target="_blank" href="https://chromewebstore.google.com/detail/chat-dinger-chatgpt-notif/kkpdpkhnioiapldpimpdlleonejkkddb/reviews">leave me a review? </a>
    </p>
    <img style="display: block; margin: 0 auto 16px; width: 100%; max-width: 200px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
    <p style="color: #666; margin: 16px 0; line-height: 1.4;">
      Otherwise, next time you hear that sweet ding, you're gonna think about me... sitting here waiting for that review.
    </p>
    <p style="color: #666; margin: 16px 0; line-height: 1.4; font-size: 10px;">
      Deal?
    </p>
  </div>
  <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
    <button id="deal" style="background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">🤝 Deal</button>
  </div>
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

// NOTE: updateDingerMetrics rewritten to preserve/extend metrics shape
async function updateDingerMetrics() {
  try {
    const keyToday = dayKey(); // YYYY-MM-DD
    const m = await getMetrics();

    // core totals
    m.total += 1;

    const last = m.lastDate;
    if (last === keyToday) {
      m.todayCount += 1;
    } else {
      const y = dayKey(new Date(Date.now() - 86400000));
      if (last === y) {
        m.streak += 1;
      } else {
        m.streak = 1;
      }
      m.todayCount = 1;
      m.lastDate = keyToday;
    }
    if (m.streak > m.bestStreak) m.bestStreak = m.streak;

    // achievements (existing + new)
    const addAch = (label) => {
      if (!m.achievements.includes(label)) m.achievements.push(label);
    };
    if (m.total === 1) addAch('First Ding!');
    if (m.total === 7) addAch('Deal Maker 🍕 = 5');
    if (m.total === 10) addAch('Ding Apprentice (10)');
    if (m.total === 50) addAch('Ding Devotee (50)');
    if (m.total === 100) addAch('Ding Centurion (100)');
    if (m.streak === 3) addAch('3-Day Streak 🔥');
    if (m.streak === 7) addAch('7-Day Streak 🔥🔥');
    const h = new Date().getHours();
    if (h < 6) addAch('Night Owl 🌙');

    // NEW: speed/variety/monthly achievements (requires gen-time + soundsUsed)
    if (m.shortestGenTime && m.shortestGenTime <= 1500) addAch('Speed Demon ⚡ (<1.5s)');
    if (m.longestGenTime && m.longestGenTime >= 120000) addAch('Endurance Ding 🕰️ (2+ min)');
    const distinctSounds = Object.keys(m.soundsUsed || {}).length;
    if (distinctSounds >= 3) addAch('Sound Sampler 🎧');
    if (distinctSounds >= 5) addAch('Sound DJ 🎛️');
    const mkNow = monthKey(new Date());
    const thisMonth = (m.monthly && m.monthly[mkNow]) ? m.monthly[mkNow] : null;
    if (thisMonth && thisMonth.count >= 100) addAch('Monthly Grinder 💪 (100)');

    await saveMetrics(m);
  } catch (e) {
    console.warn('updateDingerMetrics failed:', e);
  }
}

async function requestBackgroundNotification(title, messageText) {
  if (!chrome.runtime?.id) { return false; }
  try {
    const response = await chrome.runtime.sendMessage({ action: 'playNotificationSound', title, message: messageText });
    return response?.success || false;
  } catch (e) {
    console.error("Chat Dinger: Error messaging background for notification:", e);
    return false;
  }
}

async function playSound(soundFile = null, volume = null, isTest = false) {
  if (!settings.notifyOnActiveTab && !document.hidden && !isTest) {
    return;
  }
  
  const effectiveSoundFile = soundFile || settings.selectedSound || 'cryptic.wav';
  const audioVolume = volume !== null ? volume : settings.volume;

  if (document.hidden || document.visibilityState !== 'visible') {
    return await requestBackgroundNotification('ChatDinger', `Your ChatGPT response is ready!`);
  }

  const audioPlayedInPage = await playAudioFile(effectiveSoundFile, audioVolume);
  if (audioPlayedInPage) {
    // Record per-sound usage & monthly count for achievements/leaderboards
    try {
      const m = await getMetrics();
      m.soundsUsed[effectiveSoundFile] = (m.soundsUsed[effectiveSoundFile] || 0) + 1;

      const mk = monthKey(new Date());
      if (!m.monthly[mk]) m.monthly[mk] = { count: 0, totalGenTime: 0 };
      m.monthly[mk].count += 1;

      await saveMetrics(m);
    } catch (e) {
      console.warn('Chat Dinger: failed to update soundsUsed/monthly count', e);
    }
    return true;
  }

  return await requestBackgroundNotification('Chat Dinger', `Response ready! (Sound: ${effectiveSoundFile.split('.')[0]})`);
}

async function playAlert() {
  if (!settings.enabled || settings.isMuted) {
    return;
  }
  if (!canPlayAlertSound) {
    return;
  }
  
  canPlayAlertSound = false;

  const soundPlayed = await playSound();

  if (soundPlayed) {
    soundPlayCount++;
    await updateDingerMetrics();
    if (soundPlayCount >= askThreshold && !hasShownPopup) {
      setTimeout(showThanksPopup, 1000);
    }
    if (soundPlayCount % 3 === 0) {
      await saveSoundCount();
    }
  }
  
  setTimeout(() => { canPlayAlertSound = true; }, 2000);
}

// ==========================================
// == (OPTIONAL) UPGRADED: LIVE REGION OBSERVER ==
// ==========================================
// Keep commented unless you want dual detection paths.
// The button-based observer is already robust.
/*
function initSmartObserver() {
  const attachObserverToLiveRegion = (liveRegionNode) => {
    logIfDev('log', "✅ Attaching Smart Observer to #live-region-assertive.");
    let wasGenerating = false;

    const generationObserver = new MutationObserver(() => {
      if (!liveRegionNode.isConnected) {
        logIfDev('warn', '#live-region-assertive was disconnected. Re-initializing search.');
        generationObserver.disconnect();
        initSmartObserver();
        return;
      }
      
      const text = liveRegionNode.textContent.trim().toLowerCase();
      console.log(`Chat Dinger: Live region text changed: "${text}"`);

      if (text.includes("generating")) {
        if (!wasGenerating) {
          logIfDev('log', "💡 Detected start of generation cycle.");
          wasGenerating = true;
          markGenerationStart();
        }
        return;
      }

      if (wasGenerating) {
        if (text.includes("chatgpt says")) {
          logIfDev('log', "✅ Generation finished (final state 'chatgpt says...').");
          markGenerationEnd();
          playAlert();
          wasGenerating = false;
        } else if (text === "") {
          logIfDev('log', "⌛ Intermediate empty state detected. Waiting for final text.");
        } else {
          logIfDev('log', `✅ Generation finished (unrecognized final state: "${text}").`);
          markGenerationEnd();
          playAlert();
          wasGenerating = false;
        }
      }
    });

    generationObserver.observe(liveRegionNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
    logIfDev('log', "Smart Observer is now active.");
  };

  const parentObserver = new MutationObserver((mutations, observer) => {
    const liveRegion = document.querySelector('#live-region-assertive');
    if (liveRegion) {
      attachObserverToLiveRegion(liveRegion);
      observer.disconnect();
    }
  });

  const initialLiveRegion = document.querySelector('#live-region-assertive');
  if (initialLiveRegion) {
    attachObserverToLiveRegion(initialLiveRegion);
  } else {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      logIfDev('log', "Observing main content for #live-region-assertive.");
      parentObserver.observe(mainContent, { childList: true, subtree: true });
    } else {
      logIfDev('warn', 'Could not find main content area. Retrying in 2s.');
      setTimeout(initSmartObserver, 2000);
    }
  }
}
*/

// ===================================
// == COMPOSER MUTE TOGGLE INJECTOR ==
// ===================================
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

function updateComposerMuteButton(button) {
  if (!button) return;
  const isMuted = settings.isMuted || false;
  button.innerHTML = createMuteSVG(isMuted);
  button.setAttribute('aria-label', isMuted ? 'Unmute alerts' : 'Mute alerts');
  button.title = isMuted ? 'Unmute alerts' : 'Mute alerts';
  button.style.color = isMuted ? '#ef4444' : 'currentColor';
}

function handleMuteToggleClick(event) {
  event.stopPropagation();
  event.preventDefault();
  chrome.runtime.sendMessage({ action: 'toggleMute' }).catch(e => {
    console.error('Chat Dinger: Could not send toggleMute message.', e);
  });
}

function injectComposerMuteToggle() {
  if (document.getElementById('chat-dinger-mute-btn')) {
    return;
  }

  const dictateButton = document.querySelector(currentMuteToggleSelectors.dictateButton);
  if (!dictateButton) {
    logIfDev('warn', 'Dictate button not found.');
    return;
  }

  const dictateSpan = dictateButton.closest('span.inline-flex');
  if (!dictateSpan) {
    logIfDev('warn', 'Span wrapping dictate button not found.');
    return;
  }

  const flexWrapper = dictateSpan.closest(currentMuteToggleSelectors.flexWrapper);
  if (!flexWrapper) {
    logIfDev('warn', 'Could not find flex wrapper to insert mute button.');
    return;
  }

  logIfDev?.('log', 'Injecting composer mute toggle...');

  const button = document.createElement('button');
  button.id = 'chat-dinger-mute-btn';
  button.className = "flex items-center justify-center rounded-full h-8 w-8 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800";
  button.setAttribute('aria-label', 'Mute alerts');
  button.setAttribute('title', 'Mute alerts');
  button.style.color = 'currentColor';

  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
      stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" class="icon">
      <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
    </svg>
  `;

  button.addEventListener('click', handleMuteToggleClick);

  // Insert before the span containing the Dictate button
  flexWrapper.insertBefore(button, dictateSpan);

  composerMuteToggle = button;
}



function initComposerMuteToggle() {
  if (composerObserver) composerObserver.disconnect();

  composerObserver = new MutationObserver(() => {
    injectComposerMuteToggle();
  });

  composerObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  injectComposerMuteToggle();
}

// ===== BUTTON MONITORING =====
function addChatGPTClickListener(button) {
  if (!button || button.dataset.chatgptListener === 'true') return;
  button.dataset.chatgptListener = 'true';
  button.addEventListener('click', (e) => {
    trackUserInteraction();
    setTimeout(() => {
    const el = document.querySelector('#composer-submit-button') || button;
    const s = getChatGPTButtonState(el);
    if (s.isGenerating && !generationTimeStart) {
    markGenerationStart();
    chatgptIsGenerating = true;
    }
    }, 50);
    }, { passive: true });
}

function cleanupChatGPTObservers() {
  if (chatgptAttributeChangeObserver) chatgptAttributeChangeObserver.disconnect();
  if (chatgptButtonRemovedObserver) chatgptButtonRemovedObserver.disconnect();
  chatgptAttributeChangeObserver = null;
  chatgptButtonRemovedObserver = null;
}

function handleChatGPTButtonRemoved() {
  logIfDev('log', `Button removed, was generating: ${chatgptIsGenerating}`);
  if (chatgptIsGenerating) {
    markGenerationEnd();
    playAlert();
    }
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
  if (chatgptIsGenerating) {
    markGenerationStart();
    chatgptFirstGenerationCheck = false;
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
  
  switch (message.action) {
    case 'testSound':
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
      return false;
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.chatAlertSettings) {
    const newSettings = changes.chatAlertSettings.newValue;
    logIfDev('log', 'Storage change detected, updating local settings and UI.');
    settings = { ...settings, ...newSettings };

    const muteButton = document.getElementById('chat-dinger-mute-btn');
    if (muteButton) {
      updateComposerMuteButton(muteButton);
    }
  }
});

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
window.addEventListener('run_dinger_test', () => playAlert());
window.addEventListener('run_dinger_reset', () => resetDingerStateForTesting());

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
    initComposerMuteToggle(); // Handles the mute button entirely
    startChatGPTMaintenance();
    // Optional: initSmartObserver(); // if you want dual-path detection
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  logIfDev('log', 'Waiting for DOMContentLoaded');
  window.addEventListener('DOMContentLoaded', init);
}
