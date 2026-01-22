const enabledToggle = document.getElementById('enabled-toggle');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundSelect = document.getElementById('sound-select');
const testSoundBtn = document.getElementById('test-sound');
const statusMessage = document.getElementById('status-message');
const volumeThumb = document.getElementById('volume-thumb');
const activeTabToggle = document.getElementById('active-tab-toggle');

let onChatGPTPage = false;
let lastSavedSettings = {};

const defaultSettings = {
  enabled: true,
  volume: 0.7,
  selectedSound: 'cryptic.wav',
  notifyOnActiveTab: true,
  enableNotifications: true
};

let currentSettings = { ...defaultSettings };

// Logging utility
async function logIfDev(level, ...args) {
  if (!chrome.runtime?.id||!chrome.storage?.local) {
    // The context has been invalidated, so we can't use any chrome.* APIs.
    // Silently return to prevent the error.
    return;
  }
  try {
    const { isDevMode } = await chrome.storage.local.get(['isDevMode']);
    if (isDevMode) {
      switch (level) {
        case 'log':
          console.log('Chat Dinger:', ...args);
          break;
        case 'warn':
          console.warn('Chat Dinger:', ...args);
          break;
        case 'error':
          console.error('Chat Dinger:', ...args);
          break;
      }
    }
  } catch (e) {
    console.error('Chat Dinger: Failed to check dev mode for logging:', e.message);
  }
}

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
          currentSettings.enableNotifications = true;
          await saveSettings();
          const enableButton = document.getElementById('enable-notifications-btn');
          if (enableButton) enableButton.closest('.group-box').remove();
        } else {
          showStatus('Notification permission denied. Some fallback features may not work.', true);
          currentSettings.enableNotifications = false;
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
      await logIfDev('log', 'Loaded settings:', currentSettings);
      updateUI();
      validateSettings();
    }
  } catch (error) {
    console.error("Chat Dinger: Error loading settings:", error);
    showStatus('Failed to load settings', true);
  }
}

async function getChatGPTTabs() {
  return await chrome.tabs.query({
    url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
  });
}

async function saveSettings() {
  try {
    if (!(typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id)) return;

    // 1) Persist
    await chrome.storage.local.set({ chatAlertSettings: currentSettings });
    await logIfDev('log', 'Settings saved:', currentSettings);

    // 2) Decide who needs to know
    const prev = lastSavedSettings || {};
    const next = currentSettings || {};
    const changedKeys = Object.keys(next).filter(k => prev[k] !== next[k]);

    // Only changes that affect page behavior should be sent to tabs.
    // Mute/volume/sound are audio-only -> background/offscreen can handle them.
    const pageAffectingKeys = new Set(['notifyOnActiveTab']); // add to this later if truly needed
    const shouldNotifyTabs = changedKeys.some(k => pageAffectingKeys.has(k));

    // Always tell background/offscreen so it uses the latest mute/volume/sound.
    try {
      await chrome.runtime.sendMessage({ action: 'settingsUpdated', settings: next });
    } catch (e) {
      await logIfDev('warn', 'Could not notify background about settingsUpdated:', e?.message);
    }

    if (shouldNotifyTabs) {
      const tabs = await getChatGPTTabs();
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'settingsUpdated', settings: next });
          await logIfDev('log', `settingsUpdated sent to tab ${tab.id}`);
        } catch (e) {
          if (e.message?.includes("Could not establish connection") || e.message?.includes("Receiving end does not exist")) {
            await logIfDev('warn', `Tab ${tab.id} not reachable for settingsUpdated.`);
          } else {
            console.error(`Popup: Error sending settingsUpdated to tab ${tab.id}:`, e.message);
          }
        }
      }
    }

    lastSavedSettings = { ...next };
  } catch (error) {
    console.error("Chat Dinger: Error saving settings:", error);
    showStatus('Failed to save settings', true);
  }
}

// ---- Tabs ----
const tabStatsBtn = document.getElementById('tab-stats-btn');
const tabSettingsBtn = document.getElementById('tab-settings-btn');
const tabStats = document.getElementById('tab-stats');
const tabSettings = document.getElementById('tab-settings');

function showTab(which) {
  if (which === 'stats') {
    tabStats.classList.remove('hidden');
    tabSettings.classList.add('hidden');
    tabStatsBtn.disabled = true;
    tabSettingsBtn.disabled = false;
  } else {
    tabSettings.classList.remove('hidden');
    tabStats.classList.add('hidden');
    tabSettingsBtn.disabled = true;
    tabStatsBtn.disabled = false;
    requestAnimationFrame(() => updateVolumeDisplay());

  }
}
tabStatsBtn.addEventListener('click', () => showTab('stats'));
tabSettingsBtn.addEventListener('click', () => showTab('settings'));
showTab('stats');


