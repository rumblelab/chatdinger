'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

async function harness(t, initial, soundResult = { success: true, audioStarted: true }) {
  const dom = new JSDOM(readFileSync('popup.html', 'utf8'), { url: 'https://extension.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  let status = initial;
  const messages = [], tabs = [];
  window.chrome = {
    runtime: { getManifest: () => ({ version: '2.0.22' }), sendMessage: async message => message.action === 'testSound' ? soundResult : { success: true } },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/' }],
      sendMessage: async (_id, message) => {
        messages.push(message);
        if (message.action === 'setAudioHealth') {
          status = { ...status, state: message.failed ? 'unavailable' : 'ready', code: message.failed ? 'audio_failed' : null };
        }
        return status;
      },
      create: async tab => tabs.push(tab), reload: async () => tabs.push('reload') }
  };
  window.eval(readFileSync('shared.js', 'utf8'));
  window.eval(readFileSync('metrics.js', 'utf8'));
  window.eval(readFileSync('popup.js', 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 10));
  return { window, messages, tabs, element: id => window.document.getElementById(id), setStatus: value => { status = value; } };
}

test('missing controls show automatic retry without internal DOM terms', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'controls_missing', nextRetryAt: Date.now() + 120000 });
  assert.equal(h.element('health-title').textContent, 'Alerts are temporarily unavailable');
  assert.match(h.element('health-detail').textContent, /Automatic retry/);
  assert.equal(h.element('health-action').textContent, 'Retry connection');
  assert.doesNotMatch(h.element('health').textContent, /composer|selector|listener/i);
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(h.messages.some(message => message.action === 'recoverDetection'));
  assert.equal(h.tabs.length, 0);
});

test('ready detection takes priority over obsolete composer status', async t => {
  const h = await harness(t, { success: true, monitoring: true, composerFound: false });
  assert.equal(h.element('health-title').textContent, 'Ready for the next reply');
  assert.equal(h.element('health').dataset.state, 'ready');
});

test('an unavailable extension connection reconnects without a page refresh', async t => {
  const h = await harness(t, null);
  assert.equal(h.element('health-action').textContent, 'Reconnect');
  h.window.chrome.runtime.sendMessage = async message => {
    assert.deepEqual(JSON.parse(JSON.stringify(message)), { action: 'reconnectTab', tabId: 1 });
    h.setStatus({ success: true, monitoring: true });
    return { success: true };
  };
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.element('health-title').textContent, 'Ready for the next reply');
  assert.equal(h.tabs.length, 0);
});

test('failed reconnection shows the site access check and keeps a retry action', async t => {
  const h = await harness(t, null);
  h.window.chrome.runtime.sendMessage = async () => ({ success: false });
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(h.element('health-detail').textContent, /Chrome permits Chat Dinger/);
  assert.equal(h.element('health-action').textContent, 'Try again');
  assert.equal(h.tabs.length, 0);
});

test('Report problem opens a draft with fixed codes and no arbitrary page data', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'controls_missing', selectorRevision: '1234abcd', privateText: 'PRIVATE CHAT' });
  h.element('health-report').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const url = new URL(h.tabs[0].url);
  assert.equal(url.pathname, '/rumblelab/chatdinger/issues/new');
  assert.match(url.searchParams.get('body'), /controls_missing/);
  assert.doesNotMatch(url.searchParams.get('body'), /PRIVATE CHAT/);
});

test('sound failure takes priority over healthy detection and a sound test clears it', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'audio_failed', monitoring: true });
  assert.equal(h.element('health-title').textContent, 'The sound did not play');
  assert.equal(h.element('health-action').textContent, 'Test sound');
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(h.messages.some(m => m.action === 'setAudioHealth' && m.failed === false));
  assert.equal(h.element('health-title').textContent, 'Ready for the next reply');
  assert.equal(h.tabs.length, 0);
});

