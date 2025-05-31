// Chat Dinger - Works with ChatGPT and Claude
//righthook tracking
console.log('Chat Dinger: by discofish.')
let soundPlayCount = 0;
let hasShownPopup = false;
const askThreshold = 7; // Show popup after 10 plays

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
        await chrome.storage.local.set({ 
            soundPlayCount: soundPlayCount,
            hasShownPopup: hasShownPopup 
        });
    } catch (error) {
        console.error('Chat Dinger: Failed to save sound count:', error);
    }
}
// Show the popup after 10 plays
function showThanksPopup() {
    // Create popup overlay
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

    // Create the popup
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

    // Add slide-in animation
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
        <image style="align-items: center" src="${chrome.runtime.getURL('images/gentlemansagreementfinal.jpeg')}" alt="Thank You" style="width: 100%; max-width: 200px; margin-bottom: 16px;">
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            in exchange for a review, we will give you access to something sweet. 
        </p>
        <p style="color: #666; margin: 16px 0; line-height: 1.4;">
            (the review link is in the popup where you set your sounds. )
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

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // Close on Escape key
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
let audioContextUnlocked = false;
let globalAudioContext = null;

// ChatGPT monitoring (original approach)
let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
let chatgptFirstGenerationCheck = true; // Flag for first generation
let canPlayAlertSound = true;

// ChatGPT Observers
let chatgptAttributeChangeObserver = null;
let chatgptButtonRemovedObserver = null;
let chatgptInitialButtonFinderObserver = null;

// Claude monitoring (reappearance approach)
let claudeButtonExists = false;
let claudeGenerationInProgress = false;
let claudeButtonHasExistedBefore = false;

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(['chatAlertSettings']);
        if (result.chatAlertSettings) {
            settings = { ...settings, ...result.chatAlertSettings };
        }
    } catch (error) {
        console.error('Chat Dinger: Failed to load settings:', error);
    }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

// Audio functions
function createAudioContext() {
    if (!globalAudioContext) {
        globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return globalAudioContext;
}

async function unlockAudioContext() {
    try {
        const audioContext = createAudioContext();
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        audioContextUnlocked = true;
        return true;
    } catch (e) {
        return false;
    }
}

async function createCoinSound(volume = 0.4) {
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
        oscillator.stop(audioContext.currentTime + 0.5);
        
        return true;
    } catch (e) {
        return false;
    }
}

async function createBeep(volume = 0.5) {
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
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = 'sine';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        return true;
    } catch (e) {
        return false;
    }
}
async function playSound(soundFile = null, volume = null) {
    const audioFile = soundFile || settings.selectedSound;
    const audioVolume = volume !== null ? volume : settings.volume;
    
    // Handle the special 'beep' case
    if (audioFile === 'beep') {
        await createBeep(audioVolume);
        return true;
    }
    if (audioFile === 'coin'){
        await createCoinSound(audioVolume);
        return true;
    }
    
    // Try to play regular audio file
    try {
        const audio = new Audio(chrome.runtime.getURL(`sounds/${audioFile}`));
        audio.volume = audioVolume;
        await audio.play();
        return true;
    } catch (e) {
        console.error('Chat Dinger: Audio file failed, falling back to beep:', e);
        await createBeep(audioVolume);
        return false;
    }
}

// Main alert function
async function playAlert() {
    // Check if notifications are enabled
    if (!settings.enabled) {
        return;
    }

    if (!canPlayAlertSound) {
        return;
    }
        
    await playSound();

    // Increment counter and check for popup
    soundPlayCount++;
    
    // Show popup after 10 plays (and user hasn't seen it yet)
    if (soundPlayCount >= askThreshold && !hasShownPopup) {
        setTimeout(showThanksPopup, 1000); // Small delay so sound finishes first
    }
    
    // Save count periodically
    if (soundPlayCount % 5 === 0) {
        await saveSoundCount();
    }

    // Debounce
    canPlayAlertSound = false;
    setTimeout(() => {
        canPlayAlertSound = true;
    }, 2000);
}

