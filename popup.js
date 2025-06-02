// Enhanced popup script for Chat Dinger

// DOM elements
const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');
const volumeThumb = document.getElementById('volume-thumb');

// Default settings with new options
const defaultSettings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'coin',
    enableNotifications: true
};

let currentSettings = { ...defaultSettings };

// Show status message
function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${isError ? 'status-error' : 'status-success'}`;
    statusMessage.classList.remove('hidden');
    
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 4000);
}

// Request notification permission
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                showStatus('Notification permission granted - better reliability when minimized!');
                currentSettings.enableNotifications = true;
                await saveSettings();
            } else {
                showStatus('Notification permission denied - some features may not work when minimized', true);
                currentSettings.enableNotifications = false;
                await saveSettings();
            }
        } catch (error) {
            console.error('Failed to request notification permission:', error);
        }
    }
}

// Load settings from storage
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
        showStatus('Failed to load settings', true);
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            await chrome.storage.local.set({ chatAlertSettings: currentSettings });
            
            // Notify content scripts about settings change
            const tabs = await chrome.tabs.query({ 
                url: [
                    "*://chatgpt.com/*", 
                    "*://chat.openai.com/*",
                    "*://claude.ai/*"
                ] 
            });
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
        }
        showStatus('Settings saved!');
    } catch (error) {
        showStatus('Failed to save settings', true);
    }
}

// Update UI based on current settings
function updateUI() {
    // Update checkbox
    if (currentSettings.enabled) {
        enabledToggle.classList.add('checked');
    } else {
        enabledToggle.classList.remove('checked');
    }
    
    // Update volume slider and display
    const volumePercent = Math.round(currentSettings.volume * 100);
    volumeSlider.value = volumePercent;
    updateVolumeDisplay();
    
    // Update sound selection
    soundSelect.value = currentSettings.selectedSound;
}

// Update volume display and thumb position
function updateVolumeDisplay() {
    const volume = parseInt(volumeSlider.value);
    volumeValue.textContent = `Volume: ${volume}%`;
    
    // Update visual slider thumb position
    const sliderContainer = document.getElementById('volume-slider-container');
    if (sliderContainer) {
        const containerWidth = sliderContainer.offsetWidth;
        const thumbPosition = ((volume / 100) * (containerWidth - 18)) + 2;
        volumeThumb.style.left = `${Math.max(2, Math.min(thumbPosition, containerWidth - 18))}px`;
    }
}

// Enhanced settings validation
function validateSettings() {
    const notificationStatus = getNotificationStatus();
    
    if (notificationStatus.available && !notificationStatus.permitted) {
        showStatus('Enable notifications for better reliability when Chrome is minimized');
        addNotificationEnableButton();
    }
    
    if (!window.AudioContext && !window.webkitAudioContext) {
        showStatus('Web Audio not supported - using fallback methods', true);
    }
}

function getNotificationStatus() {
    return {
        available: 'Notification' in window,
        permitted: 'Notification' in window && Notification.permission === 'granted',
        denied: 'Notification' in window && Notification.permission === 'denied'
    };
}

function addNotificationEnableButton() {
    const existingBtn = document.getElementById('enable-notifications-btn');
    if (existingBtn) return;
    
    const notificationGroup = document.createElement('div');
    notificationGroup.className = 'group-box';
    notificationGroup.innerHTML = `
        <div class="group-title">Background Mode</div>
        <div class="setting-row">
            <label class="label">Enable notifications for better reliability when Chrome is minimized</label>
        </div>
        <div class="setting-row">
            <button class="button" id="enable-notifications-btn">Enable Notifications</button>
        </div>
    `;
    
    const soundGroup = document.querySelector('.group-box:last-of-type');
    soundGroup.parentNode.insertBefore(notificationGroup, soundGroup);
    
    document.getElementById('enable-notifications-btn').addEventListener('click', async () => {
        await requestNotificationPermission();
        
        if (Notification.permission === 'granted') {
            notificationGroup.remove();
        }
    });
}

// Enhanced test sound function
testSoundBtn.addEventListener('click', async () => {
    const originalText = testSoundBtn.textContent;
    testSoundBtn.textContent = 'Playing...';
    testSoundBtn.disabled = true;
    
    try {
        let soundPlayed = false;
        
        // Method 1: Try content script in active tab
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            try {
                const tabs = await chrome.tabs.query({ 
                    active: true, 
                    url: [
                        "*://chatgpt.com/*", 
                        "*://chat.openai.com/*",
                        "*://claude.ai/*"
                    ] 
                });
                
                if (tabs.length > 0) {
                    const response = await chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'testSound',
                        soundFile: currentSettings.selectedSound,
                        volume: currentSettings.volume
                    });
                    soundPlayed = true;
                    showStatus('Test sound played in chat tab!');
                }
            } catch (e) {
                console.log('Content script method failed, trying background method');
            }
        }
        
        // Method 2: Try background script injection
        if (!soundPlayed && typeof chrome !== 'undefined' && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'testSound',
                    soundFile: currentSettings.selectedSound,
                    volume: currentSettings.volume
                });
                
                if (response.error) {
                    throw new Error(response.error);
                }
                soundPlayed = true;
                showStatus(response.status);
            } catch (e) {
                console.log('Background injection failed, trying notification method');
            }
        }
        
        // Method 3: Try notification fallback
        if (!soundPlayed && currentSettings.enableNotifications) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'playNotificationSound',
                    title: 'Chat Dinger Test',
                    message: 'Test sound played via notification!'
                });
                soundPlayed = true;
                showStatus('Test sound played via notification!');
            } catch (e) {
                console.log('Notification method failed');
            }
        }
        
        // Method 4: Local popup sound (for basic testing)
        if (!soundPlayed) {
            if (currentSettings.selectedSound === 'beep') {
                await createPopupBeep(currentSettings.volume);
                showStatus('Test beep played locally (may not work when minimized)');
            } else if (currentSettings.selectedSound === 'coin') {
                await createPopupCoin(currentSettings.volume);
                showStatus('Test coin played locally (may not work when minimized)');
            } else {
                showStatus('Please open ChatGPT or Claude to test audio files', true);
            }
        }
        
    } catch (error) {
        console.error('All test methods failed:', error);
        showStatus('Test failed - try opening ChatGPT or Claude first', true);
    }
    
    setTimeout(() => {
        testSoundBtn.textContent = originalText;
        testSoundBtn.disabled = false;
    }, 1000);
});

// Enhanced popup beep with better error handling
async function createPopupBeep(volume = 0.5) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = 'sine';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        return true;
    } catch (e) {
        console.error('Popup beep failed:', e);
        return false;
    }
}

async function createPopupCoin(volume = 0.4) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        
        oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1319, audioContext.currentTime + 0.1);
        
        oscillator.type = 'square';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        return true;
    } catch (e) {
        console.error('Popup coin failed:', e);
        return false;
    }
}

// Event listeners
enabledToggle.addEventListener('click', async function() {
    this.classList.toggle('checked');
    currentSettings.enabled = this.classList.contains('checked');
    await saveSettings();
});

volumeSlider.addEventListener('input', () => {
    updateVolumeDisplay();
    const volume = parseInt(volumeSlider.value) / 100;
    currentSettings.volume = volume;
});

volumeSlider.addEventListener('change', async () => {
    await saveSettings();
});

soundSelect.addEventListener('change', async () => {
    currentSettings.selectedSound = soundSelect.value;
    await saveSettings();
});

// Check supported tabs and notification status
async function checkSupportedTabs() {
    try {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            const tabs = await chrome.tabs.query({ 
                url: [
                    "*://chatgpt.com/*", 
                    "*://chat.openai.com/*",
                    "*://claude.ai/*"
                ] 
            });
            
            const notificationStatus = getNotificationStatus();
            
            if (tabs.length === 0) {
                if (notificationStatus.permitted) {
                    showStatus('Open ChatGPT or Claude for best experience (notifications enabled for backup)');
                } else {
                    showStatus('Open ChatGPT or Claude to enable notifications');
                }
            } else {
                if (!notificationStatus.permitted) {
                    showStatus('Extension active! Enable notifications for better reliability when minimized');
                }
            }
        }
    } catch (error) {
        console.error('Error checking supported tabs:', error);
    }
}

// Window controls (cosmetic)
document.querySelectorAll('.control-btn').forEach(btn => {
    btn.addEventListener('mousedown', function() {
        this.style.border = '1px inset #c0c0c0';
    });
    
    btn.addEventListener('mouseup', function() {
        this.style.border = '1px outset #c0c0c0';
    });
});

// Initialize popup
async function init() {
    await loadSettings();
    await checkSupportedTabs();
    
    // Request notification permission if not already granted
    if (currentSettings.enableNotifications && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => {
            requestNotificationPermission();
        }, 1000);
    }
    
    setTimeout(() => {
        updateUI();
    }, 100);
}

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.addEventListener('resize', updateVolumeDisplay);