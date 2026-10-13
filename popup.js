'use strict';

const {
  DEFAULT_SETTINGS,
  SOUND_FILES,
  clampVolume,
  normalizeMetrics,
  normalizeSettings
} = ChatDingerShared;

const SOUND_LABELS = {
  'soft-tap.wav': 'Soft tap',
  'alert.mp3': 'Alert',
  'boop.mp3': 'Boop',
  'claude.mp3': 'Tone',
  'coin.mp3': 'Coin',
  'cryptic.wav': 'Bloop',
  'ding.mp3': 'Ding',
  'nylon.mp3': 'Nylon',
  'pew.wav': 'Pew',
  'twelve.wav': 'Meow'
};

const elements = {
  activeTabToggle: document.getElementById('active-tab-toggle'),
  cancelDelete: document.getElementById('cancel-delete'),
  confirmDelete: document.getElementById('confirm-delete'),
  copyDiagnostics: document.getElementById('copy-diagnostics'),
  diagnosticOutput: document.getElementById('diagnostic-output'),
  deleteConfirm: document.getElementById('delete-confirm'),
  deleteStats: document.getElementById('delete-stats'),
  diagnosticsToggle: document.getElementById('diagnostics-toggle'),
  enabledToggle: document.getElementById('enabled-toggle'),
  quickEnabledToggle: document.getElementById('quick-enabled-toggle'),
  health: document.getElementById('health'),
  healthAction: document.getElementById('health-action'),
  healthDetail: document.getElementById('health-detail'),
  healthTitle: document.getElementById('health-title'),
  healthReport: document.getElementById('health-report'),
  saveSnapshot: document.getElementById('save-snapshot'),
  viewMilestones: document.getElementById('view-milestones'),
  milestoneList: document.getElementById('milestone-list'),
  soundSelect: document.getElementById('sound-select'),
  statusMessage: document.getElementById('status-message'),
  systemNotificationToggle: document.getElementById('system-notification-toggle'),
  unreadTabToggle: document.getElementById('unread-tab-toggle'),
  tabSettings: document.getElementById('tab-settings'),
  tabSettingsButton: document.getElementById('tab-settings-btn'),
  tabStats: document.getElementById('tab-stats'),
  tabStatsButton: document.getElementById('tab-stats-btn'),
  testSound: document.getElementById('test-sound'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeThumb: document.getElementById('volume-thumb'),
  volumeValue: document.getElementById('volume-value')
};

let currentSettings = { ...DEFAULT_SETTINGS };
let lastRenderedStats = null;
let healthAction = null;
let statusTimer = null;
let healthCheckInFlight = false;
let latestHealth = null;
let soundTestInFlight = false;

function showStatus(message, kind = 'success', duration = 4000) {
  window.clearTimeout(statusTimer);
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.kind = kind;
  elements.statusMessage.classList.remove('hidden');
  statusTimer = window.setTimeout(() => elements.statusMessage.classList.add('hidden'), duration);
}

function showTab(name, moveFocus = false) {
  const showStats = name === 'stats';
  elements.tabStats.classList.toggle('hidden', !showStats);
  elements.tabSettings.classList.toggle('hidden', showStats);
  elements.tabStatsButton.setAttribute('aria-selected', String(showStats));
  elements.tabSettingsButton.setAttribute('aria-selected', String(!showStats));
  elements.tabStatsButton.tabIndex = showStats ? 0 : -1;
  elements.tabSettingsButton.tabIndex = showStats ? -1 : 0;
  document.querySelector('.content').scrollTop = 0;
  if (moveFocus) {
    (showStats ? elements.tabStatsButton : elements.tabSettingsButton).focus();
  }
}

function soundChoices() {
  const fallback = Object.keys(SOUND_LABELS).filter(file => file.endsWith('.mp3') || file.endsWith('.wav'));
  const source = Array.isArray(SOUND_FILES) && SOUND_FILES.length ? SOUND_FILES : fallback;
  return source.map(item => {
    if (typeof item === 'string') {
      return { value: item, label: SOUND_LABELS[item] || item.replace(/\.[^.]+$/, '') };
    }
    const value = item?.value || item?.file;
    return { value, label: item?.label || SOUND_LABELS[value] || value };
  }).filter(item => typeof item.value === 'string' && item.value.length > 0);
}

function buildSoundOptions() {
  elements.soundSelect.replaceChildren();
  for (const sound of soundChoices()) {
    const option = document.createElement('option');
    option.value = sound.value;
    option.textContent = sound.label;
    elements.soundSelect.appendChild(option);
  }
}

function updateSettingsUI() {
  elements.enabledToggle.checked = currentSettings.enabled;
  elements.quickEnabledToggle.checked = currentSettings.enabled;
  elements.activeTabToggle.checked = currentSettings.notifyOnActiveTab;
  elements.systemNotificationToggle.checked = currentSettings.showSystemNotification;
  elements.unreadTabToggle.checked = currentSettings.markUnreadTab;
  const volumePercent = Math.round(clampVolume(currentSettings.volume) * 100);
  elements.volumeSlider.value = String(volumePercent);
  elements.volumeValue.textContent = `Volume: ${volumePercent}%`;
  elements.volumeThumb.style.left = `${volumePercent}%`;
  elements.soundSelect.value = currentSettings.selectedSound;
}

async function loadSettings() {
  const { chatAlertSettings, diagnosticsEnabled } = await chrome.storage.local.get(['chatAlertSettings', 'diagnosticsEnabled']);
  elements.diagnosticsToggle.checked = diagnosticsEnabled === true;
  currentSettings = normalizeSettings(chatAlertSettings);
  updateSettingsUI();
}

async function saveSettings(message) {
  currentSettings = normalizeSettings(currentSettings);
  await chrome.storage.local.set({ chatAlertSettings: currentSettings });
  try {
    await chrome.runtime.sendMessage({ action: 'settingsUpdated', settings: currentSettings });
  } catch (error) {
    console.warn('Chat Dinger: The background did not confirm the settings update.', error);
  }
  updateSettingsUI();
  if (message) showStatus(message);
}

function setHealth(state, title, detail, action = null) {
  elements.health.dataset.state = state;
  elements.health.classList.remove('hidden');
  elements.healthTitle.textContent = title;
  elements.healthDetail.textContent = detail;
  healthAction = action;
  elements.healthReport.classList.toggle('hidden', state !== 'error');
  if (action) {
    elements.healthAction.textContent = action.label;
    elements.healthAction.classList.remove('hidden');
  } else {
    elements.healthAction.classList.add('hidden');
  }
}

function isChatGPTUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'chatgpt.com' || hostname === 'chat.openai.com';
  } catch (_error) {
    return false;
  }
}

