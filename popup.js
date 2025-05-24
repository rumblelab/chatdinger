// Popup script for ChatGPT Alert settings
console.log('ChatGPT Alert: Popup loaded');

// DOM elements
const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');

// Default settings
const defaultSettings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'default.wav'
};

// Current settings
let currentSettings = { ...defaultSettings };

// Show status message
function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${isError ? 'status-error' : 'status-success'}`;
    statusMessage.classList.remove('hidden');
    
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 3000);
}

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(['chatAlertSettings']);
        if (result.chatAlertSettings) {
            currentSettings = { ...defaultSettings, ...result.chatAlertSettings };
        }
        updateUI();
        console.log('Settings loaded:', currentSettings);
    } catch (error) {
        console.error('Failed to load settings:', error);
        showStatus('Failed to load settings', true);
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        await chrome.storage.local.set({ chatAlertSettings: currentSettings });
        console.log('Settings saved:', currentSettings);
        
        // Notify content scripts about settings change
        const tabs = await chrome.tabs.query({ url: ["*://chatgpt.com/*", "*://chat.openai.com/*"] });
        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'settingsUpdated',
                    settings: currentSettings
                });
            } catch (e) {
                // Tab might not have content script, ignore
            }
        }
        
        showStatus('Settings saved!');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showStatus('Failed to save settings', true);
    }
}

// Update UI based on current settings
function updateUI() {
    enabledToggle.checked = currentSettings.enabled;
    volumeSlider.value = Math.round(currentSettings.volume * 100);
    volumeValue.textContent = Math.round(currentSettings.volume * 100) + '%';
    soundSelect.value = currentSettings.selectedSound;
}

// Event listeners
enabledToggle.addEventListener('change', async () => {
    currentSettings.enabled = enabledToggle.checked;
    await saveSettings();
});

volumeSlider.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100;
    currentSettings.volume = volume;
    volumeValue.textContent = volumeSlider.value + '%';
});

volumeSlider.addEventListener('change', async () => {
    await saveSettings();
});

soundSelect.addEventListener('change', async () => {
    currentSettings.selectedSound = soundSelect.value;
    await saveSettings();
});

testSoundBtn.addEventListener('click', async () => {
    testSoundBtn.textContent = '🎵 Playing...';
    testSoundBtn.disabled = true;
    
    try {
        // Try to find an active ChatGPT tab to play the sound
        const tabs = await chrome.tabs.query({ 
            active: true, 
            url: ["*://chatgpt.com/*", "*://chat.openai.com/*"] 
        });
        
        if (tabs.length > 0) {
            // Play sound in ChatGPT tab
            await chrome.tabs.sendMessage(tabs[0].id, {
                action: 'testSound',
                soundFile: currentSettings.selectedSound,
                volume: currentSettings.volume
            });
            showStatus('Test sound played!');
        } else {
            // No ChatGPT tab, try to play in background
            await chrome.runtime.sendMessage({
                action: 'testSound',
                soundFile: currentSettings.selectedSound,
                volume: currentSettings.volume
            });
            showStatus('Test sound played!');
        }
    } catch (error) {
        console.error('Test sound failed:', error);
        showStatus('Test sound failed - make sure ChatGPT is open', true);
    }
    
    setTimeout(() => {
        testSoundBtn.textContent = '🎵 Test Sound';
        testSoundBtn.disabled = false;
    }, 1000);
});

// Check if ChatGPT tabs are open
async function checkChatGPTTabs() {
    try {
        const tabs = await chrome.tabs.query({ url: ["*://chatgpt.com/*", "*://chat.openai.com/*"] });
        if (tabs.length === 0) {
            showStatus('Open ChatGPT to enable notifications', false);
        }
    } catch (error) {
        console.error('Failed to check tabs:', error);
    }
}

// Initialize popup
async function init() {
    await loadSettings();
    await checkChatGPTTabs();
}

// Start initialization
init();