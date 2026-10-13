'use strict';

const { SOUND_FILES, normalizeSettings } = ChatDingerShared;
const SETUP_SOUNDS = ['soft-tap.wav', 'cryptic.wav', 'nylon.mp3', 'claude.mp3', 'coin.mp3', 'pew.wav'];
const activeSound = document.getElementById('active-sound');
const controls = document.getElementById('controls');
const sound = document.getElementById('sound');
const volume = document.getElementById('volume');
const volumeValue = document.getElementById('volume-value');
const testButton = document.getElementById('test-sound');
const openButton = document.getElementById('open-chatgpt');
const hearingCheck = document.getElementById('hearing-check');
const responseHelp = document.getElementById('response-help');
const soundStatus = document.getElementById('sound-status');
const connectionStatus = document.getElementById('connection-status');
const connectionTitle = document.getElementById('connection-title');
const connectionDetail = document.getElementById('connection-detail');
const chatPatterns = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
let saveQueue = Promise.resolve();
let connectionCheck = null;

function showSoundStatus(text, error = false) {
  soundStatus.textContent = text;
  soundStatus.dataset.error = String(error);
}

function saveSelection() {
  const selection = { selectedSound: sound.value, volume: Number(volume.value) / 100,
    notifyOnActiveTab: activeSound.checked };
  const operation = saveQueue.catch(() => {}).then(async () => {
    const { chatAlertSettings } = await chrome.storage.local.get('chatAlertSettings');
    await chrome.storage.local.set({
      chatAlertSettings: { ...normalizeSettings(chatAlertSettings), ...selection }
    });
  });
  saveQueue = operation;
  return operation;
}

function resetSoundCheck() {
  hearingCheck.hidden = true;
  responseHelp.hidden = true;
  responseHelp.open = false;
}

async function selectionChanged() {
  resetSoundCheck();
  try {
    await saveSelection();
    showSoundStatus('Settings saved.');
  } catch (_error) {
    showSoundStatus('Could not save the sound settings. Try again.', true);
  }
}

volume.addEventListener('input', () => {
  volumeValue.textContent = `${volume.value}%`;
  resetSoundCheck();
  showSoundStatus('Use Test sound to check this volume.');
});
volume.addEventListener('change', selectionChanged);
sound.addEventListener('change', selectionChanged);
activeSound.addEventListener('change', selectionChanged);

// The same routine serves the automatic first play and the Test button. The
// button always stays available, so a user whose audio was off can play again.
async function runSoundTest({ automatic = false } = {}) {
  resetSoundCheck();
  controls.disabled = true;
  testButton.disabled = true;
  try {
    try {
      await saveSelection();
    } catch (_error) {
      showSoundStatus('Could not save the sound settings. Try again.', true);
      return;
    }
    if (Number(volume.value) === 0) {
      showSoundStatus('The volume is zero. Increase the volume, then test again.', true);
      return;
    }
    const response = await chrome.runtime.sendMessage({
      action: 'testSound', soundFile: sound.value, volume: Number(volume.value) / 100
    });
    if (!response?.success) throw new Error('Playback failed');
    showSoundStatus(automatic ? 'Chat Dinger just played your sound. Did you hear it?' : 'Did you hear the sound?');
    hearingCheck.hidden = false;
  } catch (_error) {
    showSoundStatus('Chat Dinger could not play the sound. Try another sound.', true);
  } finally {
    controls.disabled = false;
    testButton.disabled = false;
    testButton.textContent = '▶ Test again';
  }
}

testButton.addEventListener('click', () => runSoundTest());

// Keep the answer on this device. It says whether this user ever heard the sound.
function recordHearing(heard) {
  try {
    Promise.resolve(chrome.storage.local.set({ heardTestSound: heard })).catch(() => {});
  } catch (_error) {
    // The answer is a convenience. Setup continues without it.
  }
}

document.getElementById('heard-yes').addEventListener('click', () => {
  hearingCheck.hidden = true;
  recordHearing(true);
  showSoundStatus('Sound confirmed. You are ready.');
  responseHelp.hidden = false;
});