async function refreshHealth() {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isChatGPTUrl(tab.url)) {
      latestHealth = null;
      setHealth('checking', 'Ready for ChatGPT', 'Open a chat to use sound alerts.', { type: 'open', label: 'Open ChatGPT' });
      return;
    }
    if (!currentSettings.enabled) {
      setHealth('checking', 'Alerts are off', 'Set Chat Dinger to on in Settings.');
      return;
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
    } catch (_error) {}
    latestHealth = response || { code: 'connection_unavailable' };
    if (!response?.success) {
      setHealth('error', 'Reconnect ChatGPT', 'Connect sound alerts without a page refresh.', { type: 'reconnect', tabId: tab.id, label: 'Reconnect' });
    } else if (response.code === 'audio_failed') {
      setHealth('error', 'The sound did not play', 'Test the sound to check the connection.', { type: 'sound', tabId: tab.id, label: 'Test sound' });
    } else if (response.code === 'generation_stalled') {
      setHealth('error', 'The response is still in progress', 'Chat Dinger cannot confirm completion yet. It will continue to monitor this chat.');
    } else if (response.monitoring && response.state !== 'unavailable') {
      setHealth('ready', response.isGenerating ? 'Response in progress' : 'Ready for the next reply', 'Chat Dinger is connected to this chat.');
    } else if (response.state === 'waiting') {
      if (response.isGenerating) {
        setHealth('checking', 'Waiting for the next response', 'The chat changed during a response. Alerts resume with the next response.');
      } else {
        setHealth('checking', 'Ready for a chat', 'Open a conversation to use sound alerts.');
      }
    } else if (response.state === 'recovering' || response.state === 'checking') {
      setHealth('checking', 'Reconnecting automatically', 'Chat Dinger is checking for a repair. Keep this chat open.');
    } else {
      const seconds = Math.max(0, Math.ceil(((response.nextRetryAt || 0) - Date.now()) / 1000));
      const retry = seconds > 60 ? `Automatic retry in ${Math.ceil(seconds / 60)} minutes.` : seconds ? `Automatic retry in ${seconds} seconds.` : 'Chat Dinger will try again automatically.';
      setHealth('error', 'Alerts are temporarily unavailable', retry, { type: 'repair', tabId: tab.id, label: 'Retry connection' });
    }
  } catch (_error) {
    setHealth('error', 'Connection check unavailable', 'Close this panel, then open it again.');
  } finally {
    healthCheckInFlight = false;
  }
}

