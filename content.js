// Chat Dinger - Complete Enhanced Version for Chrome Store
console.log('Chat Dinger: by discofish.')
let soundPlayCount = 0;
let hasShownPopup = false;
const askThreshold = 7;

// Audio management - Fixed initialization
let globalAudioContext = null;
let audioContextUnlocked = false;
let lastUserInteraction = 0; 

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
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.warn('Chat Dinger: Extension context invalidated, cannot save sound count');
            return false;
        }
        
        await chrome.storage.local.set({ 
            soundPlayCount: soundPlayCount,
            hasShownPopup: hasShownPopup 
        });
        return true;
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            console.warn('Chat Dinger: Extension context invalidated during save - this is normal after extension reload');
            return false;
        }
        console.error('Chat Dinger: Failed to save sound count:', error);
        return false;
    }
}

// Show the popup after threshold plays
function showThanksPopup() {
    const overlay = document.createElement('div');
    overlay.id = 'chat-dinger-popup-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        max-width: 400px;
        text-align: center;
        position: relative;
        animation: slideIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateY(-50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    popup.innerHTML = `
        <div style="margin-bottom: 16px;">
            <div style="font-size: 48px; margin-bottom: 8px;"></div>
            <h2 style="margin: 0; color: #333; font-size: 20px;">I know now's probably a bad time...</h2>
            <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            BUT, here's the deal...
        </p>
        </div>
        <img style="width: 100%; max-width: 200px; margin-bottom: 16px;" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You">
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            i will stop annoying you with popups, asking for a review if you leave me a review.
        </p>
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            (the review link is in the popup where you set your sounds. shake on it and you will never hear from me again.)
        </p>

        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
            <button id="deal" style="
                background: #4285f4;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
            ">🤝 Deal</button> 

        </div>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById('deal').addEventListener('click', () => {
        hasShownPopup = true;
        saveSoundCount();
        overlay.remove();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// Detect which site we're on
const SITE = (() => {
    const hostname = window.location.hostname;
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
        return 'CHATGPT';
    } else if (hostname.includes('claude.ai')) {
        return 'CLAUDE';
    }
    return 'UNKNOWN';
})();

// Settings management
let settings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'coin'
};

// Audio management
let canPlayAlertSound = true;

// ChatGPT monitoring variables
let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true;
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;

let claudeButtonExists = false;
let claudeGenerationInProgress = false;
let claudeButtonHasExistedBefore = false;
let claudeUserJustSubmitted = false; // New flag to track user submissions
let claudeLastButtonClickTime = 0;   // Track when user clicked send


// Load settings from storage
async function loadSettings() {
    try {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.warn('Chat Dinger: Extension context invalidated, using default settings');
            return;
        }
        
        const result = await chrome.storage.local.get(['chatAlertSettings']);
        if (result.chatAlertSettings) {
            settings = { ...settings, ...result.chatAlertSettings };
        }
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            console.warn('Chat Dinger: Extension context invalidated during load - using defaults');
            return;
        }
        console.error('Chat Dinger: Failed to load settings:', error);
    }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
        console.warn('Chat Dinger: Extension context invalidated, ignoring message');
        sendResponse({ status: 'Extension context invalidated' });
        return false;
    }
    
    switch (message.action) {
        case 'settingsUpdated':
            settings = { ...settings, ...message.settings };
            sendResponse({ status: 'Settings updated' });
            break;
            
        case 'testSound':
            playSound(message.soundFile || settings.selectedSound, message.volume || settings.volume);
            sendResponse({ status: 'Test sound played' });
            break;
            
        default:
            sendResponse({ status: 'Unknown action' });
    }
    return true;
});

// Audio functions - Fixed to prevent AudioContext errors
function createAudioContext() {
    if (!globalAudioContext) {
        try {
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Chat Dinger: Failed to create AudioContext:', e);
            return null;
        }
    }
    return globalAudioContext;
}


async function unlockAudioContext() {
    try {
        // Don't try to unlock if we haven't had a very recent user interaction
        if (!lastUserInteraction || (Date.now() - lastUserInteraction) > 5000) {
            return false;
        }

        // Only create context when we actually need it and have user interaction
        const audioContext = createAudioContext();
        if (!audioContext) return false;
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        audioContextUnlocked = true;
        return true;
    } catch (e) {
        console.error('Chat Dinger: Failed to unlock audio context:', e);
        return false;
    }
}

async function createCoinSound(volume = 0.4) {
    try {
        // Check if we have recent user interaction
        if (!lastUserInteraction || (Date.now() - lastUserInteraction) > 30000) {
            return await createNotificationSound('Chat response ready!');
        }

        // Try to ensure audio context is ready
        const contextReady = await ensureAudioContextReady();
        if (!contextReady) {
            return await createNotificationSound('Chat response ready!');
        }

        const audioContext = globalAudioContext;
        if (!audioContext || audioContext.state === 'suspended') {
            return await createNotificationSound('Chat response ready!');
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
        console.error('Chat Dinger: Web Audio failed, using notification:', e);
        return await createNotificationSound('Chat response ready!');
    }
}
async function createBeep(volume = 0.5) {
    try {
        // Check if we have recent user interaction
        if (!lastUserInteraction || (Date.now() - lastUserInteraction) > 30000) {
            return await createNotificationSound('Chat response ready!');
        }

        // Try to ensure audio context is ready
        const contextReady = await ensureAudioContextReady();
        if (!contextReady) {
            return await createNotificationSound('Chat response ready!');
        }

        const audioContext = globalAudioContext;
        if (!audioContext || audioContext.state === 'suspended') {
            return await createNotificationSound('Chat response ready!');
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
        console.error('Chat Dinger: Web Audio beep failed, using notification:', e);
        return await createNotificationSound('Chat response ready!');
    }
}

async function createNotificationSound(message = 'Chat response ready!') {
    try {
        // Check if extension context is still valid first
        if (!chrome.runtime?.id) {
            console.warn('Chat Dinger: Extension context invalidated, cannot create notification');
            return false;
        }
        
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                const notification = new Notification('Chat Dinger', {
                    body: message,
                    icon: chrome.runtime.getURL('images/icon32.png'),
                    silent: false,
                    tag: 'chat-dinger-response',
                    requireInteraction: false
                });
                
                setTimeout(() => {
                    notification.close();
                }, 3000);
                
                return true;
            } else if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    return await createNotificationSound(message);
                }
            }
        }
        
        // Try background script as fallback
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'playNotificationSound',
                message: message
            });
            return response.success || false;
        } catch (e) {
            if (e.message.includes('Extension context invalidated')) {
                console.warn('Chat Dinger: Extension context invalidated during notification');
                return false;
            }
            console.error('Chat Dinger: Background notification failed:', e);
        }
        
        console.warn('Chat Dinger: All notification methods failed');
        return false;
    } catch (e) {
        console.error('Chat Dinger: Notification sound failed:', e);
        return false;
    }
}

async function playAudioFile(soundFile, volume) {
    try {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.warn('Chat Dinger: Extension context invalidated, cannot play audio file');
            return false;
        }
        
        const audio = new Audio(chrome.runtime.getURL(`sounds/${soundFile}`));
        audio.volume = Math.min(volume, 1.0);
        audio.preload = 'auto';
        
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            await playPromise;
            return true;
        }
    } catch (e) {
        console.error('Chat Dinger: Audio file playback failed for', soundFile, ':', e);
        // Don't auto-fallback to notification here - let the caller decide
        return false;
    }
    return false;
}

async function playSound(soundFile = null, volume = null) {
    const audioFile = soundFile || settings.selectedSound;
    const audioVolume = volume !== null ? volume : settings.volume;
    
    
    // Handle generated sounds first (these work better when minimized)
    if (audioFile === 'beep') {
        const success = await createBeep(audioVolume);
        if (success) return true;
    }
    
    if (audioFile === 'coin') {
        const success = await createCoinSound(audioVolume);
        if (success) return true;
    }
    
    // Try audio files for other sounds
    if (audioFile !== 'beep' && audioFile !== 'coin') {
        const audioSuccess = await playAudioFile(audioFile, audioVolume);
        if (audioSuccess) {
            return true;
        }
        
        // Fallback to coin sound instead of notification if audio file fails
        const coinSuccess = await createCoinSound(audioVolume);
        if (coinSuccess) return true;
    }
    
    // Final fallback to notification (works when minimized)
    return await createNotificationSound('Your chat response is ready!');
}

function trackUserInteraction() {
    lastUserInteraction = Date.now();
    // Don't immediately try to unlock - just record the interaction
}

async function ensureAudioContextReady() {
    if (!audioContextUnlocked && lastUserInteraction && (Date.now() - lastUserInteraction) < 5000) {
        return await unlockAudioContext();
    }
    return audioContextUnlocked;
}


['click', 'keydown', 'touchstart', 'mousedown'].forEach(eventType => {
    document.addEventListener(eventType, trackUserInteraction, { passive: true });
});

// Main alert function
async function playAlert() {
    if (!settings.enabled) {
        return;
    }

    if (!canPlayAlertSound) {
        return;
    }
    
    
    const success = await playSound();
    
    if (success) {
        soundPlayCount++;
        
        if (soundPlayCount >= askThreshold && !hasShownPopup) {
            setTimeout(showThanksPopup, 1000);
        }
        
        // Only try to save if extension context is valid
        if (soundPlayCount % 5 === 0) {
            const saveSuccess = await saveSoundCount();
            if (!saveSuccess) {
                console.warn('Chat Dinger: Could not save sound count, extension may have been reloaded');
            }
        }
    }

    canPlayAlertSound = false;
    setTimeout(() => {
        canPlayAlertSound = true;
    }, 2000);
}

// ========================================
// CHATGPT LOGIC
// ========================================

const CHATGPT_SELECTORS = [
    '#composer-submit-button',
    '[data-testid="send-button"]',
    '[data-testid*="send"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="Stop"]',
    'form button[type="submit"]',
    'button:has(svg)',
    'textarea ~ button',
    '[contenteditable] ~ button'
];

function getChatGPTButtonState(button) {
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const textContent = (button.textContent || '').toLowerCase().trim();
    const isDisabled = button.disabled;
    
    const hasStopIndicator = ['stop', 'cancel', 'interrupt'].some(keyword => 
        ariaLabel.includes(keyword) || textContent.includes(keyword)
    );
    
    const hasSendIndicator = ['send', 'submit'].some(keyword => 
        ariaLabel.includes(keyword) || textContent.includes(keyword)
    );
    
    return {
        isGenerating: hasStopIndicator || (isDisabled && !hasSendIndicator),
        ariaLabel,
        textContent,
        isDisabled,
        hasSendIndicator
    };
}

function processChatGPTButtonState(buttonElement) {
    const currentState = getChatGPTButtonState(buttonElement);
        
    if (chatgptFirstGenerationCheck && !currentState.isGenerating && chatgptIsGenerating) {
        playAlert();
        chatgptFirstGenerationCheck = false;
    }
    else if (!chatgptFirstGenerationCheck && chatgptIsGenerating && !currentState.isGenerating) {
        playAlert();
    }
    else if (chatgptFirstGenerationCheck && currentState.isGenerating) {
        chatgptFirstGenerationCheck = false;
    }
    
    chatgptIsGenerating = currentState.isGenerating;
}
function addChatGPTClickListener(button) {
    if (button.dataset.chatgptListener) {
        return;
    }
    
    button.dataset.chatgptListener = 'true';
    
    button.addEventListener('click', async (event) => {
        const state = getChatGPTButtonState(button);
        
        // Only try to unlock audio context when user clicks send button
        if (state.hasSendIndicator) {
            lastUserInteraction = Date.now();
            // Don't immediately unlock, wait until we need to play sound
        }
    }, { passive: true });
}

function cleanupChatGPTObservers() {
    if (chatgptAttributeChangeObserver) {
        chatgptAttributeChangeObserver.disconnect();
        chatgptAttributeChangeObserver = null;
    }
    if (chatgptButtonRemovedObserver) {
        chatgptButtonRemovedObserver.disconnect();
        chatgptButtonRemovedObserver = null;
    }
}

function handleChatGPTButtonRemoved() {
    if (chatgptIsGenerating) {
        playAlert();
    }
    cleanupChatGPTObservers();
    chatgptButtonInstance = null;
    chatgptIsGenerating = false;
    chatgptFirstGenerationCheck = true;
    observeForChatGPTButton();
}

function startMonitoringChatGPTButton(button) {
    if (chatgptButtonInstance === button && chatgptAttributeChangeObserver && chatgptButtonRemovedObserver) {
        return;
    }

    cleanupChatGPTObservers();
    chatgptButtonInstance = button;

    addChatGPTClickListener(button);
    chatgptFirstGenerationCheck = true;

    const initialState = getChatGPTButtonState(chatgptButtonInstance);
    chatgptIsGenerating = initialState.isGenerating;
    
    chatgptAttributeChangeObserver = new MutationObserver(mutationsList => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'attributes') {
                if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
                    processChatGPTButtonState(chatgptButtonInstance);
                }
            } else if (mutation.type === 'childList' || mutation.type === 'characterData') {
                if (chatgptButtonInstance && document.contains(chatgptButtonInstance)) {
                    processChatGPTButtonState(chatgptButtonInstance);
                }
            }
        }
    });
    
    chatgptAttributeChangeObserver.observe(chatgptButtonInstance, { 
        attributes: true, 
        childList: true,
        subtree: true,
        characterData: true
    });

    const parentElement = chatgptButtonInstance.parentElement;
    if (parentElement) {
        chatgptButtonRemovedObserver = new MutationObserver(mutationsList => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    let buttonWasRemoved = false;
                    mutation.removedNodes.forEach(removedNode => {
                        if (removedNode === chatgptButtonInstance || removedNode.contains?.(chatgptButtonInstance)) {
                            buttonWasRemoved = true;
                        }
                    });
                    if (buttonWasRemoved) {
                        handleChatGPTButtonRemoved();
                        return;
                    }
                }
            }
        });
        chatgptButtonRemovedObserver.observe(parentElement, { childList: true, subtree: true });
    }
}

function findChatGPTButton() {
    for (const selector of CHATGPT_SELECTORS) {
        try {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
                const state = getChatGPTButtonState(button);
                const hasRelevantContent = state.ariaLabel || state.textContent;
                
                if (hasRelevantContent) {
                    return button;
                }
            }
        } catch (e) {
            // Continue to next selector
        }
    }
    return null;
}

function observeForChatGPTButton() {
    if (chatgptInitialButtonFinderObserver) {
        chatgptInitialButtonFinderObserver.disconnect();
        chatgptInitialButtonFinderObserver = null;
    }

    const button = findChatGPTButton();
    if (button) {
        startMonitoringChatGPTButton(button);
        return;
    }

    chatgptInitialButtonFinderObserver = new MutationObserver((mutationsList, observer) => {
        const foundButton = findChatGPTButton();
        if (foundButton) {
            observer.disconnect();
            chatgptInitialButtonFinderObserver = null;
            startMonitoringChatGPTButton(foundButton);
        }
    });

    chatgptInitialButtonFinderObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}

// ========================================
// CLAUDE LOGIC
// ========================================
function findClaudeButton() {
    const selectors = [
        'fieldset button[aria-label*="Send"]',
        'fieldset button[aria-label*="send"]',
        'button[aria-label="Send message"]',
        'fieldset button'
    ];
    
    for (const selector of selectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
            const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes('send')) {
                return button;
            }
        }
    }
    return null;
}
function setupClaudeMonitoring() {
    // Use event delegation to catch clicks on dynamically created buttons
    document.addEventListener('click', function(event) {
        const clickedElement = event.target;
        
        // Check if clicked element or its parent is a send button
        let sendButton = null;
        if (clickedElement.matches('fieldset button[aria-label*="Send"], fieldset button[aria-label*="send"], button[aria-label="Send message"]')) {
            sendButton = clickedElement;
        } else if (clickedElement.closest('fieldset button[aria-label*="Send"], fieldset button[aria-label*="send"], button[aria-label="Send message"]')) {
            sendButton = clickedElement.closest('fieldset button[aria-label*="Send"], fieldset button[aria-label*="send"], button[aria-label="Send message"]');
        }
        
        if (sendButton) {
            const ariaLabel = (sendButton.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes('send')) {
                // Record interaction and mark that user just submitted
                lastUserInteraction = Date.now();
                claudeUserJustSubmitted = true;
                claudeLastButtonClickTime = Date.now();
                console.log('Claude: User clicked send button via event delegation');
                
                // Set a shorter timeout to detect when generation starts
                setTimeout(() => {
                    if (claudeUserJustSubmitted && !claudeGenerationInProgress) {
                        const currentButton = findClaudeButton();
                        if (!currentButton) {
                            claudeGenerationInProgress = true;
                            console.log('Claude: Generation detected after send click');
                        }
                    }
                }, 100);
            }
        }
    }, true); // Use capture phase to catch events early
    
    function checkClaudeButton() {
        const button = findClaudeButton();
        const buttonExists = !!button;
        
        // Reset user submission flag after some time (in case generation never starts)
        if (claudeUserJustSubmitted && (Date.now() - claudeLastButtonClickTime) > 15000) {
            claudeUserJustSubmitted = false;
            console.log('Claude: Reset user submission flag (timeout)');
        }
        
        if (buttonExists !== claudeButtonExists) {
            console.log('Claude: Button state changed -', buttonExists ? 'appeared' : 'disappeared');
        }
        
        if (buttonExists) {
            claudeButtonHasExistedBefore = true;
        }
        
        // Button disappeared - generation likely started
        if (claudeButtonExists && !buttonExists) {
            if (claudeUserJustSubmitted) {
                claudeGenerationInProgress = true;
                console.log('Claude: Generation started after user submission');
            } else {
                console.log('Claude: Button disappeared but no recent user submission - ignoring');
            }
        }
        
        // Button reappeared - generation likely completed
        if (!claudeButtonExists && buttonExists && claudeGenerationInProgress && claudeUserJustSubmitted) {
            console.log('Claude: Generation completed - playing alert');
            playAlert();
            claudeGenerationInProgress = false;
            claudeUserJustSubmitted = false; // Reset the flag
        }
        
        // Button reappeared without generation in progress (e.g., navigating to existing chat)
        if (!claudeButtonExists && buttonExists && !claudeGenerationInProgress) {
            console.log('Claude: Button appeared without generation - likely navigated to chat');
            // Don't play alert in this case
        }
        
        claudeButtonExists = buttonExists;
    }
    
    setInterval(checkClaudeButton, 500);
    checkClaudeButton();
}
// ========================================
// INITIALIZATION
// ========================================

function startChatGPTMaintenance() {
    setInterval(() => {
        if (!chatgptButtonInstance || !document.contains(chatgptButtonInstance)) {
            observeForChatGPTButton();
        }
    }, 5000);
}

window.testChatDinger = () => playAlert();

async function init() {
    if (SITE === 'UNKNOWN') {
        return;
    }
    
    await loadSettings();
    await loadSoundCount();
    
    // Don't create AudioContext here - wait for user interaction
    
    if ('Notification' in window && Notification.permission === 'default') {
    }
    
    
    if (SITE === 'CHATGPT') {
        observeForChatGPTButton();
        startChatGPTMaintenance();
    } else if (SITE === 'CLAUDE') {
        setupClaudeMonitoring();
    }
}

init();