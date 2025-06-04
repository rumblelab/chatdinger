// Complete Enhanced background script for Chat Dinger
// Chrome Store safe version with notification support

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.action === 'testSound') {
    handleTestSound(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  if (message.action === 'playNotificationSound') {
    handleNotificationSound(message, sendResponse);
    return true;
  }
  
  // Handle other messages...
  return true;
});

async function handleTestSound(message, sendResponse) {
  try {
    // Try to find active tab first
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tabs.length === 0) {
      sendResponse({ status: 'No active tab', error: 'Please open ChatGPT or Claude' });
      return;
    }
    
    const tab = tabs[0];
    
    // Check if the tab URL is accessible (not chrome://, chrome-extension://, etc.)
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:')) {
      console.warn('Background: Cannot inject into chrome:// or restricted pages');
      
      // Try notification fallback for restricted pages
      const success = await createBackgroundNotification('Chat Dinger Test', 'Test sound via notification');
      sendResponse({ 
        status: success ? 'Test notification played' : 'Cannot test on this page',
        error: success ? null : 'Please open ChatGPT or Claude for full testing'
      });
      return;
    }
    
    // Check if tab is a supported site
    const supportedSites = ['chatgpt.com', 'chat.openai.com', 'claude.ai'];
    const isSupported = supportedSites.some(site => tab.url.includes(site));
    
    if (!isSupported) {
      console.warn('Background: Tab is not a supported chat site');
      
      // Try notification fallback for unsupported sites
      const success = await createBackgroundNotification('Chat Dinger Test', 'Test sound via notification');
      sendResponse({ 
        status: success ? 'Test notification played' : 'Unsupported site',
        error: success ? null : 'Works best on ChatGPT or Claude'
      });
      return;
    }
    
    const soundFile = message.soundFile || 'default.wav';
    const volume = message.volume || 0.7;
    
    // Try to inject and play sound in tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: playTestSoundInTab,
        args: [soundFile, volume]
      });
      
      sendResponse({ status: 'Test sound played in tab' });
    } catch (error) {
      console.error('Background: Script injection failed:', error);
      
      // Fallback to notification
      const success = await createBackgroundNotification('Chat Dinger Test', 'Test sound via notification fallback');
      sendResponse({ 
        status: success ? 'Test notification played' : 'Test failed',
        error: success ? null : 'Please refresh the page and try again'
      });
    }
    
  } catch (error) {
    console.error('Background: Test sound error:', error);
    sendResponse({ status: 'Test failed', error: error.message });
  }
}

// Function to be injected into tab
function playTestSoundInTab(soundFile, volume) {
  try {
    console.log('Chat Dinger: Playing test sound in tab:', soundFile, volume);
    
    // Try Web Audio API first for generated sounds
    if (soundFile === 'beep' || soundFile === 'coin') {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Try to resume if suspended
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            console.log('Chat Dinger: Audio context resumed for test');
          }).catch(e => {
            console.warn('Chat Dinger: Could not resume audio context:', e);
          });
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        if (soundFile === 'beep') {
          gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          oscillator.type = 'sine';
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        } else if (soundFile === 'coin') {
          gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
          oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(1319, audioContext.currentTime + 0.1);
          oscillator.type = 'square';
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        }
        console.log('Chat Dinger: Generated sound played successfully');
        return;
      } catch (e) {
        console.error('Chat Dinger: Web Audio API failed:', e);
      }
    }
    
    // Try HTML Audio for files
    try {
      const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
      audio.volume = volume;
      audio.preload = 'auto';
      
      // Enhanced properties for better background playback
      if ('preservesPitch' in audio) {
        audio.preservesPitch = false;
      }
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('Chat Dinger: Audio file played successfully');
        }).catch(e => {
          console.error('Chat Dinger: Audio file playback failed:', e);
          
          // Final fallback to beep
          try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            gainNode.gain.setValueAtTime(volume * 0.5, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.type = 'sine';
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
            console.log('Chat Dinger: Fallback beep played');
          } catch (fallbackError) {
            console.error('Chat Dinger: All audio methods failed:', fallbackError);
          }
        });
      }
    } catch (e) {
      console.error('Chat Dinger: HTML Audio creation failed:', e);
      
      // Try one more fallback beep
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNode.gain.setValueAtTime(volume * 0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        oscillator.type = 'sine';
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        console.log('Chat Dinger: Emergency fallback beep played');
      } catch (emergencyError) {
        console.error('Chat Dinger: Even emergency fallback failed:', emergencyError);
      }
    }
    
  } catch (e) {
    console.error('Chat Dinger: Test sound injection completely failed:', e);
  }
}

async function handleNotificationSound(message, sendResponse) {
  try {
    const title = message.title || 'Chat Dinger';
    const body = message.message || 'Your chat response is ready!';
    
    const success = await createBackgroundNotification(title, body);
    sendResponse({ 
      status: success ? 'Notification sound played' : 'Notification failed',
      success: success
    });
  } catch (error) {
    console.error('Background: Notification sound handler error:', error);
    sendResponse({ status: 'Notification sound failed', error: error.message, success: false });
  }
}