function renderDashboard(stats) {
  const time = document.getElementById('hud-wait-time');
  time.replaceChildren();
  const unitNames = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
  time.setAttribute('aria-label', stats.time.map(part => `${part.value} ${unitNames[part.unit]}${part.value === 1 ? '' : 's'}`).join(' '));
  for (const part of stats.time) {
    const value = document.createElement('span');
    value.textContent = part.value.toLocaleString('en-US');
    const unit = document.createElement('span');
    unit.className = 'time-unit';
    unit.textContent = part.unit;
    value.appendChild(unit);
    time.appendChild(value);
  }
  time.classList.toggle('compact', stats.timeText.length > 11);
  document.getElementById('hud-lifetime').textContent = stats.dings.toLocaleString('en-US');
  document.getElementById('featured-milestone').dataset.empty = String(!stats.featured);
  document.getElementById('milestone-stamp').textContent = stats.featured?.stamp || '01';
  document.getElementById('milestone-title').textContent = stats.featured?.title || 'Your first ding.';
  document.getElementById('milestone-detail').textContent = stats.featured?.detail || 'One completed response starts your collection.';
  document.getElementById('milestone-count').textContent = `${stats.reached} of ${stats.milestones.length} reached`;
  const list = document.getElementById('milestone-items');
  list.replaceChildren();
  for (const milestone of stats.milestones) {
    const item = document.createElement('li');
    item.className = milestone.reached ? 'reached' : 'not-reached';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = milestone.title;
    const detail = document.createElement('span');
    detail.textContent = milestone.detail;
    copy.append(title, detail);
    const status = document.createElement('span');
    status.className = 'milestone-check';
    status.textContent = milestone.reached ? '✓' : '○';
    status.setAttribute('aria-label', milestone.reached ? 'Reached' : 'Not reached');
    item.append(copy, status);
    list.appendChild(item);
  }
  document.getElementById('metrics-error').classList.add('hidden');
  elements.saveSnapshot.disabled = false;
}

async function loadMetricsAndRender() {
  try {
    const { dingerMetrics, soundPlayCount = 0 } = await chrome.storage.local.get(['dingerMetrics', 'soundPlayCount']);
    lastRenderedStats = ChatDingerMetrics.summary(normalizeMetrics(dingerMetrics), soundPlayCount);
    renderDashboard(lastRenderedStats);
  } catch (error) {
    console.warn('Chat Dinger: Could not load the local stats.', error);
    const message = document.getElementById('metrics-error');
    message.textContent = 'Stats could not load. Close and open Chat Dinger again.';
    message.classList.remove('hidden');
    if (!lastRenderedStats) {
      document.getElementById('hud-wait-time').textContent = '—';
      document.getElementById('hud-lifetime').textContent = '—';
      elements.saveSnapshot.disabled = true;
    }
  }
}