// ---- HUD rendering ----
const elToday = document.getElementById('hud-today');
const elLifetime = document.getElementById('hud-lifetime');
const elStreak = document.getElementById('hud-streak');
const elBestStreak = document.getElementById('hud-best-streak');
const elCookTime = document.getElementById('hud-cook-time');
const elLongestCook = document.getElementById('hud-longest-cook');
const elLevel = document.getElementById('hud-level');
const elTitle = document.getElementById('hud-title');
const elDesc = document.getElementById('hud-description');
const elXpBar = document.getElementById('hud-xp-bar');
const elXp = document.getElementById('hud-xp');
const elXpNeeded = document.getElementById('hud-xp-needed');
const elMilestones = document.getElementById('hud-milestones');
const elAchievements = document.getElementById('hud-achievements');

function levelFromTotal(total) {
  // 25 dings per level. XP is remainder toward next level.
  const lvl = Math.floor(total / 25) + 1;
  const xp = total % 25;
  const need = 25;
  return { lvl, xp, need, pct: (xp / need) * 100 };
}

function renderMilestones(total) {
  const targets = [1, 10, 25, 50, 100, 250, 500, 1000];
  elMilestones.innerHTML = '';
  targets.forEach(t => {
    const done = total >= t;
    const card = document.createElement('div');
    card.style.cssText = 'border:1px inset #c0c0c0; background:#000; padding:6px;';
    card.innerHTML = `${done ? '✅' : '⬜️'} ${t} dings`;
    elMilestones.appendChild(card);
  });
}

function renderAchievements(list) {
  elAchievements.innerHTML = '';
  (list || []).slice(-6).reverse().forEach(a => {
    const li = document.createElement('li');
    li.textContent = a;
    elAchievements.appendChild(li);
  });
}

async function loadMetricsAndRender() {
  try {
    const { soundPlayCount = 0, dingerMetrics = null } =
    await chrome.storage.local.get(['soundPlayCount', 'dingerMetrics']);
    const today = dingerMetrics?.todayCount || 0;
    const lifetime = dingerMetrics?.total || soundPlayCount || 0;
    const streak = dingerMetrics?.streak || 0;
    const best = dingerMetrics?.bestStreak || 0;
    const totalGenTime = dingerMetrics?.totalGenTime || 0;
    const longestGenTime = dingerMetrics?.longestGenTime || 0;

    elToday.textContent = today;
    elLifetime.textContent = lifetime;
    elStreak.textContent = streak;
    elBestStreak.textContent = best;
    elCookTime.textContent = formatCookTime(totalGenTime);
    elLongestCook.textContent = formatCookTime(longestGenTime);

    const { lvl, xp, need, pct } = levelFromTotal(lifetime);
    elLevel.textContent = lvl;
    elXp.textContent = xp;
    elXpNeeded.textContent = need;
    elXpBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;

    renderMilestones(lifetime);
    renderAchievements(dingerMetrics?.achievements || []);
  } catch (e) {
    console.warn('HUD load failed:', e);
  }
}

function formatCookTime(t){
  let time='';
  if(t/1000/60/60/24>1){
    time='🤯'
  }
  else if(t/1000/60/60>1){
    time=`${(t/1000/60/60).toFixed(1)} h`;
  }
  else if (t/1000/60>1){
    time=`${(t/1000/60).toFixed(1)} m`;
  }
  else{
    time = `${(t/1000).toFixed(1)} s`
  }
  return time;
}

// initial + refresh on storage changes
loadMetricsAndRender();
chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns === 'local' && (changes.dingerMetrics || changes.soundPlayCount)) {
    loadMetricsAndRender();
  }
});


function updateUI() {
  enabledToggle.classList.toggle('checked', !!currentSettings.enabled);
  activeTabToggle.classList.toggle('checked', !!currentSettings.notifyOnActiveTab);

  const pct = Math.round(((currentSettings.volume ?? 0.7) * 100));
  volumeSlider.value = String(pct);

  soundSelect.value = currentSettings.selectedSound;
  updateVolumeDisplay();
}

