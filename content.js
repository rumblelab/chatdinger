// Chat Dinger - Enhanced Version for Chrome Store (Prioritizing Background Notifications for Hidden Tabs)
console.log('Chat Dinger: Content script loaded. By discofish.');

let soundPlayCount = 0;
let hasShownPopup = false;
const askThreshold = 7;

let lastUserInteraction = 0;

// Settings management
let settings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'cryptic.wav'
};
let canPlayAlertSound = true;

// ChatGPT monitoring variables
let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true;
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;

const SITE = (() => {
    const hostname = window.location.hostname;
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
        return 'CHATGPT';
    }
    return 'UNKNOWN';
})();

function resetDingerStateForTesting() {
    console.log('Resetting Chat Dinger state...');
    soundPlayCount = 0;
    hasShownPopup = false;
    // Use your existing save function to update chrome.storage.local
    saveSoundCount().then(() => {
        console.log('Chat Dinger state has been reset. The popup will show on the next alert (after threshold is met).');
    });
}

// Listen for the events dispatched by the bridge functions
window.addEventListener('run_dinger_test', () => {
    console.log('Chat Dinger: Test event received. Running alert.');
    playAlert();
});

window.addEventListener('run_dinger_reset', () => {
    console.log('Chat Dinger: Reset event received. Resetting state.');
    // This function is the same one we created before
    resetDingerStateForTesting();
});

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
        if (!chrome.runtime?.id) {
            // console.warn('Chat Dinger: Extension context invalidated, cannot save sound count');
            return false;
        }
        await chrome.storage.local.set({
            soundPlayCount: soundPlayCount,
            hasShownPopup: hasShownPopup
        });
        return true;
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            // console.warn('Chat Dinger: Extension context invalidated during save - this is normal after extension reload');
            return false;
        }
        console.error('Chat Dinger: Failed to save sound count:', error);
        return false;
    }
}

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
        <div style="font-size: 48px; margin-bottom: 8px;"></div>
        <h2 style="margin: 0; color: #333; font-size: 20px;">Quick deal?</h2>
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            No more annoying popups. Just a simple handshake between us.
        </p>
        <img style="display: block; margin: 0 auto 16px; width: 100%; max-width: 200px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            Tell one friend about ChatDinger. That’s it. Do that, and I’ll never bug you with another popup again.
        </p>

    </div>
    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
        <button id="deal" style="background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">🤝 Deal</button>
    </div>
    <p style="color: #666; margin: 16px 0; line-height: 1.4; font-size: 10px">
        This is your one and only popup. You’ll still hear the ding, but you might hear guilt if you don’t share. 😉
    </p>
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

async function loadSettings() {
    try {
        if (!chrome.runtime?.id) { return; }
        const result = await chrome.storage.local.get(['chatAlertSettings', 'customSelectors']);
        if (result.chatAlertSettings) {
            settings = { ...settings, ...result.chatAlertSettings };
        }
        if (result.customSelectors && result.customSelectors.length > 0) {
            currentChatGptSelectors = result.customSelectors;
        } else {
            currentChatGptSelectors = [...DEFAULT_CHATGPT_SELECTORS];
        }
    } catch (error) {
        if (!error.message.includes('Extension context invalidated')) {
            console.error('Chat Dinger: Failed to load settings:', error);
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!chrome.runtime?.id) {
        sendResponse({ status: 'Extension context invalidated', success: false });
        return false;
    }
    switch (message.action) {
        case 'settingsUpdated':
            settings = { ...settings, ...message.settings };
            sendResponse({ status: 'Settings updated in content script', success: true });
            break;
        case 'testSound':
            playSound(message.soundFile || settings.selectedSound, message.volume || settings.volume, true)
                .then(success => sendResponse({ status: success ? 'Test sound processed by content script' : 'Test sound failed in content script', success }))
                .catch(error => sendResponse({ status: 'Test sound error in content script', success: false, error: error.message }));
            return true;
        default:
            sendResponse({ status: 'Unknown action in content script', success: false });
    }
    return true;
});

function trackUserInteraction() {
    lastUserInteraction = Date.now();
}

['click', 'keydown', 'touchstart', 'mousedown'].forEach(eventType => {
    document.addEventListener(eventType, trackUserInteraction, { passive: true, capture: true });
});

async function playAudioFile(soundFile, volume) {
    try {
        if (!chrome.runtime?.id) { return false; }
        const soundUrl = chrome.runtime.getURL(`sounds/${soundFile}`);
        if (!soundUrl) { console.error('Chat Dinger: Could not get URL for sound file:', soundFile); return false; }
        const audio = new Audio(soundUrl);
        audio.volume = Math.min(Math.max(0, parseFloat(volume) || 0.7), 1.0);
        audio.preload = 'auto';
        if (Date.now() - lastUserInteraction > 10000) { // Increased threshold
            console.warn("Chat Dinger: No recent user interaction, HTML5 audio play might be blocked.");
        }
        await audio.play();
        return true;
    } catch (e) {
        console.error(`Chat Dinger: HTML5 Audio file playback failed for ${soundFile}: ${e.message} (Name: ${e.name})`);
        return false;
    }
}