function snapshotCanvas(stats) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  const text = (value, x, y, size, color = '#fff9ed', weight = 400) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(value, x, y);
  };
  ctx.fillStyle = '#4a3375';
  ctx.fillRect(0, 0, 720, 800);
  ctx.fillStyle = '#ffe457';
  ctx.fillRect(48, 46, 286, 44);
  text('chat ding(er)', 58, 76, 30, '#21172e', 700);
  text('TOTAL WAIT TIME', 48, 194, 22, '#d9cbea');
  text('ALL TIME', 561, 194, 17, '#d9cbea');
  let size = 92;
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  while (ctx.measureText(stats.timeText).width > 624 && size > 24) {
    size -= 2;
    ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  }
  text(stats.timeText, 48, 310, size);
  text('Combined time for completed response alerts.', 48, 356, 20, '#d9cbea');
  ctx.strokeStyle = '#796197';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(48, 399); ctx.lineTo(672, 399); ctx.stroke();
  text('TOTAL DINGS', 48, 464, 22, '#d9cbea');
  ctx.textAlign = 'right';
  const dings = stats.dings.toLocaleString('en-US');
  text(dings, 672, 470, dings.length > 12 ? 22 : dings.length > 8 ? 30 : 44);
  ctx.textAlign = 'left';
  ctx.beginPath(); ctx.moveTo(48, 506); ctx.lineTo(672, 506); ctx.stroke();
  text(stats.featured ? 'MILESTONE REACHED' : 'THE FIRST MILESTONE', 48, 555, 18, '#d9cbea');
  ctx.fillStyle = '#3e285e';
  ctx.fillRect(48, 580, 624, 126);
  text(stats.featured?.stamp || '01', 72, 653, 30, '#ffe457');
  text(stats.featured?.title || 'Your first ding.', 185, 631, 27, '#ffe457', 600);
  text(stats.featured?.detail || 'Your collection starts here.', 185, 667, 18, '#d9cbea');
  text('chatdinger.com', 48, 760, 20, '#faab9e');
  return canvas;
}

elements.tabStatsButton.addEventListener('click', () => showTab('stats'));
elements.tabSettingsButton.addEventListener('click', () => showTab('settings'));
for (const button of [elements.tabStatsButton, elements.tabSettingsButton]) {
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showTab(button === elements.tabStatsButton ? 'settings' : 'stats', true);
  });
}

elements.healthAction.addEventListener('click', async () => {
  const action = healthAction;
  if (!action) return;
  elements.healthAction.disabled = true;
  try {
    if (action.type === 'open') {
      await chrome.tabs.create({ url: 'https://chatgpt.com/' });
      window.close();
    } else if (action.type === 'reconnect' && action.tabId) {
      setHealth('checking', 'Connecting to ChatGPT', 'Keep this chat open.');
      const result = await chrome.runtime.sendMessage({ action: 'reconnectTab', tabId: action.tabId });
      if (result?.success) await refreshHealth();
      else setHealth('error', 'ChatGPT connection unavailable', 'Make sure Chrome permits Chat Dinger on chatgpt.com.',
        { type: 'reconnect', tabId: action.tabId, label: 'Try again' });
    } else if (action.type === 'repair') {
      setHealth('checking', 'Reconnecting automatically', 'Chat Dinger is checking for a repair. Keep this chat open.');
      await chrome.tabs.sendMessage(action.tabId, { action: 'recoverDetection' });
      await refreshHealth();
    } else if (action.type === 'sound') {
      await testSound(action.tabId);
    }
  } catch (_error) {
    await refreshHealth();
  } finally {
    elements.healthAction.disabled = false;
  }
});

