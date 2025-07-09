chrome.runtime.onInstalled.addListener((details) => {
  // Detect dev mode
  const manifest = chrome.runtime.getManifest();
  const isDevMode = !manifest.update_url;
  chrome.storage.local.set({ isDevMode }).catch(e => console.error('Chat Dinger: Failed to set dev mode flag:', e.message));

  if (details.reason === 'install') {
    chrome.storage.local.set({
      chatAlertSettings: {
        enabled: true,
        volume: 0.7,
        selectedSound: 'cryptic.wav',
        enableNotifications: true
      }
    }).catch(e => console.error('Chat Dinger: Failed to set default settings:', e.message));
  }
  setupPeriodicCleanup();
});

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'testSound') {
    handleTestSound(message, sendResponse);
    return true;
  }
  if (message.action === 'playNotificationSound') {
    handleNotificationSound(message, sendResponse);
    return true;
  }
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'updateSelectorsAlarm') {
    fetchAndUpdateSelectors();
  }
});

async function fetchAndUpdateSelectors() {
  const selectorUrl = 'https://chatdinger.com/selectors.json';
  try {
    const response = await fetch(selectorUrl);
    const newSelectors = await response.json();
    if (Array.isArray(newSelectors) && newSelectors.length > 0) {
      await chrome.storage.local.set({ customSelectors: newSelectors });
      await logIfDev('log', 'Successfully updated selectors from remote source.');
    }
  } catch (error) {
    console.error('Chat Dinger: Failed to fetch remote selectors.', error);
  }
}

async function playSoundInOffscreen(soundFile, volume) {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play notification sound when ChatGPT tab is hidden'
    });
    await logIfDev('log', 'Offscreen document created');
  }
  chrome.runtime.sendMessage({ action: 'playOffscreenAudio', soundFile, volume });
  await logIfDev('log', `Sent playOffscreenAudio message for ${soundFile}`);
}

async function handleTestSound(message, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      sendResponse({ status: 'No active tab', error: 'Please open a tab to test sound.' });
      return;
    }
    const tab = tabs[0];

    if (tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:')) {
      await logIfDev('warn', 'Cannot inject script into restricted pages. Trying notification fallback.');
      const success = await createBackgroundNotification('Chat Dinger Test', 'Test sound via notification (restricted page)');
      sendResponse({
        status: success ? 'Test notification played' : 'Cannot test on this page',
        error: success ? null : 'Please open a regular webpage (like ChatGPT) for full testing',
        success: success
      });
      return;
    }

    const soundFile = message.soundFile || 'cryptic.wav';
    const volume = message.volume !== undefined ? message.volume : 0.7;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: playTestSoundInTab,
        args: [soundFile, volume]
      });
      sendResponse({ status: `Test sound (${soundFile}) played in tab via injection`, success: true });
    } catch (error) {
      console.error('Background: Script injection for test sound failed:', error.message);
      const notificationMessage = `Test: ${soundFile} (injection failed)`;
      const success = await createBackgroundNotification('Chat Dinger Test', notificationMessage);
      sendResponse({
        status: success ? 'Test notification played (injection fallback)' : 'Test failed, injection and notification failed',
        error: success ? null : `Script injection failed: ${error.message}. Notification fallback also failed.`,
        success: success
      });
    }
  } catch (error) {
    console.error('Background: General error in handleTestSound:', error.message);
    sendResponse({ status: 'Test failed', error: error.message, success: false });
  }
}

function playTestSoundInTab(soundFile, volume) {
  try {
    const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
    audio.volume = Math.min(Math.max(0, parseFloat(volume) || 0.7), 1.0);
    audio.preload = 'auto';
    if ('preservesPitch' in audio) {
      audio.preservesPitch = false;
    }
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.error(`Chat Dinger (Injected Script): HTML5 Audio playback failed for ${soundFile}: ${e.message} (Name: ${e.name})`);
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          if (audioContext.state === 'suspended') { audioContext.resume().catch(er => console.warn("Audio context resume failed", er)); }
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          gainNode.gain.setValueAtTime((parseFloat(volume) || 0.7) * 0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
          oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
          oscillator.type = 'sine';
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.3);
        } catch (fallbackError) {
          console.error(`Chat Dinger (Injected Script): All audio methods failed for ${soundFile}: ${fallbackError.message}`);
        }
      });
    }
  } catch (e) {
    console.error(`Chat Dinger (Injected Script): Error during test sound playback for ${soundFile}: ${e.message}`);
  }
}