test('a failed sound test keeps the sound warning', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'audio_failed', monitoring: true },
    { success: false, code: 'audio_failed' });
  h.window.console.error = () => {};
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(h.messages.some(m => m.action === 'setAudioHealth' && m.failed === true));
  assert.equal(h.element('health-title').textContent, 'The sound did not play');
});

test('a replaced sound test does not clear or create a sound warning', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'audio_failed', monitoring: true },
    { success: true, skipped: true, skipReason: 'superseded' });
  h.element('health-action').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.messages.some(m => m.action === 'setAudioHealth'), false);
  assert.equal(h.element('health-title').textContent, 'The sound did not play');
});

test('a stalled response stays visible while detection continues', async t => {
  const h = await harness(t, { success: true, state: 'unavailable', code: 'generation_stalled', monitoring: true, isGenerating: true });
  assert.equal(h.element('health-title').textContent, 'The response is still in progress');
  assert.match(h.element('health-detail').textContent, /cannot confirm completion/);
  assert.equal(h.element('health-action').classList.contains('hidden'), true);
  h.element('health-report').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(new URL(h.tabs[0].url).searchParams.get('body'), /generation_stalled/);
});

test('an untracked response after navigation does not show that alerts are ready', async t => {
  const h = await harness(t, { success: true, state: 'waiting', code: null, monitoring: false, isGenerating: true });
  assert.equal(h.element('health-title').textContent, 'Waiting for the next response');
  assert.equal(h.element('health').dataset.state, 'checking');
  assert.equal(h.element('health-action').classList.contains('hidden'), true);
});

test('Copy diagnostics includes build markers without the active tab URL', async t => {
  const h = await harness(t, { success: true, state: 'ready', detector: { build: 'send-control-4', events: [] } });
  let copied;
  Object.defineProperty(h.window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
  h.element('copy-diagnostics').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const report = JSON.parse(copied);
  assert.equal(report.popupBuild, 'update-reconnect-1');
  assert.equal(report.content.detector.build, 'send-control-4');
  assert.equal(report.extensionVersion, '2.0.22');
  assert.doesNotMatch(copied, /https?:|chatgpt\.com/);
  assert.equal(h.element('copy-diagnostics').disabled, false);
});

test('Copy diagnostics exposes a selected report if the clipboard is unavailable', async t => {
  const h = await harness(t, { success: true, state: 'ready' });
  h.element('copy-diagnostics').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const output = h.element('diagnostic-output');
  assert.equal(output.classList.contains('hidden'), false);
  assert.equal(output.selectionEnd, output.value.length);
  assert.equal(JSON.parse(output.value).content.error, 'diagnostics_not_available');
});

test('Copy diagnostics identifies a disconnected content script', async t => {
  const h = await harness(t, { success: true, state: 'ready' });
  h.window.chrome.tabs.sendMessage = async () => { throw new Error('PRIVATE ERROR'); };
  h.element('copy-diagnostics').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const report = h.element('diagnostic-output').value;
  assert.equal(JSON.parse(report).content.error, 'content_not_connected');
  assert.doesNotMatch(report, /PRIVATE ERROR/);
});

test('the header alerts switch and the settings switch stay in sync and save', async t => {
  const h = await harness(t, { success: true, monitoring: true });
  const saved = [];
  h.window.chrome.runtime.sendMessage = async message => {
    if (message.action === 'settingsUpdated') saved.push(message.settings.enabled);
    return { success: true };
  };
  assert.equal(h.element('quick-enabled-toggle').checked, true);
  assert.equal(h.element('enabled-toggle').checked, true);
  h.element('quick-enabled-toggle').checked = false;
  h.element('quick-enabled-toggle').dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.element('enabled-toggle').checked, false);
  assert.deepEqual(saved, [false]);
  h.element('enabled-toggle').checked = true;
  h.element('enabled-toggle').dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.element('quick-enabled-toggle').checked, true);
  assert.deepEqual(saved, [false, true]);
});