elements.healthReport.addEventListener('click', async () => {
  const version = chrome.runtime.getManifest().version;
  const code = ['controls_missing', 'generation_unconfirmed', 'connection_unavailable', 'generation_stalled', 'audio_failed'].includes(latestHealth?.code)
    ? latestHealth.code : 'unknown';
  const revision = /^[a-f0-9]{8}$/.test(latestHealth?.selectorRevision) ? latestHealth.selectorRevision : 'unknown';
  const url = new URL('https://github.com/rumblelab/chatdinger/issues/new');
  url.searchParams.set('title', 'Chat Dinger sound alerts are unavailable');
  url.searchParams.set('body', `Extension: ${version}\nError: ${code}\nControl revision: ${revision}\n\nDescribe what happened here. This report contains no chat text.`);
  await chrome.tabs.create({ url: url.href });
});

// The header switch and the settings switch control the same setting.
async function setAlertsEnabled(enabled) {
  currentSettings.enabled = enabled;
  elements.enabledToggle.checked = enabled;
  elements.quickEnabledToggle.checked = enabled;
  await saveSettings(enabled ? 'Chat Dinger is on.' : 'Chat Dinger is off.');
  await refreshHealth();
}
elements.enabledToggle.addEventListener('change', event => setAlertsEnabled(event.target.checked));
elements.quickEnabledToggle.addEventListener('change', event => setAlertsEnabled(event.target.checked));
elements.diagnosticsToggle.addEventListener('change', async event => {
  try {
    await chrome.storage.local.set({ diagnosticsEnabled: event.target.checked });
    showStatus(event.target.checked ? 'Error reports are on.' : 'Error reports are off.');
  } catch (_error) {
    event.target.checked = !event.target.checked;
    showStatus('Could not save this setting.', 'error');
  }
});

elements.copyDiagnostics.addEventListener('click', async () => {
  elements.copyDiagnostics.disabled = true;
  elements.diagnosticOutput.classList.add('hidden');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isChatGPTUrl(tab.url)) {
      showStatus('Open the affected ChatGPT tab first.', 'error');
      return;
    }
    const report = { format: 1, extensionVersion: chrome.runtime.getManifest().version, popupBuild: 'update-reconnect-1' };
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getDiagnostics' });
      if (response?.success && response.detector?.build) report.content = response;
      else report.content = { error: 'diagnostics_not_available' };
    } catch (_error) {
      report.content = { error: 'content_not_connected' };
    }
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showStatus('Diagnostics copied. Paste the report into your support conversation.', 'success', 10000);
    } catch (_error) {
      elements.diagnosticOutput.value = text;
      elements.diagnosticOutput.classList.remove('hidden');
      elements.diagnosticOutput.focus();
      elements.diagnosticOutput.select();
      showStatus('Copy the selected report.', 'success', 10000);
    }
  } catch (_error) {
    showStatus('The diagnostic report could not be copied.', 'error');
  } finally {
    elements.copyDiagnostics.disabled = false;
  }
});
elements.activeTabToggle.addEventListener('change', async event => {
  currentSettings.notifyOnActiveTab = event.target.checked;
  await saveSettings(event.target.checked ? 'Active-tab dings are on.' : 'Active-tab dings are off.');
});
elements.systemNotificationToggle.addEventListener('change', async event => {
  currentSettings.showSystemNotification = event.target.checked;
  await saveSettings(event.target.checked ? 'System notifications are on.' : 'System notifications are off.');
});
elements.unreadTabToggle.addEventListener('change', async event => {
  currentSettings.markUnreadTab = event.target.checked;
  await saveSettings(event.target.checked ? 'Unread tab marks are on.' : 'Unread tab marks are off.');
});
elements.volumeSlider.addEventListener('input', event => {
  const percent = Number(event.target.value);
  currentSettings.volume = clampVolume(percent / 100);
  elements.volumeValue.textContent = `Volume: ${percent}%`;
  elements.volumeThumb.style.left = `${percent}%`;
});
elements.volumeSlider.addEventListener('change', () => saveSettings('Volume saved.'));
elements.soundSelect.addEventListener('change', async event => {
  currentSettings.selectedSound = event.target.value;
  await saveSettings(`${event.target.selectedOptions[0].textContent} is ready.`);
});