async function createBackgroundNotification(title, message) {
  try {
    const options = {
      type: 'basic',
      iconUrl: 'images/icon32.png',
      title: title,
      message: message,
      silent: false, // Allow system notification sound
      requireInteraction: false
    };
    
    const notificationId = `chat-dinger-${Date.now()}`;
    await chrome.notifications.create(notificationId, options);
    
    // Clear notification after 3 seconds
    setTimeout(() => {
      chrome.notifications.clear(notificationId).catch(e => {
        console.warn('Chat Dinger: Could not clear notification:', e);
      });
    }, 3000);
    
    console.log('Chat Dinger: Notification created successfully');
    return true;
  } catch (error) {
    console.error('Chat Dinger: Notification creation failed:', error);
    return false;
  }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('chat-dinger')) {
    chrome.notifications.clear(notificationId).catch(e => {
      console.warn('Chat Dinger: Could not clear clicked notification:', e);
    });
  }
});

// Chrome Store Safe: Conservative keep-alive system
let messageHandlingInProgress = false;
let heartbeatInterval = null;
let heartbeatCount = 0;

function startCriticalTaskHeartbeat() {
  if (heartbeatInterval) return; // Already running
  
  messageHandlingInProgress = true;
  heartbeatCount = 0;
  console.log('Chat Dinger: Starting critical task heartbeat');
  
  // Chrome Store Safe: Use storage API calls to maintain service worker
  // This is documented as acceptable in Chrome's official docs
  heartbeatInterval = setInterval(async () => {
    try {
      heartbeatCount++;
      
      // Minimal storage operation to reset timeout
      const current = await chrome.storage.local.get(['heartbeat-count']);
      await chrome.storage.local.set({ 
        'last-heartbeat': Date.now(),
        'heartbeat-count': (current['heartbeat-count'] || 0) + 1,
        'session-heartbeats': heartbeatCount
      });
      
      console.log(`Chat Dinger: Heartbeat ${heartbeatCount}`);
      
      // Safety: Stop after reasonable number of beats
      if (heartbeatCount > 20) { // Max ~8 minutes of keep-alive
        console.log('Chat Dinger: Max heartbeats reached, stopping');
        stopCriticalTaskHeartbeat();
      }
      
    } catch (error) {
      console.error('Chat Dinger: Heartbeat failed:', error);
    }
  }, 25000); // 25 seconds - well within safe limits
}

function stopCriticalTaskHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    messageHandlingInProgress = false;
    console.log(`Chat Dinger: Stopped heartbeat after ${heartbeatCount} beats`);
    heartbeatCount = 0;
  }
}

// Only use heartbeat when actively handling messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'testSound' || message.action === 'playNotificationSound') {
    startCriticalTaskHeartbeat();
    
    // Stop heartbeat after reasonable time
    setTimeout(() => {
      stopCriticalTaskHeartbeat();
    }, 10000); // 10 seconds max for test sounds
  }
  
  // Always return true to keep message channel open
  return true;
});

// Clean up on service worker events
chrome.runtime.onSuspend.addListener(() => {
  console.log('Chat Dinger: Service worker suspending, cleaning up');
  stopCriticalTaskHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Chat Dinger: Service worker starting up');
  // Reset any persistent state
  stopCriticalTaskHeartbeat();
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Chat Dinger: Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    console.log('Chat Dinger: First time install - setting up defaults');
    
    // Set default settings on first install
    chrome.storage.local.set({
      chatAlertSettings: {
        enabled: true,
        volume: 0.7,
        selectedSound: 'coin',
        enableNotifications: true
      }
    }).catch(e => {
      console.error('Chat Dinger: Failed to set default settings:', e);
    });
  }
});

// Periodic cleanup (runs every 5 minutes when service worker is active)
// Use more conservative approach for Chrome Store safety
function setupPeriodicCleanup() {
  // Only clean up when actually needed, not on a timer
  chrome.storage.local.get(['last-cleanup']).then(result => {
    const lastCleanup = result['last-cleanup'] || 0;
    const now = Date.now();
    
    // Only cleanup once per hour
    if (now - lastCleanup > 3600000) {
      cleanupOldStorage();
    }
  }).catch(e => {
    console.warn('Chat Dinger: Cleanup check failed:', e);
  });
}

function cleanupOldStorage() {
  chrome.storage.local.get(null).then(items => {
    const now = Date.now();
    const keysToRemove = [];
    
    for (const [key, value] of Object.entries(items)) {
      // Remove old heartbeat entries (older than 1 hour)
      if (key.startsWith('last-heartbeat') && typeof value === 'number' && (now - value) > 3600000) {
        keysToRemove.push(key);
      }
    }
    
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove);
      console.log(`Chat Dinger: Cleaned up ${keysToRemove.length} old storage entries`);
    }
    
    // Update last cleanup time
    chrome.storage.local.set({ 'last-cleanup': now });
  }).catch(e => {
    console.warn('Chat Dinger: Storage cleanup failed:', e);
  });
}

// Run cleanup on startup
setupPeriodicCleanup();

// Chrome Store Safe: Log extension activity for debugging (not resource intensive)
console.log('Chat Dinger: Background script loaded - Chrome Store safe version');
console.log('Chat Dinger: Service worker lifecycle managed with conservative keep-alive');