async function requestBackgroundNotification(title, messageText) {
    if (!chrome.runtime?.id) {
        console.warn("Chat Dinger: Cannot request background notification, extension context invalid.");
        return false;
    }
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'playNotificationSound',
            title: title,
            message: messageText
        });
        return response?.success || false;
    } catch (e) {
        if (!e.message.includes("Could not establish connection")) { // Common if background is momentarily unavailable
            console.error("Chat Dinger: Error messaging background for notification:", e);
        } else {
            console.warn("Chat Dinger: Could not connect to background for notification. It might be restarting.");
        }
        return false;
    }
}


async function playSound(soundFile = null, volume = null, isTest = false) {
    if (!settings.notifyOnActiveTab && !document.hidden && !isTest) return;
    const selectedSoundSetting = soundFile || settings.selectedSound;
    const audioVolume = volume !== null ? settings.volume : settings.volume;
    let effectiveSoundFile = selectedSoundSetting;

    if (selectedSoundSetting === 'coin' && !selectedSoundSetting.endsWith('.wav')) effectiveSoundFile = 'cryptic.wav';
    
    if (!effectiveSoundFile || typeof effectiveSoundFile !== 'string' || !effectiveSoundFile.includes('.')) {
        console.error('Chat Dinger: Invalid sound file, using cryptic.wav:', effectiveSoundFile);
        effectiveSoundFile = 'cryptic.wav';
    }

    // If page is hidden or not visible, prioritize background notification
    if (document.hidden || document.visibilityState !== 'visible') {
        return await requestBackgroundNotification('ChatDinger', `Your ChatGPT response is ready!`);
    }

    // Page is visible, try HTML5 audio first
    const audioPlayedInPage = await playAudioFile(effectiveSoundFile, audioVolume);
    if (audioPlayedInPage) {
        return true;
    }

    // HTML5 audio failed while page was visible, fallback to background notification
    console.warn(`Chat Dinger: In-page audio failed for ${effectiveSoundFile} (page visible). Using background notification fallback.`);
    return await requestBackgroundNotification('Chat Dinger', `Response ready! (Sound: ${effectiveSoundFile.split('.')[0]})`);
}

async function playAlert() {
    if (!settings.enabled) return;
    if (!settings.notifyOnActiveTab && !document.hidden) return;
    if (!canPlayAlertSound) return;
    canPlayAlertSound = false;


    const soundPlayed = await playSound(); // playSound now handles visibility checks internally

    if (soundPlayed) {
        soundPlayCount++;
        if (soundPlayCount = askThreshold && !hasShownPopup) {
            setTimeout(showThanksPopup, 1000);
        }
        if (soundPlayCount % 3 === 0 || soundPlayed) {
            await saveSoundCount();
        }
    } else {
        console.warn("Chat Dinger: All sound playing methods seemed to fail for this alert.");
    }
    setTimeout(() => { canPlayAlertSound = true; }, 2000);
}


const DEFAULT_CHATGPT_SELECTORS = [
    // 1. Most stable & generic: any test-id that *ends* with send-/stop-button
    'button[data-testid$="send-button"]',
    'button[data-testid$="stop-button"]',
  
    // 2. Legacy single-id build (fast fallback, but only in a few buckets)
    '#composer-submit-button',
  
    // 3. Aria-label fallbacks (keep, but low priority)
    'button[aria-label="Send prompt"]:has(svg)',
    'button[aria-label="Stop streaming"]:has(svg)'
  ];

let currentChatGptSelectors = [...DEFAULT_CHATGPT_SELECTORS];

function getChatGPTButtonState(button) {
    if (!button || !button.getAttribute) return { isGenerating: false, ariaLabel: '', textContent: '', isDisabled: true, hasSendIndicator: false, hasStopIndicator: false };
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const textContent = (button.textContent || '').toLowerCase().trim();
    const isDisabled = button.disabled;
    let svgPathData = '';
    const svg = button.querySelector('svg');
    if (svg) {
        const path = svg.querySelector('path');
        if (path) svgPathData = (path.getAttribute('d') || '').toLowerCase();
    }
    const hasStopIndicator = ['stop', 'cancel', 'interrupt'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword)) || (svgPathData.includes('m4.5') && svgPathData.includes('h14.25')); // Adjusted to match the stop button svg
    const hasSendIndicator = ['send', 'submit'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword)) || (svgPathData.includes('m8.99') && svgPathData.includes('l9.29')); // Adjusted to match the send button svg
    let isGenerating = hasStopIndicator || (isDisabled && !hasSendIndicator);
    if (hasSendIndicator && !isDisabled) isGenerating = false;
    if (hasStopIndicator && !isDisabled) isGenerating = true;
    return { isGenerating, ariaLabel, textContent, isDisabled, hasSendIndicator, hasStopIndicator, svgPathData };
}

