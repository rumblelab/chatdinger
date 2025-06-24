// Enhanced popup script for Chat Dinger (Prioritizing HTML5 Audio Test)

const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');
const volumeThumb = document.getElementById('volume-thumb');
const selectorInput = document.getElementById('selector-input');
const saveSelectorsBtn = document.getElementById('save-selectors-btn');
const restoreSelectorsBtn = document.getElementById('restore-selectors-btn');

let onChatGPTPage = false;

const DEFAULT_CHATGPT_SELECTORS = [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[class*="bottom"] > svg',
    'form button[type="submit"]',
    'textarea ~ button:not([aria-label*="Attach file"])',
    'button:has(svg[data-icon="send"])',
    'button:has(svg[data-icon="stop"])'
];

const defaultSettings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'coin.mp3', // Default to a .wav file
    enableNotifications: true // For OS-level notifications fallback
};

let currentSettings = { ...defaultSettings };

function showStatus(message, isError = false, duration = 4000) {
    statusMessage.textContent = message;
    statusMessage.className = `status-panel ${isError ? 'status-error' : 'status-success'}`;
    statusMessage.classList.remove('hidden');
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, duration);
}

async function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    showStatus('Notification permission granted! Better reliability when minimized.');
                    currentSettings.enableNotifications = true; // Though this setting might be more for general fallback
                    await saveSettings(); // Save if setting changed
                    const enableButton = document.getElementById('enable-notifications-btn');
                    if (enableButton) enableButton.closest('.group-box').remove();
                } else {
                    showStatus('Notification permission denied. Some fallback features may not work.', true);
                    currentSettings.enableNotifications = false; // Reflect user choice
                    await saveSettings();
                }
            } catch (error) {
                console.error('Chat Dinger: Failed to request notification permission:', error);
                showStatus('Error requesting notification permission.', true);
            }
        } else if (Notification.permission === 'denied') {
             showStatus('Notification permission was previously denied. Please enable it in browser settings if desired.', true, 6000);
        }
    }
}


async function loadSettings() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get(['chatAlertSettings', 'customSelectors']);
            if (result.chatAlertSettings) {
                currentSettings = { ...defaultSettings, ...result.chatAlertSettings };
            }
            // Load custom selectors or use defaults
            const selectors = result.customSelectors || DEFAULT_CHATGPT_SELECTORS;
            selectorInput.value = selectors.join('\n');
        }
        updateUI();
        validateSettings();
    } catch (error) {
        console.error("Chat Dinger: Error loading settings:", error);
        showStatus('Failed to load settings', true);
    }
}

async function saveSettings() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
            await chrome.storage.local.set({ chatAlertSettings: currentSettings });
            const tabs = await chrome.tabs.query({
                url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
            });
            for (const tab of tabs) {
                try {
                    // console.log("Popup: Sending settingsUpdated to tabId:", tab.id);
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsUpdated',
                        settings: currentSettings
                    });
                } catch (e) {
                    if (e.message.includes("Could not establish connection") || e.message.includes("Receiving end does not exist")) {
                        // console.warn(`Popup: Could not send settings to tab ${tab.id}. Content script might not be active.`);
                    } else {
                        console.error(`Popup: Error sending settings to tab ${tab.id}:`, e.message);
                    }
                }
            }
        }
        // showStatus('Settings saved!'); // Can be a bit noisy, consider only on explicit save button if added
    } catch (error) {
        console.error("Chat Dinger: Error saving settings:", error);
        showStatus('Failed to save settings', true);
    }
}

function updateUI() {
    enabledToggle.classList.toggle('checked', currentSettings.enabled);
    const volumePercent = Math.round(currentSettings.volume * 100);
    volumeSlider.value = volumePercent;
    updateVolumeDisplay(); // This will also set thumb
    soundSelect.value = currentSettings.selectedSound;
}

function updateVolumeDisplay() {
    const volume = parseInt(volumeSlider.value);
    volumeValue.textContent = `Volume: ${volume}%`;
    const sliderContainer = document.getElementById('volume-slider-container');
    if (sliderContainer) {
        const containerWidth = sliderContainer.offsetWidth;
        const thumbWidth = volumeThumb.offsetWidth || 16; // 16 is default width
        // Calculate position relative to the track, not the whole container
        const trackWidth = containerWidth - 4; // 2px border on each side of slider
        const thumbPosition = ((volume / 100) * (trackWidth - thumbWidth)) + 2; // +2 for left border
        volumeThumb.style.left = `${Math.max(2, Math.min(thumbPosition, trackWidth - thumbWidth + 2))}px`;
    }
}

function getNotificationStatus() {
    return {
        available: 'Notification' in window,
        permitted: 'Notification' in window && Notification.permission === 'granted',
        denied: 'Notification' in window && Notification.permission === 'denied',
        default: 'Notification' in window && Notification.permission === 'default',
    };
}

