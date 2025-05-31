// Popup script for ChatGPT Alert settings

// DOM elements
const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');
const volumeThumb = document.getElementById('volume-thumb');

// Default settings
const defaultSettings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'coin'
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
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get(['chatAlertSettings']);
            if (result.chatAlertSettings) {
                currentSettings = { ...defaultSettings, ...result.chatAlertSettings };
            }
        }
        updateUI();
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
        const thumbPosition = ((volume / 100) * (containerWidth - 18)) + 2; // Account for borders and thumb width
        volumeThumb.style.left = `${Math.max(2, Math.min(thumbPosition, containerWidth - 18))}px`;
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

testSoundBtn.addEventListener('click', async () => {
    const originalText = testSoundBtn.textContent;
    testSoundBtn.textContent = 'Playing...';
    testSoundBtn.disabled = true;
    
    try {
        // Handle beep sound locally in popup
        if (currentSettings.selectedSound === 'beep') {
            // Create beep directly in popup context
            await createPopupBeep(currentSettings.volume);
            showStatus('Test beep played!');
        } else if (typeof chrome !== 'undefined' && chrome.tabs) {
            // Try to find an active ChatGPT or Claude tab to play the sound
            const tabs = await chrome.tabs.query({ 
                active: true, 
                url: [
                    "*://chatgpt.com/*", 
                    "*://chat.openai.com/*",
                    "*://claude.ai/*"
                ] 
            });
            
            if (tabs.length > 0) {
                // Play sound in chat tab
                const response = await chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'testSound',
                    soundFile: currentSettings.selectedSound,
                    volume: currentSettings.volume
                });
                showStatus('Test sound played!');
            } else {
                // No chat tab active, try background method
                const response = await chrome.runtime.sendMessage({
                    action: 'testSound',
                    soundFile: currentSettings.selectedSound,
                    volume: currentSettings.volume
                });
                
                if (response.error) {
                    showStatus(response.error, true);
                } else {
                    showStatus('Test sound played!');
                }
            }
        } else {
            // Fallback for testing without chrome extension
            showStatus('Test sound played!');
        }
    } catch (error) {
        if (error.message && error.message.includes('chrome://')) {
            showStatus('Please open ChatGPT or Claude to test sounds', true);
        } else {
            showStatus('Test sound failed - make sure ChatGPT or Claude is open', true);
        }
    }
    
    setTimeout(() => {
        testSoundBtn.textContent = originalText;
        testSoundBtn.disabled = false;
    }, 1000);
});

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

async function createPopupCoin(volume = 0.5) {
    try {
        const audioContext = createAudioContext();
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        
        // Classic coin sound frequency pattern
        oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1319, audioContext.currentTime + 0.1);
        
        oscillator.type = 'square';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
        
        return true;
    } catch (e) {
        return false;
    }
}



// Check if ChatGPT or Claude tabs are open
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
            if (tabs.length === 0) {
                showStatus('Open ChatGPT or Claude to enable notifications');
            }
        }
    } catch (error) {
        console.error('Error checking supported tabs:', error);}
}

// Window controls (just for show)
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
    
    // Ensure UI is updated after elements are rendered and have dimensions
    setTimeout(() => {
        updateUI();
    }, 100);
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Also update volume display when window resizes (in case slider container size changes)
window.addEventListener('resize', updateVolumeDisplay);