'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Shared = require('../shared.js');

const sharedSource = readFileSync(join(__dirname, '..', 'shared.js'), 'utf8');
const backgroundSource = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    }
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function selectStorageValues(storage, keys) {
  if (keys === null || keys === undefined) {
    return clone(storage);
  }
  if (typeof keys === 'string') {
    return Object.hasOwn(storage, keys) ? { [keys]: clone(storage[keys]) } : {};
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys
      .filter(key => Object.hasOwn(storage, key))
      .map(key => [key, clone(storage[key])]));
  }
  if (typeof keys === 'object') {
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
      key,
      Object.hasOwn(storage, key) ? clone(storage[key]) : clone(fallback)
    ]));
  }
  return {};
}

function makeHarness(options = {}) {
  let context;
  const toRealm = value => vm.runInContext(
    `JSON.parse(${JSON.stringify(JSON.stringify(value))})`,
    context
  );
  const state = {
    storage: clone(options.storage || {}),
    storageSets: [],
    uninstallUrls: [],
    offscreenCreates: [],
    getContextsCalls: [],
    clientMatchCalls: 0,
    runtimeMessages: [],
    alarmCreates: [],
    fetchCalls: [],
    notificationCreates: [],
    notificationClears: [],
    badges: [],
    timeouts: []
  };

  const events = {
    installed: makeEvent(),
    startup: makeEvent(),
    storageChanged: makeEvent(),
    message: makeEvent(),
    alarm: makeEvent(),
    notificationClicked: makeEvent(),
    notificationClosed: makeEvent()
  };

  const runtime = {
    id: 'chat-dinger-test-id',
    getManifest: () => ({ version: '2.0.21', update_url: 'https://example.test/update' }),
    getURL: path => `chrome-extension://chat-dinger-test-id/${path}`,
    setUninstallURL: async url => {
      state.uninstallUrls.push(url);
    },
    sendMessage: async message => {
      state.runtimeMessages.push(clone(message));
      if (options.sendMessage) {
        return options.sendMessage(message);
      }
      return { success: true, audioStarted: true };
    },
    onInstalled: events.installed,
    onStartup: events.startup,
    onMessage: events.message
  };

  if (options.contextMode !== 'legacy') {
    runtime.getContexts = async query => {
      state.getContextsCalls.push(clone(query));
      if (options.contextMode === 'modern-present') {
        return [{ contextType: 'OFFSCREEN_DOCUMENT' }];
      }
      return [];
    };
  }

  const chrome = {
    runtime,
    storage: {
      onChanged: events.storageChanged,
      local: {
        async get(keys) {
          if (options.beforeStorageGet) {
            await options.beforeStorageGet(keys, state);
          }
          return toRealm(selectStorageValues(state.storage, keys));
        },
        async set(values) {
          if (options.beforeStorageSet) {
            await options.beforeStorageSet(values, state);
          }
          const copied = clone(values);
          state.storageSets.push(copied);
          Object.assign(state.storage, copied);
        },
        async clear() {
          state.storage = {};
        }
      }
    },
    offscreen: {
      async createDocument(settings) {
        state.offscreenCreates.push(clone(settings));
      }
    },
    alarms: {
      async get() {
        return options.existingAlarm || null;
      },
      create(name, settings) {
        state.alarmCreates.push({ name, settings: clone(settings) });
      },
      onAlarm: events.alarm
    },
    notifications: {
      async create(id, settings) {
        state.notificationCreates.push({ id, settings: clone(settings) });
        if (options.notificationCreate) {
          return options.notificationCreate(id, settings);
        }
        return id;
      },
      async clear(id) {
        state.notificationClears.push(id);
        return true;
      },
      onClicked: events.notificationClicked,
      onClosed: events.notificationClosed
    },
    tabs: {
      async get(id) {
        return { id, windowId: 1, url: 'https://chatgpt.com/', active: false };
      },
      async update() {},
      async query() {
        return [];
      },
      async create() {}
    },
    windows: {
      async update() {}
    },
    action: {
      async setBadgeText(details) { state.badges.push({ type: 'text', ...clone(details) }); },
      async setBadgeBackgroundColor(details) { state.badges.push({ type: 'color', ...clone(details) }); },
      async setTitle(details) { state.badges.push({ type: 'title', ...clone(details) }); }
    }
  };

  context = vm.createContext({
    AbortController,
    TextDecoder,
    TextEncoder,
    URL,
    chrome,
    clients: {
      async matchAll() {
        state.clientMatchCalls += 1;
        return options.legacyClients || [];
      }
    },
    console: options.console || {
      log() {},
      warn() {},
      error() {}
    },
    crypto: webcrypto,
    fetch: async (...args) => {
      state.fetchCalls.push(args);
      if (options.fetch) {
        return options.fetch(...args);
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            mainButtonSelectors: ['#composer-submit-button'],
            muteToggleSelectors: {
              dictateButton: 'button[aria-label="Start dictation"]',
              flexWrapper: '[class*="items-center"]'
            }
          });
        }
      };
    },
    importScripts() {},
    setTimeout: options.captureTimeouts
      ? (callback, delay) => {
          const id = state.timeouts.length + 1;
          state.timeouts.push({ id, callback, delay, cleared: false });
          return id;
        }
      : setTimeout,
    clearTimeout: options.captureTimeouts
      ? id => {
          const timeout = state.timeouts.find(item => item.id === id);
          if (timeout) timeout.cleared = true;
        }
      : clearTimeout
  });

  vm.runInContext(sharedSource, context, { filename: 'shared.js' });
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });

  async function dispatch(message, sender) {
    const listener = events.message.listeners[0];
    assert.equal(typeof listener, 'function');

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          reject(new Error(`The message did not receive a response: ${message.action}`));
        }
      }, 1000);

      const sendResponse = response => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(clone(response));
      };

      const keepAlive = listener(clone(message), clone(sender), sendResponse);
      if (keepAlive === false && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(undefined);
      }
    });
  }

  return { chrome, context, dispatch, events, state };
}