function addNotificationEnableButton() {
    const existingBtnContainer = document.getElementById('notification-enable-container');
    if (existingBtnContainer) return; // Already added

    const notificationGroup = document.createElement('div');
    notificationGroup.id = 'notification-enable-container';
    notificationGroup.className = 'group-box';
    notificationGroup.innerHTML = `
        <div class="group-title">System Notifications</div>
        <div class="setting-row">
            <label class="label">Enable system notifications for reliable alerts when ChatGPT is in a background tab or Chrome is minimized.</label>
        </div>
        <div class="setting-row" style="justify-content: center;">
            <button class="button" id="enable-notifications-btn">Enable System Notifications</button>
        </div>
    `;
    const soundSchemeGroup = soundSelect.closest('.group-box');
    if (soundSchemeGroup && soundSchemeGroup.parentNode) {
         soundSchemeGroup.parentNode.insertBefore(notificationGroup, soundSchemeGroup.nextSibling); // Insert after sound scheme
    } else {
        document.querySelector('.content').appendChild(notificationGroup); // Fallback append
    }


    document.getElementById('enable-notifications-btn').addEventListener('click', async () => {
        await requestNotificationPermission();
        // The button removal/status update is handled within requestNotificationPermission
    });
}

function validateSettings() {
    const notificationStatus = getNotificationStatus();
    if (notificationStatus.available && notificationStatus.default) {
        addNotificationEnableButton();
    } else {
        const enableButtonContainer = document.getElementById('notification-enable-container');
        if (enableButtonContainer && (notificationStatus.permitted || notificationStatus.denied)) {
            enableButtonContainer.remove();
        }
    }

    if (!window.AudioContext && !window.webkitAudioContext) {
        // This is less critical now as we prioritize HTML5 audio
        // showStatus('Web Audio API not fully supported by this browser.', true);
    }
}


testSoundBtn.addEventListener('click', async () => {
    if (!onChatGPTPage) {
        showStatus("Open ChatGPT tab to test.", true); // Using true for 'isError' styling
        return; // Stop the function here
    }

    const originalText = testSoundBtn.textContent;
    testSoundBtn.textContent = 'Playing...';
    testSoundBtn.disabled = true;
    let soundPlayedOrInitiated = false;

    try {
        // Method 1: Try content script in active ChatGPT/OpenAI tab
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
            try {
                const tabs = await chrome.tabs.query({
                    active: true, // Query only the active tab in the current window
                    url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
                });
                if (tabs.length > 0) {
                    // console.log('Popup: Sending testSound to content script in active tab:', tabs[0].id);
                    const response = await chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'testSound',
                        soundFile: currentSettings.selectedSound,
                        volume: currentSettings.volume
                    });
                    // console.log('Popup: Response from content script for testSound:', response);
                    if (response && response.success) {
                        showStatus(response.status || 'Test sound played in chat tab!');
                        soundPlayedOrInitiated = true;
                    } else if (response && !response.success) {
                         console.warn('Popup: Content script reported test sound failure:', response.status, response.error);
                        // Do not show error here yet, let other methods try
                    }
                }
            } catch (e) {
                if (e.message.includes("Could not establish connection") || e.message.includes("Receiving end does not exist")){
                    // console.warn('Popup: Content script in active tab not reachable or not a ChatGPT tab.');
                } else {
                    console.warn('Popup: Error messaging content script for test sound:', e.message);
                }
            }
        }

        // Method 2: Try background script injection (if content script method failed or not applicable)
        // This will try to inject into ANY active tab if not ChatGPT
        if (!soundPlayedOrInitiated && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            // console.log('Popup: Trying background script injection for testSound.');
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'testSound', // Triggers handleTestSound in background.js
                    soundFile: currentSettings.selectedSound,
                    volume: currentSettings.volume
                });
                // console.log('Popup: Response from background script for testSound (injection attempt):', response);
                if (response && response.success) {
                    showStatus(response.status || `Test sound (${currentSettings.selectedSound}) handling initiated.`);
                    soundPlayedOrInitiated = true;
                } else if (response && !response.success) {
                     console.warn('Popup: Background script reported test sound failure/issue:', response.status, response.error);
                    // Status might indicate it played as notification, so check that.
                     if (!response.status || !response.status.toLowerCase().includes('notification')) {
                        // showStatus(response.error || response.status || 'Background test failed.', true);
                     } else {
                        showStatus(response.status); // e.g. "Test notification played (injection fallback)"
                        soundPlayedOrInitiated = true; // If it played as notification, it's a success for this path
                     }
                }
            } catch (e) {
                console.error('Popup: Error sending message to background script for testSound injection:', e.message);
            }
        }

        // Method 3: As a final explicit fallback, try playing a system notification sound via background
        // This is less about testing the selected sound file and more about ensuring *any* sound can play.
        if (!soundPlayedOrInitiated && currentSettings.enableNotifications && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            // console.log('Popup: Trying background script for a direct system notification sound test.');
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'playNotificationSound',
                    title: 'Chat Dinger Test',
                    message: `Test: System Notification for ${currentSettings.selectedSound}`
                });
                // console.log('Popup: Response from background for playNotificationSound:', response);
                if (response && response.success) {
                    showStatus('Test sound played via system notification!');
                    soundPlayedOrInitiated = true;
                } else {
                    console.warn('Popup: Background system notification sound test failed.');
                }
            } catch (e) {
                console.error('Popup: Error sending playNotificationSound to background:', e.message);
            }
        }

        if (!soundPlayedOrInitiated) {
            showStatus('Test failed. Open ChatGPT or enable system notifications.', true);
        }

    } catch (error) {
        console.error('Popup: Overall test sound error:', error);
        showStatus('Test failed. Check console for details.', true);
    } finally {
        setTimeout(() => {
            testSoundBtn.textContent = originalText;
            testSoundBtn.disabled = false;
        }, 1500); // Slightly longer timeout for user to see "Playing..."
    }
});


