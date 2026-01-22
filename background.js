const defaultSettings = {
  enabled: true,
  isMuted: false,
  volume: 0.7,
  selectedSound: 'cryptic.wav',
  enableNotifications: true,
  notifyOnActiveTab: true
};

chrome.runtime.onInstalled.addListener((details) => {
  const manifest = chrome.runtime.getManifest();
  const isDevMode = !manifest.update_url;
  chrome.storage.local.set({ isDevMode }).catch(e => console.error('Chat Dinger: Failed to set dev mode flag:', e.message));

  if (details.reason === 'install') {
    chrome.storage.local.set({ chatAlertSettings: defaultSettings })
      .catch(e => console.error('Chat Dinger: Failed to set default settings:', e.message));
  } else if (details.reason === 'update') {
    chrome.storage.local.get('chatAlertSettings').then(result => {
      const currentSettings = result.chatAlertSettings;
      const newSettings = { ...defaultSettings, ...currentSettings };
      chrome.storage.local.set({ chatAlertSettings: newSettings })
        .catch(e => console.error('Chat Dinger: Failed to migrate settings:', e.message));
    }).catch(e => console.error('Chat Dinger: Failed to get settings for migration:', e.message));
  }
  setupPeriodicCleanup();
  setupRemoteSelectorFetching();
});

// Logging utility
async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id||!chrome.storage?.local) {
    return;
  }
  try {
    const { isDevMode } = await chrome.storage.local.get(['isDevMode']);
    if (isDevMode) {
      switch (level) {
        case 'log':
          console.log('Chat Dinger BG:', ...args);
          break;
        case 'warn':
          console.warn('Chat Dinger BG:', ...args);
          break;
        case 'error':
          console.error('Chat Dinger BG:', ...args);
          break;
      }
    }
  } catch (e) {
    console.error('Chat Dinger BG: Failed to check dev mode for logging:', e.message);
  }
}

// ======== ARCHITECTURE REWRITE: START ========
// The background script is now the single source of truth for settings.
async function handleToggleMute(sendResponse) {
  try {
    const { chatAlertSettings = defaultSettings } = await chrome.storage.local.get(['chatAlertSettings']);
    
    // Create a new object with the toggled mute state
    const newSettings = {
      ...chatAlertSettings,
      isMuted: !chatAlertSettings.isMuted 
    };
    
    // Save the new settings object to storage
    await chrome.storage.local.set({ chatAlertSettings: newSettings });
    
    await logIfDev('log', `Mute state toggled to ${newSettings.isMuted}. Storage updated.`);
    sendResponse({ success: true, isMuted: newSettings.isMuted });

  } catch (error) {
    console.error('Chat Dinger BG: Failed to toggle mute state.', error);
    sendResponse({ success: false, error: error.message });
  }
}
// ======== ARCHITECTURE REWRITE: END ========


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use a switch for clarity and scalability
  switch (message.action) {
    case 'toggleMute':
      handleToggleMute(sendResponse);
      return true; // Keep message channel open for async response

    case 'testSound':
      handleTestSound(message, sendResponse);
      return true;

    case 'playNotificationSound':
      handleNotificationSound(message, sendResponse);
      return true;
    
    // The popup can send this to sync its own state if needed
    case 'settingsUpdated':
       logIfDev('log', 'Received settingsUpdated message, no action needed in background as storage is the source of truth.');
       sendResponse({success: true, status: 'acknowledged'});
       break;

    default:
      // Optional: handle unknown actions
      logIfDev('warn', 'Received unknown message action:', message.action);
      sendResponse({success: false, status: 'Unknown action'});
      break;
  }
  return false; // No async response needed for synchronous actions
});


function setupRemoteSelectorFetching() {
  logIfDev('log', 'Setting up remote selector fetching...');
  // Fetch immediately on setup, then schedule periodic updates.
  fetchAndUpdateSelectors();
  chrome.alarms.create('updateSelectorsAlarm', {
    periodInMinutes: 60 // Repeat every hour
  });
}

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
    // Check for the new object structure
    if (newSelectors && typeof newSelectors === 'object' && (newSelectors.mainButtonSelectors || newSelectors.muteToggleSelectors)) {
      // Store the whole object
      await chrome.storage.local.set({ customSelectors: newSelectors });
      await logIfDev('log', 'Successfully updated selectors from remote source.', newSelectors);
    } else {
        await logIfDev('warn', 'Remote selectors have an invalid format.', newSelectors);
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
    
    // Respect the mute setting for notifications
    if (settings.isMuted) {
      await logIfDev('log', 'Skipping notification sound because master mute is on.');
      sendResponse({status: 'Sound skipped due to mute', success: true});
      return;
    }

    const soundFile = settings.selectedSound || 'cryptic.wav';
    const volume = (typeof settings.volume === 'number') ? settings.volume : 0.7;
    await playSoundInOffscreen(soundFile, volume);

    const title = message.title || 'Chat Dinger';
    const body = message.message || 'Your chat response is ready!';
    const success = await createBackgroundNotification(title, body, true); // Play sound via offscreen, so notification is silent
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

// Periodic cleanup and heartbeat functions remain the same
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

chrome.runtime.onSuspend.addListener(() => {
  stopCriticalTaskHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  stopCriticalTaskHeartbeat();
  setupPeriodicCleanup();
  setupRemoteSelectorFetching();
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
  chrome.storage.local.remove(['last-heartbeat', 'heartbeat-count', 'session-heartbeats']).then(() => {
    chrome.storage.local.set({ 'last-cleanup': Date.now() });
  }).catch(e => console.warn('Chat Dinger: Storage cleanup failed:', e.message));
}

setupPeriodicCleanup();