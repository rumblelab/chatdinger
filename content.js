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
    selectedSound: 'coin.mp3'
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
            <h2 style="margin: 0; color: #333; font-size: 20px;">hey! real quick...</h2>
            <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            i know it's a bad time, but next time you hear that sweet ding, I want you to think about leaving us a review.
            </p>
        </div>
        <img style="display: block; margin: 0 auto 16px; width: 100%; max-width: 200px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            in exchange, we promise to stop annoying you with popups like this.
        </p>
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            in-fact, cause, I know you're good for it, you'll never see this popup again.
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
            <button id="deal" style="background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">🤝 Deal</button>
        </div>
    `;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    document.getElementById('deal').addEventListener('click', () => {
        hasShownPopup = true; saveSoundCount(); overlay.remove(); document.head.removeChild(style);
    });
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
        const result = await chrome.storage.local.get(['chatAlertSettings']);
        if (result.chatAlertSettings) {
            settings = { ...settings, ...result.chatAlertSettings };
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
            playSound(message.soundFile || settings.selectedSound, message.volume || settings.volume)
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


async function playSound(soundFile = null, volume = null) {
    const selectedSoundSetting = soundFile || settings.selectedSound;
    const audioVolume = volume !== null ? settings.volume : settings.volume;
    let effectiveSoundFile = selectedSoundSetting;

    if (selectedSoundSetting === 'coin' && !selectedSoundSetting.endsWith('.wav')) effectiveSoundFile = 'coin.mp3';
    
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
    if (!canPlayAlertSound) return;
    canPlayAlertSound = false;


    const soundPlayed = await playSound(); // playSound now handles visibility checks internally

    if (soundPlayed) {
        soundPlayCount++;
        if (soundPlayCount >= askThreshold && !hasShownPopup) {
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

// ========================================
// CHATGPT LOGIC (Unchanged from previous complete response)
// ========================================
const CHATGPT_SELECTORS = [
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
    const hasStopIndicator = ['stop', 'cancel', 'interrupt'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword)) || (svgPathData.includes('m6') && svgPathData.includes('h12v12h-12z'));
    const hasSendIndicator = ['send', 'submit'].some(keyword => ariaLabel.includes(keyword) || textContent.includes(keyword)) || (svgPathData.includes('m2') && svgPathData.includes('l20') && svgPathData.includes('l-20'));
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
    for (const selector of CHATGPT_SELECTORS) {
        try {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
                if (button.offsetHeight > 0 && button.offsetWidth > 0) {
                    const state = getChatGPTButtonState(button);
                    if (state.hasSendIndicator || state.hasStopIndicator || (state.isDisabled && button.type === 'submit')) return button;
                }
            }
        } catch (e) { /* console.warn(`Chat Dinger: Selector error "${selector}":`, e.message); */ }
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

window.testChatDinger = () => playAlert();

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