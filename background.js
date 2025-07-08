// Complete Enhanced background script for Chat Dinger
// Chrome Store safe version with notification support

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'testSound') {
    handleTestSound(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  if (message.action === 'playNotificationSound') {
    handleNotificationSound(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  // Handle other messages...
  return true; // Keep message channel open for other potential async responses
});

chrome.runtime.onInstalled.addListener(() => {
  // Also run immediately on install
  fetchAndUpdateSelectors(); 
  // Set an alarm to run periodically
  chrome.alarms.create('updateSelectorsAlarm', {
      periodInMinutes: 1440 // Once a day
  });
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

      // Basic validation to ensure it's a non-empty array
      if (Array.isArray(newSelectors) && newSelectors.length > 0) {
          // Save the remotely fetched selectors to local storage
          await chrome.storage.local.set({ customSelectors: newSelectors });
          console.log('Chat Dinger: Successfully updated selectors from remote source.');
      }
  } catch (error) {
      console.error('Chat Dinger: Failed to fetch remote selectors.', error);
      // On failure, the extension will just keep using its last known selectors.
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
  }
  // The offscreen document has its own message listener
  chrome.runtime.sendMessage({ action: 'playOffscreenAudio', soundFile, volume });
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
      console.warn('Background: Cannot inject script into restricted pages. Trying notification fallback.');
      const success = await createBackgroundNotification('Chat Dinger Test', 'Test sound via notification (restricted page)');
      sendResponse({
        status: success ? 'Test notification played' : 'Cannot test on this page',
        error: success ? null : 'Please open a regular webpage (like ChatGPT) for full testing',
        success: success
      });
      return;
    }

    // Sound file and volume from message or defaults
    const soundFile = message.soundFile || 'cryptic.wav'; // Default to a .wav file
    const volume = message.volume !== undefined ? message.volume : 0.7;

    // Try to inject and play sound in the active tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: playTestSoundInTab, // This function is defined below and will be injected
        args: [soundFile, volume]
      });
      sendResponse({ status: `Test sound (${soundFile}) played in tab via injection`, success: true });
    } catch (error) {
      console.error('Background: Script injection for test sound failed:', error.message);
      // Fallback to creating a system notification if injection fails
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

// This function is stringified and injected into the target tab.
// It runs in the tab's context, not the background script's context.
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
      playPromise
        .then()
        .catch(e => {
          console.error(`Chat Dinger (Injected Script): HTML5 Audio playback failed for ${soundFile}: ${e.message} (Name: ${e.name})`);
          // Optional: A very simple Web Audio beep as a last resort *within the tab* if HTML5 audio itself fails.
          try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') { audioContext.resume().catch(er => console.warn("Audio context resume failed", er));}
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            gainNode.gain.setValueAtTime( (parseFloat(volume) || 0.7) * 0.3, audioContext.currentTime); // Softer fallback
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
            oscillator.type = 'sine';
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
          } catch (fallbackError) {
            console.error(`Chat Dinger (Injected Script): All audio methods (HTML5 and fallback beep) failed for ${soundFile}: ${fallbackError.message}`);
          }
        });
    } else {
      console.warn('Chat Dinger (Injected Script): audio.play() did not return a promise for', soundFile);
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

    // 1. Play the custom sound
    await playSoundInOffscreen(soundFile, volume);

    // 2. Show a silent visual notification
    const title = message.title || 'Chat Dinger';
    const body = message.message || 'Your chat response is ready!';
    // The 'true' here makes the notification silent
    await createBackgroundNotification(title, body, true); 

    sendResponse({ status: 'Offscreen sound and visual notification shown', success: true });
  } catch (error) {
    console.error('Background: Hybrid sound/notification handler error:', error);
    sendResponse({ status: 'Hybrid notification failed', error: error.message, success: false });
  }
}

async function createBackgroundNotification(title, message, isSilent = false) {
  try {
    // Check for notification permission first (though background can often create without explicit page permission)
    if (chrome.notifications) {
        const options = {
            type: 'basic',
            iconUrl: 'images/icon128.png', // Use a larger icon for notifications
            title: title,
            message: message,
            priority: 2, // Max priority
            silent: isSilent // Explicitly allow sound from the system notification
        };
        const notificationId = `chat-dinger-${Date.now()}`;
        await chrome.notifications.create(notificationId, options);

        // Clear notification after a few seconds
        setTimeout(() => {
            chrome.notifications.clear(notificationId).catch(e => {
                console.warn('Chat Dinger: Could not clear notification:', notificationId, e.message);
            });
        }, 5000); // Increased to 5 seconds
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
      // A ChatGPT tab is open, let's focus it.
      // Sort by last accessed time to pick the most recent one.
      const targetTab = tabs.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
      
      // First, focus the window that the tab is in.
      await chrome.windows.update(targetTab.windowId, { focused: true });
      // Then, make the tab active within its window.
      await chrome.tabs.update(targetTab.id, { active: true });
    } else {
      // No ChatGPT tab is open, create a new one.
      await chrome.tabs.create({ url: 'https://chatgpt.com/' });
    }
  } catch (error) {
    console.error('Chat Dinger: Error handling notification click:', error);
    // As a robust fallback, just create a new tab on error.
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  } finally {
    // Always clear the notification after it's been handled.
    chrome.notifications.clear(notificationId).catch(e => {
        console.warn('Chat Dinger: Could not clear clicked notification:', notificationId, e.message);
    });
  }
});


// Chrome Store Safe: Conservative keep-alive system (remains unchanged)
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
      if (heartbeatCount > 15) { // Max ~6 minutes of keep-alive (25s * 15 ~ 375s)
        stopCriticalTaskHeartbeat();
      }
    } catch (error) {
      console.error('Chat Dinger: Heartbeat failed:', error.message);
      stopCriticalTaskHeartbeat(); // Stop if error occurs
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
  // Start heartbeat for actions that might take a moment or involve async operations.
  if (message.action === 'testSound' || message.action === 'playNotificationSound') {
    startCriticalTaskHeartbeat();
    // Stop heartbeat after a reasonable time for these actions to complete.
    setTimeout(() => {
      stopCriticalTaskHeartbeat();
    }, 8000); // 8 seconds max for these specific actions.
  }
  // 'return true' is handled by the main listener at the top.
});


chrome.runtime.onSuspend.addListener(() => {
  stopCriticalTaskHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  stopCriticalTaskHeartbeat(); // Ensure any orphaned heartbeat is stopped.
  setupPeriodicCleanup(); // Run cleanup on startup
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      chatAlertSettings: {
        enabled: true,
        volume: 0.7,
        selectedSound: 'cryptic.wav', // Updated default
        enableNotifications: true
      }
    }).catch(e => console.error('Chat Dinger: Failed to set default settings:', e.message));
  }
  setupPeriodicCleanup(); // Also run cleanup on install/update
});


function setupPeriodicCleanup() {
  chrome.storage.local.get(['last-cleanup']).then(result => {
    const lastCleanup = result['last-cleanup'] || 0;
    const now = Date.now();
    if (now - lastCleanup > 3600000) { // Once per hour
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
          typeof value === 'number' && (now - items['last-heartbeat'] > 7200000)) { // Older than 2 hours
        keysToRemove.push(key);
      }
    }
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove);
    }
    chrome.storage.local.set({ 'last-cleanup': now });
  }).catch(e => console.warn('Chat Dinger: Storage cleanup failed:', e.message));
}

// Initial setup
setupPeriodicCleanup();