async function handleNotificationSound(message, sendResponse) {
  try {
    const result = await chrome.storage.local.get(['chatAlertSettings']);
    const settings = result.chatAlertSettings || {};
    const soundFile = settings.selectedSound || 'cryptic.wav';
    const volume = settings.volume || 0.7;
    await playSoundInOffscreen(soundFile, volume);
    const title = message.title || 'Chat Dinger';
    const body = message.message || 'Your chat response is ready!';
    const success = await createBackgroundNotification(title, body, true);
    sendResponse({ status: 'Offscreen sound and visual notification shown', success: true });
  } catch (error) {
    console.error('Background: Hybrid sound/notification handler error:', error);
    sendResponse({ status: 'Hybrid notification failed', error: error.message, success: false });
  }
}

async function createBackgroundNotification(title, message, isSilent = false) {
  try {
    if (chrome.notifications) {
      const options = {
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: title,
        message: message,
        priority: 2,
        silent: isSilent
      };
      const notificationId = `chat-dinger-${Date.now()}`;
      await chrome.notifications.create(notificationId, options);
      setTimeout(() => {
        chrome.notifications.clear(notificationId).catch(e => {
          console.warn('Chat Dinger: Could not clear notification:', notificationId, e.message);
        });
      }, 5000);
      return true;
    } else {
      console.warn("Chat Dinger: chrome.notifications API not available.");
      return false;
    }
  } catch (error) {
    console.error('Chat Dinger: Background notification creation failed:', error);
    return false;
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('chat-dinger-')) {
    return;
  }
  const chatGPTUrls = ["*://chat.openai.com/*", "*://chatgpt.com/*"];
  try {
    const tabs = await chrome.tabs.query({ url: chatGPTUrls });
    if (tabs.length > 0) {
      const targetTab = tabs.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
      await chrome.windows.update(targetTab.windowId, { focused: true });
      await chrome.tabs.update(targetTab.id, { active: true });
    } else {
      await chrome.tabs.create({ url: 'https://chatgpt.com/' });
    }
  } catch (error) {
    console.error('Chat Dinger: Error handling notification click:', error);
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  } finally {
    chrome.notifications.clear(notificationId).catch(e => {
      console.warn('Chat Dinger: Could not clear clicked notification:', notificationId, e.message);
    });
  }
});

let heartbeatInterval = null;
let heartbeatCount = 0;

function startCriticalTaskHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatCount = 0;
  heartbeatInterval = setInterval(async () => {
    try {
      heartbeatCount++;
      await chrome.storage.local.set({
        'last-heartbeat': Date.now(),
        'heartbeat-count': (await chrome.storage.local.get(['heartbeat-count']))['heartbeat-count'] || 0 + 1,
        'session-heartbeats': heartbeatCount
      });
      if (heartbeatCount > 15) {
        stopCriticalTaskHeartbeat();
      }
    } catch (error) {
      console.error('Chat Dinger: Heartbeat failed:', error.message);
      stopCriticalTaskHeartbeat();
    }
  }, 25000);
}

function stopCriticalTaskHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    heartbeatCount = 0;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'testSound' || message.action === 'playNotificationSound') {
    startCriticalTaskHeartbeat();
    setTimeout(() => {
      stopCriticalTaskHeartbeat();
    }, 8000);
  }
});

chrome.runtime.onSuspend.addListener(() => {
  stopCriticalTaskHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  stopCriticalTaskHeartbeat();
  setupPeriodicCleanup();
});

function setupPeriodicCleanup() {
  chrome.storage.local.get(['last-cleanup']).then(result => {
    const lastCleanup = result['last-cleanup'] || 0;
    const now = Date.now();
    if (now - lastCleanup > 3600000) {
      cleanupOldStorage();
    }
  }).catch(e => console.warn('Chat Dinger: Cleanup check failed:', e.message));
}

function cleanupOldStorage() {
  chrome.storage.local.get(null).then(items => {
    const now = Date.now();
    const keysToRemove = [];
    for (const [key, value] of Object.entries(items)) {
      if ((key.startsWith('last-heartbeat') || key.startsWith('heartbeat-count') || key.startsWith('session-heartbeats')) &&
          typeof value === 'number' && (now - items['last-heartbeat'] > 7200000)) {
        keysToRemove.push(key);
      }
    }
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove);
    }
    chrome.storage.local.set({ 'last-cleanup': now });
  }).catch(e => console.warn('Chat Dinger: Storage cleanup failed:', e.message));
}

setupPeriodicCleanup();