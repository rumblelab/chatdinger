// Enhanced popup script for Chat Dinger (Prioritizing HTML5 Audio Test)

const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');
const volumeThumb = document.getElementById('volume-thumb');
const activeTabToggle = document.getElementById('active-tab-toggle');


let onChatGPTPage = false;

const defaultSettings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'cryptic.wav', 
    notifyOnActiveTab: true,
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
            const result = await chrome.storage.local.get(['chatAlertSettings']);
            if (result.chatAlertSettings) {
                currentSettings = { ...defaultSettings, ...result.chatAlertSettings };
            }
        }
        updateUI();
        validateSettings();
    } catch (error) {
        console.error("Chat Dinger: Error loading settings:", error);
        showStatus('Failed to load settings', true);
    }
}

async function getChatGPTTabs() {
    // This query finds all currently open ChatGPT tabs.
    return await chrome.tabs.query({
        url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
    });
}

async function saveSettings() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
            await chrome.storage.local.set({ chatAlertSettings: currentSettings });
            const tabs = await getChatGPTTabs(); 
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
    activeTabToggle.classList.toggle('checked', currentSettings.notifyOnActiveTab);
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

activeTabToggle.addEventListener('click', async function() {
    this.classList.toggle('checked');
    currentSettings.notifyOnActiveTab = this.classList.contains('checked');
    await saveSettings();
    showStatus(`Notify on active tab ${currentSettings.notifyOnActiveTab ? 'Enabled' : 'Disabled'}`);
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
const devCollapsible = document.getElementById('developer-tools');
const devTriggerBtn = document.getElementById('dev-trigger-ding');
const devResetBtn = document.getElementById('dev-reset-count');

// Add click listener to make the developer section collapsible
if (devCollapsible) {
    const title = devCollapsible.querySelector('.group-title');
    if (title) {
        title.addEventListener('click', () => {
            devCollapsible.classList.toggle('expanded');
        });
    }
}

// This helper function safely dispatches an event on the active page
async function dispatchEventOnPage(eventName) {
    try {
        // Find the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            showStatus('No active tab found.', true);
            return;
        }

        // Use the modern, CSP-safe scripting API
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN', // IMPORTANT: This targets the main page world
            func: (event) => window.dispatchEvent(new CustomEvent(event)),
            args: [eventName],
        });
        showStatus(`'${eventName}' sent to page.`);
    } catch (e) {
        console.error(`Failed to dispatch event '${eventName}':`, e);
        showStatus(`Error: ${e.message}`, true);
    }
}

// Hook up the buttons to the helper function
if (devTriggerBtn) {
    devTriggerBtn.addEventListener('click', () => {
        dispatchEventOnPage('run_dinger_test');
    });
}

if (devResetBtn) {
    devResetBtn.addEventListener('click', () => {
        dispatchEventOnPage('run_dinger_reset');
    });
}

if (devCollapsible) {
    // Get the extension's manifest details
    const manifest = chrome.runtime.getManifest();
    
    // The 'update_url' is only present for extensions installed from a store.
    // If it exists, this is a "production" build, so we hide the developer tools.
    if (manifest.update_url) {
        devCollapsible.style.display = 'none';
    }
}

window.addEventListener('resize', updateVolumeDisplay);