function processChatGPTButtonState(buttonElement) {
    const currentState = getChatGPTButtonState(buttonElement);
    if (chatgptFirstGenerationCheck && !currentState.isGenerating && chatgptIsGenerating) {
        playAlert(); chatgptFirstGenerationCheck = false;
    } else if (!chatgptFirstGenerationCheck && chatgptIsGenerating && !currentState.isGenerating) {
        playAlert();
    } else if (chatgptFirstGenerationCheck && currentState.isGenerating) {
        chatgptFirstGenerationCheck = false;
    } else if (!chatgptIsGenerating && currentState.isGenerating) {
        chatgptFirstGenerationCheck = false;
    }
    chatgptIsGenerating = currentState.isGenerating;
}

function addChatGPTClickListener(button) {
    if (!button || button.dataset.chatgptListener === 'true') return;
    button.dataset.chatgptListener = 'true';
    button.addEventListener('click', trackUserInteraction, { passive: true });
}

function cleanupChatGPTObservers() {
    if (chatgptAttributeChangeObserver) chatgptAttributeChangeObserver.disconnect();
    if (chatgptButtonRemovedObserver) chatgptButtonRemovedObserver.disconnect();
    chatgptAttributeChangeObserver = null; chatgptButtonRemovedObserver = null;
}

function handleChatGPTButtonRemoved() {
    if (chatgptIsGenerating) playAlert();
    cleanupChatGPTObservers();
    chatgptButtonInstance = null; chatgptIsGenerating = false; chatgptFirstGenerationCheck = true;
    observeForChatGPTButton();
}

function startMonitoringChatGPTButton(button) {
    if (!button) { observeForChatGPTButton(); return; }
    if (chatgptButtonInstance === button && chatgptAttributeChangeObserver) return;
    cleanupChatGPTObservers();
    chatgptButtonInstance = button;
    addChatGPTClickListener(button);
    chatgptFirstGenerationCheck = true;
    const initialState = getChatGPTButtonState(chatgptButtonInstance);
    chatgptIsGenerating = initialState.isGenerating;
    if (chatgptIsGenerating) chatgptFirstGenerationCheck = false;
    chatgptAttributeChangeObserver = new MutationObserver(() => {
        if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
            processChatGPTButtonState(chatgptButtonInstance);
        }
    });
    chatgptAttributeChangeObserver.observe(chatgptButtonInstance, { attributes: true, childList: true, subtree: true, characterData: true });
    const parentElement = chatgptButtonInstance.parentElement;
    if (parentElement) {
        chatgptButtonRemovedObserver = new MutationObserver(() => {
            if (!document.contains(chatgptButtonInstance)) handleChatGPTButtonRemoved();
        });
        chatgptButtonRemovedObserver.observe(parentElement, { childList: true });
    }
}

function findChatGPTButton() {
    for (const selector of currentChatGptSelectors) {
        let buttons;
        try {
            buttons = document.querySelectorAll(selector);
        }
        catch {
            continue; // malformed selector ⇒ skip
        }

        if (!buttons.length) continue; // nothing matched ⇒ next rule

        for (const button of buttons) {
            // Check if the button is visible on the page.
            if (button.offsetWidth && button.offsetHeight) {
                return button; // Return the first visible button that matches.
            }
        }
    }
    return null;
}

function observeForChatGPTButton() {
    if (chatgptInitialButtonFinderObserver) chatgptInitialButtonFinderObserver.disconnect();
    const button = findChatGPTButton();
    if (button) { startMonitoringChatGPTButton(button); return; }
    chatgptInitialButtonFinderObserver = new MutationObserver(() => {
        const foundButton = findChatGPTButton();
        if (foundButton) {
            if (chatgptInitialButtonFinderObserver) chatgptInitialButtonFinderObserver.disconnect();
            chatgptInitialButtonFinderObserver = null;
            startMonitoringChatGPTButton(foundButton);
        }
    });
    chatgptInitialButtonFinderObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// ========================================
// INITIALIZATION
// ========================================
function startChatGPTMaintenance() {
    setInterval(() => {
        if (!chatgptButtonInstance || !document.contains(chatgptButtonInstance)) {
            observeForChatGPTButton();
        }
    }, 7000);
}

async function init() {
    if (SITE === 'UNKNOWN') return;
    await loadSettings();
    await loadSoundCount();
    if (SITE === 'CHATGPT') {
        observeForChatGPTButton();
        startChatGPTMaintenance();
    }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init); // Changed from 'load' to 'DOMContentLoaded' for earlier execution
}