async function testSound(tabId) {
  if (soundTestInFlight) return;
  soundTestInFlight = true;
  const label = elements.testSound.textContent;
  elements.testSound.disabled = true;
  elements.testSound.textContent = 'Playing…';
  let failed = null;
  try {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isChatGPTUrl(tab?.url)) tabId = tab.id;
    }
    const response = await chrome.runtime.sendMessage({
      action: 'testSound',
      soundFile: currentSettings.selectedSound,
      volume: currentSettings.volume
    });
    if (response?.success && response.skipped) {
      showStatus('Another sound replaced the test sound.');
      return;
    }
    if (!response?.success) throw new Error(response?.error || response?.status || 'The sound did not play.');
    failed = false;
    showStatus('Test sound played.');
  } catch (error) {
    failed = true;
    console.error('Chat Dinger: Test sound failed.', error);
    showStatus('The test sound did not play.', 'error');
  } finally {
    try {
      if (tabId && failed !== null) await chrome.tabs.sendMessage(tabId, { action: 'setAudioHealth', failed });
    } catch (_error) {}
    await refreshHealth();
    soundTestInFlight = false;
    elements.testSound.disabled = false;
    elements.testSound.textContent = label;
  }
}

elements.testSound.addEventListener('click', () => testSound());

elements.viewMilestones.addEventListener('click', () => {
  const expanded = elements.viewMilestones.getAttribute('aria-expanded') !== 'true';
  elements.viewMilestones.setAttribute('aria-expanded', String(expanded));
  elements.viewMilestones.textContent = expanded ? 'Show less' : 'View all';
  elements.milestoneList.classList.toggle('hidden', !expanded);
});

elements.saveSnapshot.addEventListener('click', async () => {
  if (!lastRenderedStats) return;
  elements.saveSnapshot.disabled = true;
  try {
    const canvas = snapshotCanvas(lastRenderedStats);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The snapshot is empty.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chat-dinger-snapshot.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('Snapshot created.');
  } catch (_error) {
    showStatus('The snapshot could not be saved.', 'error');
  } finally {
    elements.saveSnapshot.disabled = false;
  }
});

elements.deleteStats.addEventListener('click', () => {
  elements.deleteStats.classList.add('hidden');
  elements.deleteConfirm.classList.remove('hidden');
  elements.cancelDelete.focus();
});
elements.cancelDelete.addEventListener('click', () => {
  elements.deleteConfirm.classList.add('hidden');
  elements.deleteStats.classList.remove('hidden');
  elements.deleteStats.focus();
});
elements.confirmDelete.addEventListener('click', async () => {
  elements.confirmDelete.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'deleteLocalData' });
    if (!response?.success) {
      throw new Error(response?.error || 'The background could not delete the local data.');
    }
    await Promise.all([loadSettings(), loadMetricsAndRender(), refreshHealth()]);
    elements.deleteConfirm.classList.add('hidden');
    elements.deleteStats.classList.remove('hidden');
    elements.deleteStats.focus();
    showStatus('Settings and stats reset.');
  } catch (error) {
    console.error('Chat Dinger: Could not reset the settings and stats.', error);
    showStatus('The settings and stats were not reset.', 'error');
  } finally {
    elements.confirmDelete.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.dingerMetrics || changes.soundPlayCount)) loadMetricsAndRender();
  if (area === 'local' && changes.chatAlertSettings) {
    currentSettings = normalizeSettings(changes.chatAlertSettings.newValue);
    updateSettingsUI();
  }
});

async function init() {
  buildSoundOptions();
  showTab('stats');
  try {
    await Promise.all([loadSettings(), loadMetricsAndRender()]);
    await refreshHealth();
  } catch (error) {
    console.error('Chat Dinger: Popup setup failed.', error);
    showTab('settings');
    showStatus('Chat Dinger could not load its settings.', 'error', 8000);
    setHealth('error', 'Status unavailable', 'Close and open Chat Dinger again.');
  }
}

init();
window.setInterval(refreshHealth, 2000);
