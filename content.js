// Final Chat Dinger - Works with ChatGPT and Claude
console.log('Chat Dinger: Final hybrid script loaded!');

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

console.log(`Chat Dinger: Detected site: ${SITE}`);

// Settings management
let settings = {
    enabled: true,
    volume: 0.7,
    selectedSound: 'alert.mp3'
};

// Audio management
let audioContextUnlocked = false;
let globalAudioContext = null;

// ChatGPT monitoring (original approach)
let chatgptButtonInstance = null;
let chatgptIsGenerating = false;
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
        console.log('Chat Dinger: Settings loaded:', settings);
    } catch (error) {
        console.error('Chat Dinger: Failed to load settings:', error);
    }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'settingsUpdated':
            settings = { ...settings, ...message.settings };
            console.log('Chat Dinger: Settings updated:', settings);
            sendResponse({ status: 'Settings updated' });
            break;
            
        case 'testSound':
            console.log('Chat Dinger: Test sound requested');
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
        console.log(`✅ Chat Dinger: Audio unlocked via ${SITE} send button click!`);
        return true;
    } catch (e) {
        console.error('Failed to unlock audio context:', e);
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
        console.error('Fallback beep failed:', e);
        return false;
    }
}

// Play sound function - uses current settings
async function playSound(soundFile = null, volume = null) {
    const audioFile = soundFile || settings.selectedSound;
    const audioVolume = volume !== null ? volume : settings.volume;
    
    try {
        const audio = new Audio(chrome.runtime.getURL(`sounds/${audioFile}`));
        audio.volume = audioVolume;
        await audio.play();
        console.log(`✅ Chat Dinger: Played ${audioFile} at volume ${Math.round(audioVolume * 100)}% on ${SITE}`);
        return true;
    } catch (e) {
        console.warn(`Chat Dinger: Failed to play ${audioFile}, using fallback beep:`, e.message);
        await createBeep(audioVolume);
        return false;
    }
}

// Main alert function
async function playAlert() {
    // Check if notifications are enabled
    if (!settings.enabled) {
        console.log('Chat Dinger: Notifications disabled, skipping alert');
        return;
    }
    
    if (!canPlayAlertSound) {
        console.log('Chat Dinger: Alert debounced.');
        return;
    }
    
    console.log(`🎉 Chat Dinger: ${SITE} generation completed! Playing notification...`);
    
    await playSound();

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
    
    console.log(`Chat Dinger: ChatGPT state check - Was generating: ${chatgptIsGenerating}, Now generating: ${currentState.isGenerating}`);
    
    // Generation just completed
    if (chatgptIsGenerating && !currentState.isGenerating) {
        playAlert();
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
            console.log('🎯 Chat Dinger: ChatGPT send button clicked - unlocking audio...');
            await unlockAudioContext();
        }
    }, { passive: true });
    
    console.log('✅ Chat Dinger: Added click listener to ChatGPT send button');
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
    console.log('Chat Dinger: ChatGPT submit button was removed from DOM.');
    if (chatgptIsGenerating) {
        playAlert();
    }
    cleanupChatGPTObservers();
    chatgptButtonInstance = null;
    chatgptIsGenerating = false;
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

    const initialState = getChatGPTButtonState(chatgptButtonInstance);
    chatgptIsGenerating = initialState.isGenerating;
    
    console.log(`Chat Dinger: Now monitoring ChatGPT button. Initial state - generating: ${chatgptIsGenerating}`);

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
    console.log('Chat Dinger: Looking for ChatGPT button...');
    
    for (const selector of CHATGPT_SELECTORS) {
        try {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
                const state = getChatGPTButtonState(button);
                const hasRelevantContent = state.ariaLabel || state.textContent;
                
                if (hasRelevantContent) {
                    console.log(`Chat Dinger: Found ChatGPT button with selector "${selector}"`);
                    return button;
                }
            }
        } catch (e) {
            console.log(`Chat Dinger: Selector "${selector}" failed:`, e);
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
        console.log('Chat Dinger: Found ChatGPT button immediately.');
        startMonitoringChatGPTButton(button);
        return;
    }

    console.log('Chat Dinger: ChatGPT button not found. Observing DOM for its appearance...');
    chatgptInitialButtonFinderObserver = new MutationObserver((mutationsList, observer) => {
        const foundButton = findChatGPTButton();
        if (foundButton) {
            console.log('Chat Dinger: Found ChatGPT button via DOM observer.');
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
    console.log('🔍 Setting up Claude monitoring...');
    
    function checkClaudeButton() {
        const button = findClaudeButton();
        const buttonExists = !!button;
        
        // Log state changes for debugging
        if (buttonExists !== claudeButtonExists) {
            console.log(`🔄 Claude button state changed: ${claudeButtonExists ? 'exists' : 'missing'} → ${buttonExists ? 'exists' : 'missing'}`);
        }
        
        // Track if button has ever existed (to avoid new chat false positives)
        if (buttonExists) {
            claudeButtonHasExistedBefore = true;
        }
        
        // Button disappeared - generation likely started
        if (claudeButtonExists && !buttonExists) {
            console.log('🔄 Claude button disappeared - generation likely started');
            claudeGenerationInProgress = true;
        }
        
        // Button reappeared after being gone - generation completed!
        // BUT only if button has existed before (not new chat)
        if (!claudeButtonExists && buttonExists && claudeGenerationInProgress && claudeButtonHasExistedBefore) {
            console.log('🎉 Claude button reappeared after generation - playing sound!');
            playAlert();
            claudeGenerationInProgress = false; // Reset flag
        }
        
        // Button appeared for first time (new chat) - don't trigger sound
        if (!claudeButtonExists && buttonExists && !claudeButtonHasExistedBefore) {
            console.log('ℹ️ Claude button appeared for first time (new chat) - not triggering sound');
        }
        
        // Add click listener when button exists (for audio unlock)
        if (buttonExists && button && !button.dataset.claudeListener) {
            button.dataset.claudeListener = 'true';
            
            button.addEventListener('click', async (event) => {
                console.log('👆 Claude button clicked!');
                
                if (!audioContextUnlocked) {
                    console.log('🎯 Claude send button clicked - unlocking audio...');
                    await unlockAudioContext();
                }
            });
            
            console.log('✅ Added click listener to Claude button');
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
            console.log('Chat Dinger: Periodic check - ChatGPT button missing, re-scanning...');
            observeForChatGPTButton();
        }
    }, 5000);
}

// Manual test function
window.testChatDinger = () => playAlert();

// Initialize based on site
async function init() {
    if (SITE === 'UNKNOWN') {
        console.log('Chat Dinger: Unknown site, extension disabled');
        return;
    }
    
    // Load settings first
    await loadSettings();
    
    if (SITE === 'CHATGPT') {
        observeForChatGPTButton();
        startChatGPTMaintenance();
    } else if (SITE === 'CLAUDE') {
        setupClaudeMonitoring();
    }
    
    console.log(`🚀 Chat Dinger: Ready for ${SITE}! Click send button to unlock audio.`);
    console.log(`📊 Settings: ${settings.enabled ? 'Enabled' : 'Disabled'} | Volume: ${Math.round(settings.volume * 100)}% | Sound: ${settings.selectedSound}`);
}

// Start the extension
init();