// ========================================
// CHATGPT LOGIC (from working script)
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
        
    // For first generation in new chat, allow any completion (generation goes from true to false)
    if (chatgptFirstGenerationCheck && !currentState.isGenerating && chatgptIsGenerating) {
        playAlert();
        chatgptFirstGenerationCheck = false; // Reset flag after first generation
    }
    // Normal case: generation just completed
    else if (!chatgptFirstGenerationCheck && chatgptIsGenerating && !currentState.isGenerating) {
        playAlert();
    }
    // Reset first generation flag once we see a generating state
    else if (chatgptFirstGenerationCheck && currentState.isGenerating) {
        chatgptFirstGenerationCheck = false; // We've seen generation start, no longer first
    }
    
    chatgptIsGenerating = currentState.isGenerating;
}

function addChatGPTClickListener(button) {
    if (button.dataset.chatgptListener) {
        return; // Already has listener
    }
    
    button.dataset.chatgptListener = 'true';
    
    button.addEventListener('click', async (event) => {
        const state = getChatGPTButtonState(button);
        
        // Only unlock on send clicks (not stop clicks)
        if (state.hasSendIndicator && !audioContextUnlocked) {
            await unlockAudioContext();
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
    chatgptFirstGenerationCheck = true; // Reset for new chat
    observeForChatGPTButton();
}

function startMonitoringChatGPTButton(button) {
    if (chatgptButtonInstance === button && chatgptAttributeChangeObserver && chatgptButtonRemovedObserver) {
        return;
    }

    cleanupChatGPTObservers();
    chatgptButtonInstance = button;

    // Add click listener for audio unlocking
    addChatGPTClickListener(button);

    // Reset first generation flag for new button (new chat)
    chatgptFirstGenerationCheck = true;

    const initialState = getChatGPTButtonState(chatgptButtonInstance);
    chatgptIsGenerating = initialState.isGenerating;
    
    // Watch for all types of changes
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

    // Watch for button removal
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
// CLAUDE LOGIC (reappearance approach)
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
    
    function checkClaudeButton() {
        const button = findClaudeButton();
        const buttonExists = !!button;
        
        // Log state changes for debugging
        if (buttonExists !== claudeButtonExists) {
        }
        
        // Track if button has ever existed (to avoid new chat false positives)
        if (buttonExists) {
            claudeButtonHasExistedBefore = true;
        }
        
        // Button disappeared - generation likely started
        if (claudeButtonExists && !buttonExists) {
            claudeGenerationInProgress = true;
        }
        
        // Button reappeared after being gone - generation completed!
        // BUT only if button has existed before (not new chat)
        if (!claudeButtonExists && buttonExists && claudeGenerationInProgress && claudeButtonHasExistedBefore) {
            playAlert();
            claudeGenerationInProgress = false; // Reset flag
        }
        
        // Add click listener when button exists (for audio unlock)
        if (buttonExists && button && !button.dataset.claudeListener) {
            button.dataset.claudeListener = 'true';
            
            button.addEventListener('click', async (event) => {
                
                if (!audioContextUnlocked) {
                    await unlockAudioContext();
                }
            });
            
        }
        
        claudeButtonExists = buttonExists;
    }
    
    // Check every 500ms
    setInterval(checkClaudeButton, 500);
    
    // Initial check
    checkClaudeButton();
}

// ========================================
// INITIALIZATION
// ========================================

// ChatGPT periodic maintenance
function startChatGPTMaintenance() {
    setInterval(() => {
        if (!chatgptButtonInstance || !document.contains(chatgptButtonInstance)) {
            observeForChatGPTButton();
        }
    }, 5000);
}

// Manual test function
window.testChatDinger = () => playAlert();

// Initialize based on site
async function init() {
    if (SITE === 'UNKNOWN') {
        return;
    }
    
    // Load settings and sound count
    await loadSettings();
    await loadSoundCount();
    
    if (SITE === 'CHATGPT') {
        observeForChatGPTButton();
        startChatGPTMaintenance();
    } else if (SITE === 'CLAUDE') {
        setupClaudeMonitoring();
    }
}

// Start the extension
init();