enabledToggle.addEventListener('click', async function() {
    this.classList.toggle('checked');
    currentSettings.enabled = this.classList.contains('checked');
    await saveSettings();
    showStatus(`Notifications ${currentSettings.enabled ? 'Enabled' : 'Disabled'}`);
});

volumeSlider.addEventListener('input', () => {
    updateVolumeDisplay(); // Live update display and thumb
    currentSettings.volume = parseInt(volumeSlider.value) / 100;
});

volumeSlider.addEventListener('change', async () => { // Save on release
    await saveSettings();
    // showStatus(`Volume set to ${Math.round(currentSettings.volume * 100)}%`);
});

soundSelect.addEventListener('change', async () => {
    currentSettings.selectedSound = soundSelect.value;
    await saveSettings();
    showStatus(`Sound changed to: ${soundSelect.options[soundSelect.selectedIndex].text}`);
});


document.querySelectorAll('.control-btn').forEach(btn => {
    btn.addEventListener('mousedown', function() { this.style.borderStyle = 'inset'; });
    btn.addEventListener('mouseup', function() { this.style.borderStyle = 'outset'; });
    btn.addEventListener('mouseleave', function() { this.style.borderStyle = 'outset'; });
});

async function setTestButtonState() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        const currentTab = tabs[0];
        const isChatGPTPage = currentTab.url && (currentTab.url.startsWith('https://chat.openai.com') || currentTab.url.startsWith('https://chatgpt.com'));
        
        onChatGPTPage = isChatGPTPage; // Set the global variable
      } else {
        onChatGPTPage = false; // Default to false if no tab found
      }
    } catch (error) {
      console.warn('Could not determine tab state:', error);
      onChatGPTPage = false;
    }
    
    // The button is no longer disabled here, it's always active.
    testSoundBtn.disabled = false;
    testSoundBtn.title = 'Test the selected sound';
  }

  saveSelectorsBtn.addEventListener('click', async () => {
    const newSelectors = selectorInput.value
        .split('\n')
        .map(s => s.trim()) // Remove leading/trailing whitespace
        .filter(s => s); // Remove any empty lines

    if (newSelectors.length === 0) {
        showStatus('Cannot save empty selector list.', true);
        return;
    }

    try {
        await chrome.storage.local.set({ customSelectors: newSelectors });

        // Notify the active content scripts of the change
        const tabs = await chrome.tabs.query({
            url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
        });

        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'selectorsUpdated',
                    selectors: newSelectors
                });
            } catch (e) {
                console.warn(`Could not send selector update to tab ${tab.id}. It might not be ready.`);
            }
        }
        showStatus('Selectors saved and applied!', false);
    } catch (error) {
        console.error("Chat Dinger: Error saving selectors:", error);
        showStatus('Failed to save selectors.', true);
    }
});

restoreSelectorsBtn.addEventListener('click', async () => {
    // Populate the textarea with the defaults
    selectorInput.value = DEFAULT_CHATGPT_SELECTORS.join('\n');
    // Trigger the save functionality to persist and apply them
    saveSelectorsBtn.click();
    showStatus('Default selectors restored and saved.');
});


async function init() {
    await loadSettings(); // Loads settings, updates UI, validates
    await setTestButtonState(); 
    updateVolumeDisplay(); // Ensure thumb is correct on initial load after container is sized
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
window.addEventListener('resize', updateVolumeDisplay);