function extensionSender() {
  return { id: 'chat-dinger-test-id', url: 'chrome-extension://chat-dinger-test-id/popup.html' };
}

function contentSender(tabId = 17) {
  return {
    id: 'chat-dinger-test-id',
    url: 'https://chatgpt.com/c/example',
    tab: { id: tabId, url: 'https://chatgpt.com/c/example' }
  };
}

async function waitFor(predicate, message = 'The condition was not met.') {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('the service worker sets the versioned uninstall survey URL', async () => {
  const { state } = makeHarness();
  await waitFor(() => state.uninstallUrls.length === 1);
  assert.equal(state.uninstallUrls[0], 'https://chatdinger.com/uninstall/?version=2.0.21');
});

test('message handlers reject senders outside the extension', async () => {
  const { dispatch } = makeHarness();
  const externalSender = {
    id: 'other-extension',
    url: 'https://evil.example/',
    tab: { id: 9, url: 'https://evil.example/' }
  };

  const testSound = await dispatch({ action: 'testSound' }, externalSender);
  const completion = await dispatch({ action: 'recordCompletion', duration: 20 }, externalSender);
  const settings = await dispatch({ action: 'settingsUpdated', settings: {} }, externalSender);

  assert.equal(testSound.success, false);
  assert.match(testSound.error, /cannot test a sound/i);
  assert.equal(completion.success, false);
  assert.match(completion.error, /cannot save a completion/i);
  assert.equal(settings.success, false);
  assert.match(settings.error, /incorrect format/i);
});

test('an alert skips audio and notifications when alerts are off', async () => {
  const { dispatch, state } = makeHarness({
    storage: {
      chatAlertSettings: {
        enabled: false,
        volume: 0.4,
        selectedSound: 'ding.mp3',
        notifyOnActiveTab: true,
        showSystemNotification: true
      }
    }
  });

  const response = await dispatch({ action: 'playNotificationSound' }, contentSender());

  assert.deepEqual(response, {
    success: true,
    skipped: true,
    skipReason: 'disabled',
    status: 'Alerts are off.'
  });
  assert.equal(state.runtimeMessages.length, 0);
  assert.equal(state.offscreenCreates.length, 0);
  assert.equal(state.notificationCreates.length, 0);
});

test('an alert creates the offscreen player and reports audio success', async () => {
  const { dispatch, state } = makeHarness({
    contextMode: 'modern-empty',
    storage: {
      chatAlertSettings: {
        enabled: true,
        volume: 0,
        selectedSound: 'ding.mp3',
        notifyOnActiveTab: true,
        showSystemNotification: false
      }
    }
  });

  const response = await dispatch({ action: 'playNotificationSound' }, contentSender());

  assert.equal(response.success, true);
  assert.equal(response.audioStarted, true);
  assert.equal(response.notificationShown, false);
  assert.equal(state.offscreenCreates.length, 1);
  assert.deepEqual(state.runtimeMessages, [{
    target: 'offscreen',
    action: 'playOffscreenAudio',
    soundFile: 'ding.mp3',
    volume: 0
  }]);
});

test('a notification error does not discard a successful sound', async () => {
  const { dispatch } = makeHarness({
    contextMode: 'modern-present',
    storage: {
      chatAlertSettings: {
        enabled: true,
        volume: 0.7,
        selectedSound: 'ding.mp3',
        notifyOnActiveTab: true,
        showSystemNotification: true
      }
    },
    async notificationCreate() {
      throw new Error('Notifications are unavailable.');
    }
  });

  const response = await dispatch({ action: 'playNotificationSound' }, contentSender());

  assert.equal(response.success, true);
  assert.equal(response.audioStarted, true);
  assert.equal(response.notificationShown, false);
  assert.match(response.notificationError, /unavailable/i);
});

test('a system notification clears itself after seven seconds', async () => {
  const { dispatch, state } = makeHarness({
    contextMode: 'modern-present',
    captureTimeouts: true,
    storage: {
      chatAlertSettings: {
        enabled: true,
        volume: 0.7,
        selectedSound: 'ding.mp3',
        notifyOnActiveTab: true,
        showSystemNotification: true
      }
    }
  });

  const response = await dispatch({ action: 'playNotificationSound' }, contentSender(42));

  assert.equal(response.success, true);
  assert.equal(response.notificationShown, true);
  assert.equal(state.notificationCreates.length, 1);
  assert.equal(state.notificationCreates[0].settings.requireInteraction, false);
  assert.equal(state.timeouts.length, 1);
  assert.equal(state.timeouts[0].delay, 7000);

  await state.timeouts[0].callback();
  assert.deepEqual(state.notificationClears, [state.notificationCreates[0].id]);
});

test('Chrome 116 reuses an offscreen document found with getContexts', async () => {
  const { dispatch, state } = makeHarness({ contextMode: 'modern-present' });

  const response = await dispatch({ action: 'testSound', soundFile: 'coin.mp3' }, extensionSender());

  assert.equal(response.success, true);
  assert.equal(state.getContextsCalls.length, 1);
  assert.equal(state.offscreenCreates.length, 0);
  assert.equal(state.clientMatchCalls, 0);
});

test('Chrome 109 reuses an offscreen document found with service worker clients', async () => {
  const offscreenUrl = 'chrome-extension://chat-dinger-test-id/offscreen.html';
  const { dispatch, state } = makeHarness({
    contextMode: 'legacy',
    legacyClients: [{ url: offscreenUrl }]
  });

  const response = await dispatch({ action: 'testSound' }, extensionSender());

  assert.equal(response.success, true);
  assert.equal(state.clientMatchCalls, 1);
  assert.equal(state.offscreenCreates.length, 0);
});

test('concurrent completions save both dings without requesting page UI', async () => {
  const { dispatch, state } = makeHarness({
    storage: {
      dingerMetrics: {
        total: 6,
        todayCount: 6,
        lastDate: Shared.localDayKey(new Date()),
        totalGenTime: 600,
        timedResponseCount: 6
      }
    },
    async beforeStorageSet(values) {
      if (values.dingerMetrics) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  });

  const responses = await Promise.all([
    dispatch({
      action: 'recordCompletion',
      duration: 200,
      soundFile: 'ding.mp3',
      occurredAt: Date.now()
    }, contentSender(21)),
    dispatch({
      action: 'recordCompletion',
      duration: 400,
      soundFile: 'coin.mp3',
      occurredAt: Date.now()
    }, contentSender(22))
  ]);

  assert.equal(state.storage.dingerMetrics.total, 8);
  assert.equal(state.storage.dingerMetrics.timedResponseCount, 8);
  assert.equal(state.storage.dingerMetrics.totalGenTime, 1200);
  assert.equal(responses.filter(response => response.shouldAskReview).length, 0);
  assert.equal(state.storage.reviewPromptShown, undefined);
  assert.equal(state.storage.hasShownPopup, undefined);
});

test('seven dings and a worker restart do not request page UI', async () => {
  const { dispatch, state } = makeHarness();
  for (let ding = 1; ding <= 8; ding += 1) {
    const response = await dispatch({
      action: 'recordCompletion', duration: 200, soundFile: 'ding.mp3', occurredAt: Date.now()
    }, contentSender());
    assert.equal(response.success, true);
    assert.equal(response.metrics.total, ding);
    assert.equal(response.shouldAskReview, false);
  }
  const restarted = makeHarness({ storage: state.storage });
  const response = await restarted.dispatch({
    action: 'recordCompletion', duration: 200, soundFile: 'ding.mp3', occurredAt: Date.now()
  }, contentSender());
  assert.equal(response.success, true);
  assert.equal(response.shouldAskReview, false);
});

for (const shownFlag of ['reviewPromptShown', 'hasShownPopup']) {
  test(`an existing ${shownFlag} prevents another Deal popup`, async () => {
    const { dispatch } = makeHarness({ storage: { dingerMetrics: { total: 20 }, [shownFlag]: true } });
    const response = await dispatch({
      action: 'recordCompletion', duration: 200, soundFile: 'ding.mp3', occurredAt: Date.now()
    }, contentSender());
    assert.equal(response.success, true);
    assert.equal(response.shouldAskReview, false);
  });
}

test('an existing user above seven dings does not get an in-page review prompt', async () => {
  const { dispatch } = makeHarness({ storage: { dingerMetrics: { total: 20 } } });
  const response = await dispatch({
    action: 'recordCompletion', duration: 200, soundFile: 'ding.mp3', occurredAt: Date.now()
  }, contentSender());
  assert.equal(response.success, true);
  assert.equal(response.shouldAskReview, false);
});

test('the selector alarm runs hourly and only its named alarm starts a fetch', async () => {
  const { events, state } = makeHarness();

  await waitFor(() => state.alarmCreates.length === 1, 'The selector alarm was not created.');
  assert.deepEqual(state.alarmCreates[0], {
    name: 'updateSelectorsAlarm',
    settings: { periodInMinutes: 60 }
  });

  events.alarm.listeners[0]({ name: 'anotherAlarm' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.fetchCalls.length, 0);

  events.alarm.listeners[0]({ name: 'updateSelectorsAlarm' });
  await waitFor(
    () => Number.isFinite(state.storage.lastSelectorRefresh),
    'The selector alarm did not save a successful refresh.'
  );

  assert.equal(state.fetchCalls.length, 1);
  assert.equal(state.fetchCalls[0][0], 'https://chatdinger.com/selectors.json');
  assert.equal(state.fetchCalls[0][1].credentials, 'omit');
  assert.equal(state.storage.customSelectors.version, 1);
});

test('the selector fetch rejects a response above the size limit', async () => {
  const { dispatch, state } = makeHarness({
    fetch: async () => ({
      ok: true,
      status: 200,
      async text() {
        return 'x'.repeat(33 * 1024);
      }
    })
  });

  const response = await dispatch({ action: 'refreshSelectors' }, contentSender());

  assert.equal(response.success, false);
  assert.equal(response.status, 'failed');
  assert.match(response.error, /too large/i);
  assert.equal(state.storage.customSelectors, undefined);
});


test('fresh installation activates supported open tabs without reloading them', async () => {
  const { chrome, events } = makeHarness();
  const injected = [];
  chrome.tabs.query = async query => {
    assert.deepEqual(clone(query), { url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    return [
      { id: 1, url: 'https://chatgpt.com/c/one' },
      { id: 2, url: 'https://chat.openai.com/' },
      { id: 3, url: 'https://example.com/' },
      { id: 4, url: 'https://chatgpt.com/', discarded: true }
    ];
  };
  chrome.scripting = { executeScript: async options => injected.push(clone(options)) };
  chrome.tabs.sendMessage = async () => ({ success: true });
  chrome.tabs.reload = () => assert.fail('Installation must not reload a page.');
  await events.installed.listeners[0]({ reason: 'install' });
  assert.deepEqual(injected, [1, 2].map(tabId => ({
    target: { tabId, frameIds: [0] }, files: ['shared.js', 'detector.js', 'content.js'], world: 'ISOLATED'
  })));
});

test('a closed tab does not prevent activation in another tab', async () => {
  const { chrome, events } = makeHarness();
  const checked = [];
  chrome.tabs.query = async () => [1, 2].map(id => ({ id, url: 'https://chatgpt.com/' }));
  chrome.scripting = { executeScript: async ({ target }) => {
    if (target.tabId === 1) throw new Error('Tab closed');
  } };
  chrome.tabs.sendMessage = async id => { checked.push(id); return { success: true }; };
  await events.installed.listeners[0]({ reason: 'install' });
  assert.deepEqual(checked, [2]);
});

test('updates connect open ChatGPT tabs without a refresh or setup page', async () => {
  const { chrome, events } = makeHarness();
  const injected = [];
  chrome.tabs.query = async () => [{ id: 1, url: 'https://chatgpt.com/c/existing' }];
  chrome.scripting = { executeScript: async options => injected.push(clone(options)) };
  chrome.tabs.sendMessage = async () => ({ success: true });
  chrome.tabs.reload = () => assert.fail('An update must not refresh the page.');
  chrome.tabs.create = () => assert.fail('An update must not open setup.');
  await events.installed.listeners[0]({ reason: 'update' });
  assert.equal(injected.length, 1);
  assert.deepEqual(injected[0].files, ['shared.js', 'detector.js', 'content.js']);
});

test('popup reconnection shares one injection for simultaneous requests', async () => {
  const { chrome, dispatch } = makeHarness();
  let injected = 0;
  chrome.scripting = { executeScript: async () => { injected++; } };
  chrome.tabs.sendMessage = async () => ({ success: true, state: 'ready' });
  chrome.tabs.reload = () => assert.fail('Reconnection must not refresh the page.');
  const results = await Promise.all([1, 2].map(() => dispatch({ action: 'reconnectTab', tabId: 1 }, extensionSender())));
  assert.equal(injected, 1);
  assert.ok(results.every(result => result.success));
});

test('reconnection rejects page senders and unsupported or discarded tabs', async () => {
  const { chrome, dispatch } = makeHarness();
  chrome.scripting = { executeScript: () => assert.fail('This request must not inject code.') };
  assert.equal((await dispatch({ action: 'reconnectTab', tabId: 1 }, contentSender())).success, false);
  for (const tab of [{ url: 'https://example.test/' }, { url: 'https://chatgpt.com/', discarded: true }]) {
    chrome.tabs.get = async () => tab;
    assert.equal((await dispatch({ action: 'reconnectTab', tabId: 1 }, extensionSender())).success, false);
  }
});

test('reconnection can retry after a failed injection', async () => {
  const { chrome, dispatch } = makeHarness();
  chrome.scripting = { executeScript: async () => { throw new Error('Tab is not ready'); } };
  const request = { action: 'reconnectTab', tabId: 1 };
  assert.equal((await dispatch(request, extensionSender())).success, false);
  chrome.scripting.executeScript = async () => {};
  chrome.tabs.sendMessage = async () => ({ success: true });
  assert.equal((await dispatch(request, extensionSender())).success, true);
});

test('setup opens only on a fresh install, even when open-tab activation fails', async () => {
  for (const reason of ['install', 'update', 'chrome_update']) {
    const { chrome, events } = makeHarness();
    const created = [];
    chrome.tabs.query = async () => { throw new Error('Query failed'); };
    chrome.tabs.create = async options => created.push(clone(options));
    await events.installed.listeners[0]({ reason });
    assert.deepEqual(created, reason === 'install'
      ? [{ url: 'chrome-extension://chat-dinger-test-id/onboarding.html' }]
      : []);
  }
});


test('the onboarding extension tab can test audio but a website tab cannot', async () => {
  const { dispatch, state } = makeHarness();
  const result = await dispatch({ action: 'testSound', soundFile: 'nylon.mp3', volume: .4 }, {
    id: 'chat-dinger-test-id',
    url: 'chrome-extension://chat-dinger-test-id/onboarding.html',
    tab: { id: 4 }
  });
  assert.equal(result.success, true);
  assert.equal(state.offscreenCreates.length, 1);
  const blocked = await dispatch({ action: 'testSound', soundFile: 'nylon.mp3' }, contentSender());
  assert.equal(blocked.success, false);
});

for (const scenario of [
  { name: 'foreground ChatGPT', active: true, focused: true, state: 'normal', sound: true, desktop: false },
  { name: 'another tab', active: false, focused: true, state: 'normal', sound: true, desktop: true },
  { name: 'another window', active: true, focused: false, state: 'normal', sound: true, desktop: true },
  { name: 'minimized window', active: true, focused: false, state: 'minimized', sound: true, desktop: true },
  { name: 'foreground sound disabled', active: true, focused: true, state: 'normal', foregroundSound: false, sound: false, desktop: false },
  { name: 'away with foreground sound disabled', active: true, focused: false, state: 'normal', foregroundSound: false, sound: true, desktop: true },
  { name: 'desktop notifications disabled', active: false, focused: true, state: 'normal', desktopEnabled: false, sound: true, desktop: false }
]) {
  test(`completion alert respects ${scenario.name}`, async () => {
    const { chrome, dispatch, state } = makeHarness({ storage: { chatAlertSettings: {
      ...Shared.DEFAULT_SETTINGS,
      notifyOnActiveTab: scenario.foregroundSound !== false,
      showSystemNotification: scenario.desktopEnabled !== false
    } } });
    chrome.tabs.get = async id => ({ id, windowId: 1, url: 'https://chatgpt.com/', active: scenario.active });
    chrome.windows.get = async () => ({ focused: scenario.focused, state: scenario.state });
    const response = await dispatch({ action: 'playNotificationSound' }, contentSender());
    assert.equal(response.success, true);
    if (!scenario.sound) assert.equal(response.skipReason, 'active_tab');
    assert.equal(state.offscreenCreates.length > 0, scenario.sound);
    assert.equal(state.notificationCreates.length > 0, scenario.desktop);
  });
}

test('returning to ChatGPT during playback suppresses the desktop notification', async () => {
  const { chrome, dispatch, state } = makeHarness();
  let reads = 0;
  chrome.tabs.get = async id => ({ id, windowId: 1, url: 'https://chatgpt.com/', active: ++reads > 1 });
  chrome.windows.get = async () => ({ focused: true, state: 'normal' });
  await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(state.offscreenCreates.length, 1);
  assert.equal(state.notificationCreates.length, 0);
});

test('a failed focus check after playback does not report an audio failure', async () => {
  const { chrome, dispatch, state } = makeHarness();
  let reads = 0;
  chrome.tabs.get = async id => {
    if (++reads > 1) throw new Error('The tab closed after playback started.');
    return { id, windowId: 1, url: 'https://chatgpt.com/', active: false };
  };
  const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(reads, 2);
  assert.equal(result.success, true);
  assert.equal(result.audioStarted, true);
  assert.equal(result.code, undefined);
  assert.equal(state.notificationCreates.length, 0);
});

test('resetting settings preserves the review link click', async () => {
  const { dispatch, state } = makeHarness({ storage: { reviewLinkClicked: true } });
  await dispatch({ action: 'deleteLocalData' }, extensionSender());
  assert.equal(state.storage.reviewLinkClicked, true);
});

test('recovery bypasses a recent routine refresh and stale proxy cache', async () => {
  const { dispatch, state } = makeHarness({ storage: { lastSelectorRefresh: Date.now() } });
  const response = await dispatch({ action: 'refreshSelectors', reason: 'recovery' }, contentSender());
  assert.equal(response.success, true);
  assert.match(state.fetchCalls[0][0], /^https:\/\/chatdinger\.com\/selectors\.json\?refresh=\d+$/);
  assert.equal(state.fetchCalls[0][1].cache, 'no-store');
  assert.ok(response.config);
});

test('concurrent tabs share one recovery fetch', async () => {
  const { dispatch, state } = makeHarness();
  await Promise.all([17, 18, 19].map(id => dispatch({ action: 'refreshSelectors', reason: 'recovery' }, contentSender(id))));
  assert.equal(state.fetchCalls.length, 1);
});

test('failed recovery requests are throttled across tabs', async () => {
  const { dispatch, state } = makeHarness({ fetch: async () => { throw new Error('offline'); } });
  const first = await dispatch({ action: 'refreshSelectors', reason: 'recovery' }, contentSender());
  const second = await dispatch({ action: 'refreshSelectors', reason: 'recovery' }, contentSender(18));
  assert.equal(first.status, 'failed');
  assert.equal(second.status, 'cooldown');
  assert.ok(second.retryAfterMs > 0);
  assert.equal(state.fetchCalls.length, 1);
});

test('bad selector updates preserve the cached configuration', async () => {
  const previous = { version: 1, mainButtonSelectors: ['#previous'], muteToggleSelectors: { dictateButton: 'button', flexWrapper: 'form' } };
  const { dispatch, state } = makeHarness({ storage: { customSelectors: previous }, fetch: async () => ({ ok: true, text: async () => '{"wrong":true}' }) });
  await dispatch({ action: 'refreshSelectors', reason: 'recovery' }, contentSender());
  assert.deepEqual(state.storage.customSelectors, previous);
});

const failureHealth = { state: 'unavailable', code: 'controls_missing', selectorRevision: '1234abcd', attempts: 2 };

async function waitForUninstallUrl(state, count = 1) {
  await waitFor(() => state.uninstallUrls.length >= count, 'The uninstall URL was not updated.');
  return new URL(state.uninstallUrls.at(-1));
}

test('uninstall URL omits failure data when diagnostics are off', async () => {
  const { state } = makeHarness({ storage: {
    diagnosticsEnabled: false,
    lastDetectionFailure: { ...failureHealth, extensionVersion: '2.0.21', occurredAt: Date.now() }
  } });
  const url = await waitForUninstallUrl(state);
  assert.equal(url.searchParams.get('version'), '2.0.21');
  assert.equal(url.searchParams.has('failure_code'), false);
  assert.equal(url.searchParams.has('selectorRevision'), false);
});

test('uninstall URL includes only the allowlisted opt-in failure snapshot', async () => {
  const occurredAt = Date.now() - 60_000;
  const { state } = makeHarness({ storage: { diagnosticsEnabled: true, lastDetectionFailure: {
    ...failureHealth, extensionVersion: '2.0.19', occurredAt, url: 'private', text: 'private', attempts: 99
  } } });
  const url = await waitForUninstallUrl(state);
  assert.equal(url.searchParams.get('failure_code'), 'controls_missing');
  assert.equal(url.searchParams.get('failure_revision'), '1234abcd');
  assert.equal(url.searchParams.get('failure_version'), '2.0.19');
  assert.equal(url.searchParams.get('failure_at'), String(occurredAt));
  assert.ok(Date.now() - Number(url.searchParams.get('failure_at')) >= 60_000);
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    'failure_at', 'failure_code', 'failure_revision', 'failure_version', 'version'
  ]);
});

test('uninstall URL rejects invalid versions and timestamps', async () => {
  const { state } = makeHarness({ storage: { diagnosticsEnabled: true, lastDetectionFailure: {
    ...failureHealth, extensionVersion: { arbitrary: true }, occurredAt: 'old'
  } } });
  const url = await waitForUninstallUrl(state);
  assert.equal(url.searchParams.has('failure_code'), false);
});

test('uninstall URL rejects a future failure timestamp', async () => {
  const { state } = makeHarness({ storage: { diagnosticsEnabled: true, lastDetectionFailure: {
    ...failureHealth, extensionVersion: '2.0.21', occurredAt: Date.now() + 60_000
  } } });
  const url = await waitForUninstallUrl(state);
  assert.equal(url.searchParams.has('failure_code'), false);
});

test('uninstall URL refreshes after a failure change and removes data after opt-out', async () => {
  const { state, events } = makeHarness({ storage: { diagnosticsEnabled: true } });
  await waitForUninstallUrl(state);
  const record = { ...failureHealth, extensionVersion: '2.0.21', occurredAt: Date.now() };
  state.storage.lastDetectionFailure = record;
  events.storageChanged.listeners[0]({ lastDetectionFailure: { newValue: record } }, 'local');
  let url = await waitForUninstallUrl(state, 2);
  assert.equal(url.searchParams.get('failure_code'), 'controls_missing');
  state.storage.diagnosticsEnabled = false;
  events.storageChanged.listeners[0]({ diagnosticsEnabled: { oldValue: true, newValue: false } }, 'local');
  url = await waitForUninstallUrl(state, 3);
  assert.equal(url.searchParams.has('failure_code'), false);
  assert.equal(url.searchParams.has('failure_at'), false);
});

test('the badge shows OFF when alerts are off and clears when they are ready', async () => {
  const { dispatch, state } = makeHarness();
  await dispatch({ action: 'detectorHealth', health: { ...failureHealth, state: 'off', code: null, attempts: 0 } }, contentSender());
  assert.deepEqual(state.badges.filter(b => b.type === 'text').at(-1), { type: 'text', tabId: 17, text: 'OFF' });
  assert.equal(state.badges.filter(b => b.type === 'title').at(-1).title, 'Chat Dinger: alerts are off');
  assert.equal(state.storage.lastDetectionFailure, undefined);
  await dispatch({ action: 'detectorHealth', health: { ...failureHealth, state: 'ready', code: null, attempts: 0 } }, contentSender());
  assert.deepEqual(state.badges.filter(b => b.type === 'text').at(-1), { type: 'text', tabId: 17, text: '' });
  await dispatch({ action: 'detectorHealth', health: failureHealth }, contentSender());
  assert.deepEqual(state.badges.filter(b => b.type === 'text').at(-1), { type: 'text', tabId: 17, text: '!' });
});

test('failure diagnostics stay local unless the user opts in', async () => {
  const { dispatch, state } = makeHarness();
  await dispatch({ action: 'detectorHealth', health: { ...failureHealth, url: 'private', text: 'private' } }, contentSender());
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.storage.lastDetectionFailure.code, 'controls_missing');
  assert.equal(state.storage.lastDetectionFailure.url, undefined);
  assert.equal(state.storage.lastDetectionFailure.text, undefined);
});

test('opt-in reports contain fixed diagnostics and suppress duplicates', async () => {
  const { dispatch, state } = makeHarness({ storage: { diagnosticsEnabled: true }, fetch: async () => ({ status: 202 }) });
  for (const id of [17, 18]) await dispatch({ action: 'detectorHealth', health: failureHealth }, contentSender(id));
  assert.equal(state.fetchCalls.length, 1);
  assert.equal(state.fetchCalls[0][0], 'https://chatdinger.com/api/dinger-health');
  assert.deepEqual(JSON.parse(state.fetchCalls[0][1].body), {
    extensionVersion: '2.0.21', code: 'controls_missing', selectorRevision: '1234abcd'
  });
  assert.equal(state.fetchCalls[0][1].credentials, 'omit');
});

test('a foreign sender cannot write health records or send diagnostics', async () => {
  const { dispatch, state } = makeHarness({ storage: { diagnosticsEnabled: true } });
  const response = await dispatch({ action: 'detectorHealth', health: failureHealth }, { id: 'foreign', tab: { id: 1 } });
  assert.equal(response.success, false);
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.storage.lastDetectionFailure, undefined);
});

test('failed diagnostic delivery does not fail the local health update', async () => {
  const { dispatch, state } = makeHarness({ storage: { diagnosticsEnabled: true }, fetch: async () => { throw new Error('offline'); } });
  const result = await dispatch({ action: 'detectorHealth', health: failureHealth }, contentSender());
  assert.equal(result.success, true);
  assert.equal(state.storage.lastDiagnosticReport, undefined);
});

for (const failure of [
  { name: 'an unconfirmed successful reply', sendMessage: async () => ({ success: true }) },
  { name: 'an explicit audioStarted false reply', sendMessage: async () => ({ success: true, audioStarted: false }) },
  { name: 'a rejected audio start', sendMessage: async () => ({ success: false, error: 'Playback was blocked.' }) },
  { name: 'a missing offscreen reply', sendMessage: async () => undefined },
  { name: 'a closed offscreen message port', sendMessage: async () => { throw new Error('The message port closed.'); } }
]) {
  test(`an alert reports audio_failed for ${failure.name}`, async () => {
    const { dispatch, state } = makeHarness(failure);
    const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
    assert.equal(result.success, false);
    assert.equal(result.code, 'audio_failed');
    assert.equal(result.audioStarted, false);
    assert.equal(result.skipped, undefined);
    assert.equal(state.notificationCreates.length, 0);
  });
}

test('an offscreen creation failure returns the audio failure code', async () => {
  const { chrome, dispatch } = makeHarness();
  chrome.offscreen.createDocument = async () => { throw new Error('Offscreen creation failed.'); };
  const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(result.code, 'audio_failed');
  assert.equal(result.audioStarted, false);
});

test('a closed audio document recovers once when Chrome reports no receiver', async () => {
  let sends = 0;
  const { chrome, dispatch, state } = makeHarness({ sendMessage: async () => {
    if (++sends === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { success: true, audioStarted: true };
  } });
  let checks = 0;
  chrome.runtime.getContexts = async () => ++checks === 1 ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [];
  const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(result.audioStarted, true);
  assert.equal(sends, 2);
  assert.equal(state.offscreenCreates.length, 1);
});

test('an audio receiver that stays missing gets only one retry', async () => {
  let sends = 0;
  const { dispatch } = makeHarness({ sendMessage: async () => {
    sends++;
    throw new Error('Could not establish connection. Receiving end does not exist.');
  } });
  const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(result.code, 'audio_failed');
  assert.equal(sends, 2);
});

test('an ambiguous closed audio port is not retried and cannot produce duplicate playback', async () => {
  let sends = 0;
  const { dispatch } = makeHarness({ sendMessage: async () => {
    sends++;
    throw new Error('The message port closed before a response was received.');
  } });
  const result = await dispatch({ action: 'playNotificationSound' }, contentSender());
  assert.equal(result.code, 'audio_failed');
  assert.equal(sends, 1);
});

test('a failed sound test returns the audio failure code', async () => {
  const { dispatch } = makeHarness({ sendMessage: async () => ({ success: false, error: 'The sound failed.' }) });
  const result = await dispatch({ action: 'testSound' }, extensionSender());
  assert.equal(result.success, false);
  assert.equal(result.code, 'audio_failed');
  assert.equal(result.audioStarted, false);
});

for (const action of ['playNotificationSound', 'testSound']) {
  test(`${action} does not report deliberate sound replacement as a failure or a played sound`, async () => {
    const { dispatch, state } = makeHarness({ sendMessage: async () => ({ success: true, skipped: true, skipReason: 'superseded' }) });
    const result = await dispatch({ action }, action === 'testSound' ? extensionSender() : contentSender());
    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'superseded');
    assert.equal(result.audioStarted, false);
    assert.equal(result.code, undefined);
    assert.equal(state.notificationCreates.length, 0);
  });
}

for (const code of ['audio_failed', 'generation_stalled']) {
  test(`${code} reports immediately when diagnostics are enabled`, async () => {
    const { dispatch, state } = makeHarness({ storage: { diagnosticsEnabled: true }, fetch: async () => ({ status: 202 }) });
    const result = await dispatch({ action: 'detectorHealth', health: { ...failureHealth, code, attempts: 0 } }, contentSender());
    assert.equal(result.success, true);
    assert.equal(state.storage.lastDetectionFailure.code, code);
    assert.equal(state.fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(state.fetchCalls[0][1].body), {
      extensionVersion: '2.0.21', code, selectorRevision: '1234abcd'
    });
  });

  test(`${code} remains local when diagnostics are disabled`, async () => {
    const { dispatch, state } = makeHarness();
    const result = await dispatch({ action: 'detectorHealth', health: { ...failureHealth, code, attempts: 0 } }, contentSender());
    assert.equal(result.success, true);
    assert.equal(state.storage.lastDetectionFailure.code, code);
    assert.equal(state.fetchCalls.length, 0);
  });
}

test('a new health code still requires the fixed allowlist', async () => {
  const { dispatch, state } = makeHarness({ storage: { diagnosticsEnabled: true } });
  const result = await dispatch({ action: 'detectorHealth', health: { ...failureHealth, code: 'private-page-text' } }, contentSender());
  assert.equal(result.success, false);
  assert.equal(state.storage.lastDetectionFailure, undefined);
  assert.equal(state.fetchCalls.length, 0);
});