document.getElementById('heard-no').addEventListener('click', () => {
  hearingCheck.hidden = true;
  recordHearing(false);
  showSoundStatus('Check your computer’s volume and audio output. The sound can go to headphones or a Bluetooth device. Then press Test again.');
});

async function getChatTabs() {
  const tabs = await chrome.tabs.query({ url: chatPatterns });
  return tabs.filter(tab => Number.isInteger(tab.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

function checkConnection() {
  if (connectionCheck) return connectionCheck;
  connectionCheck = (async () => {
    try {
      const tabs = await getChatTabs();
      connectionStatus.hidden = true;
      if (!tabs.length) {
        connectionTitle.textContent = 'Ready for a ChatGPT tab';
        connectionDetail.textContent = 'Open ChatGPT to try your first response.';
        return;
      }
      const states = await Promise.all(tabs.map(async tab => {
        try { return await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, { frameId: 0 }); }
        catch (_error) { return null; }
      }));
      const activeCount = states.filter(state => state?.success && state.enabled && state.monitoring).length;
      connectionStatus.hidden = activeCount === tabs.length;
      if (activeCount) {
        connectionTitle.textContent = `Chat Dinger is active in ${activeCount} ChatGPT ${activeCount === 1 ? 'tab' : 'tabs'}`;
        connectionDetail.textContent = activeCount === tabs.length
          ? 'Start a response, then switch to another tab.'
          : 'If another ChatGPT tab has no sound, open Chat Dinger in that tab and select Reconnect.';
      } else {
        connectionTitle.textContent = 'ChatGPT alerts are not active yet';
        connectionDetail.textContent = states.some(state => state?.success && !state.enabled)
          ? 'Turn on Chat Dinger in the extension settings.'
          : 'If ChatGPT has finished loading, open Chat Dinger in that tab and select Reconnect.';
      }
    } catch (_error) {
      connectionStatus.hidden = false;
      connectionTitle.textContent = 'Could not check ChatGPT';
      connectionDetail.textContent = 'Open ChatGPT, then return here to check again.';
    }
  })().finally(() => { connectionCheck = null; });
  return connectionCheck;
}

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  try {
    await saveSelection();
    const setupTab = await chrome.tabs.getCurrent();
    const [tab] = await getChatTabs();
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } else {
      await chrome.tabs.create({ url: 'https://chatgpt.com/' });
    }
    if (Number.isInteger(setupTab?.id)) {
      try {
        await chrome.tabs.remove(setupTab.id);
      } catch (_error) {
        showSoundStatus('Setup is complete. You can close this page.');
      }
    } else {
      showSoundStatus('Setup is complete. You can close this page.');
    }
  } catch (_error) {
    connectionStatus.hidden = false;
    connectionTitle.textContent = 'Could not finish setup';
    connectionDetail.textContent = 'Try again, or open chatgpt.com in a new tab.';
  } finally {
    openButton.disabled = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkConnection();
});

async function init() {
  try {
    const { chatAlertSettings } = await chrome.storage.local.get('chatAlertSettings');
    const settings = normalizeSettings(chatAlertSettings);
    const choices = SETUP_SOUNDS.map(value => SOUND_FILES.find(item => item.value === value));
    // Preserve an existing selection if someone opens setup again later.
    if (!SETUP_SOUNDS.includes(settings.selectedSound)) {
      choices.push(SOUND_FILES.find(item => item.value === settings.selectedSound));
    }
    for (const item of choices) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      sound.appendChild(option);
    }
    activeSound.checked = settings.notifyOnActiveTab;
    sound.value = settings.selectedSound;
    volume.value = Math.round(settings.volume * 100);
    volumeValue.textContent = `${volume.value}%`;
    controls.disabled = false;
    openButton.disabled = false;
    showSoundStatus('');
    // Play the sound once on its own. The install click was the user gesture,
    // and the background player does not depend on this page's autoplay rules.
    // A user who hears nothing learns it here, not after the first response.
    setTimeout(() => { runSoundTest({ automatic: true }); }, 600);
  } catch (_error) {
    showSoundStatus('Could not load your settings. Reload this page.', true);
  }
  await checkConnection();
}
init();