function updateVolumeDisplay() {
  // read % from the input (0–100)
  let volume = Number(volumeSlider.value);
  if (!Number.isFinite(volume)) volume = Math.round((currentSettings.volume ?? 0.7) * 100);

  // text
  volumeValue.textContent = `Volume: ${volume}%`;

  // move the visual thumb by percentage; translateX(-50%) keeps it centered
  if (volumeThumb) {
    volumeThumb.style.left = `${volume}%`;
    volumeThumb.style.transform = 'translateX(-50%)';
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
  if (existingBtnContainer) return;
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
    soundSchemeGroup.parentNode.insertBefore(notificationGroup, soundSchemeGroup.nextSibling);
  } else {
    document.querySelector('.content').appendChild(notificationGroup);
  }
  document.getElementById('enable-notifications-btn').addEventListener('click', async () => {
    await requestNotificationPermission();
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
}

testSoundBtn.addEventListener('click', async () => {
  if (!onChatGPTPage) {
    showStatus("Open ChatGPT tab to test.", true);
    return;
  }
  const originalText = testSoundBtn.textContent;
  testSoundBtn.textContent = 'Playing...';
  testSoundBtn.disabled = true;
  let soundPlayedOrInitiated = false;
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          url: ["*://chatgpt.com/*", "*://chat.openai.com/*"]
        });
        if (tabs.length > 0) {
          await logIfDev('log', 'Sending testSound to content script in active tab:', tabs[0].id);
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'testSound',
            soundFile: currentSettings.selectedSound,
            volume: currentSettings.volume
          });
          await logIfDev('log', 'Response from content script for testSound:', response);
          if (response && response.success) {
            showStatus(response.status || 'Test sound played in chat tab!');
            soundPlayedOrInitiated = true;
          } else if (response && !response.success) {
            await logIfDev('warn', 'Content script reported test sound failure:', response.status, response.error);
          }
        }
      } catch (e) {
        if (e.message.includes("Could not establish connection") || e.message.includes("Receiving end does not exist")) {
          await logIfDev('warn', 'Content script in active tab not reachable or not a ChatGPT tab.');
        } else {
          console.error('Popup: Error messaging content script for test sound:', e.message);
        }
      }
    }
    if (!soundPlayedOrInitiated && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      await logIfDev('log', 'Trying background script injection for testSound.');
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'testSound',
          soundFile: currentSettings.selectedSound,
          volume: currentSettings.volume
        });
        await logIfDev('log', 'Response from background script for testSound:', response);
        if (response && response.success) {
          showStatus(response.status || `Test sound (${currentSettings.selectedSound}) handling initiated.`);
          soundPlayedOrInitiated = true;
        } else if (response && !response.success) {
          await logIfDev('warn', 'Background script reported test sound failure/issue:', response.status, response.error);
          if (!response.status || !response.status.toLowerCase().includes('notification')) {
            // showStatus(response.error || response.status || 'Background test failed.', true);
          } else {
            showStatus(response.status);
            soundPlayedOrInitiated = true;
          }
        }
      } catch (e) {
        console.error('Popup: Error sending message to background script for testSound injection:', e.message);
      }
    }
    if (!soundPlayedOrInitiated && currentSettings.enableNotifications && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      await logIfDev('log', 'Trying background script for a direct system notification sound test.');
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'playNotificationSound',
          title: 'Chat Dinger Test',
          message: `Test: System Notification for ${currentSettings.selectedSound}`
        });
        await logIfDev('log', 'Response from background for playNotificationSound:', response);
        if (response && response.success) {
          showStatus('Test sound played via system notification!');
          soundPlayedOrInitiated = true;
        } else {
          await logIfDev('warn', 'Background system notification sound test failed.');
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
    }, 1500);
  }
});

enabledToggle.addEventListener('click', async function() {
  this.classList.toggle('checked');
  currentSettings.enabled = this.classList.contains('checked');
  await saveSettings();
  showStatus(`Notifications ${currentSettings.enabled ? 'Enabled' : 'Disabled'}`);
});

volumeSlider.addEventListener('input', () => {
  let volumePct = Number(volumeSlider.value);
  if (!Number.isFinite(volumePct)) volumePct = 70;
  currentSettings.volume = Math.max(0, Math.min(1, volumePct / 100));
  updateVolumeDisplay();
});

volumeSlider.addEventListener('change', async () => {
  await saveSettings();
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
      onChatGPTPage = isChatGPTPage;
      await logIfDev('log', `Test button state: onChatGPTPage=${onChatGPTPage}`);
    } else {
      onChatGPTPage = false;
    }
  } catch (error) {
    await logIfDev('warn', 'Could not determine tab state:', error);
    onChatGPTPage = false;
  }
  testSoundBtn.disabled = false;
  testSoundBtn.title = 'Test the selected sound';
}

async function init() {
  await logIfDev('log', 'Initializing popup');
  await loadSettings();
  await setTestButtonState();
  updateVolumeDisplay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

const devCollapsible = document.getElementById('developer-tools');
const devTriggerBtn = document.getElementById('dev-trigger-ding');
const devResetBtn = document.getElementById('dev-reset-count');

if (devCollapsible) {
  const title = devCollapsible.querySelector('.group-title');
  if (title) {
    title.addEventListener('click', () => {
      devCollapsible.classList.toggle('expanded');
    });
  }
}

async function dispatchEventOnPage(eventName) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showStatus('No active tab found.', true);
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (event) => window.dispatchEvent(new CustomEvent(event)),
      args: [eventName],
    });
    showStatus(`'${eventName}' sent to page.`);
  } catch (e) {
    console.error(`Failed to dispatch event '${eventName}':`, e);
    showStatus(`Error: ${e.message}`, true);
  }
}

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
  const manifest = chrome.runtime.getManifest();
  if (manifest.update_url) {
    devCollapsible.style.display = 'none';
  }
}

window.addEventListener('resize', updateVolumeDisplay);