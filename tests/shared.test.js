'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Shared = require('../shared.js');

test('clampVolume keeps zero and limits the range', () => {
  assert.equal(Shared.clampVolume(0), 0);
  assert.equal(Shared.clampVolume('0'), 0);
  assert.equal(Shared.clampVolume(-1), 0);
  assert.equal(Shared.clampVolume(3), 1);
  assert.equal(Shared.clampVolume('bad'), 0.7);
});

test('normalizeSettings migrates old mute, notification, and sound values', () => {
  assert.deepEqual(Shared.normalizeSettings({
    enabled: true,
    isMuted: true,
    volume: 0,
    selectedSound: 'cryptic.mp3',
    notifyOnActiveTab: false,
    enableNotifications: false
  }), {
    enabled: false,
    volume: 0,
    selectedSound: 'cryptic.wav',
    notifyOnActiveTab: false,
    showSystemNotification: false,
    markUnreadTab: true
  });
});

test('normalizeSettings keeps markUnreadTab false and defaults other values to true', () => {
  assert.equal(Shared.normalizeSettings({ markUnreadTab: false }).markUnreadTab, false);
  assert.equal(Shared.normalizeSettings({}).markUnreadTab, true);
  assert.equal(Shared.normalizeSettings({ markUnreadTab: 'no' }).markUnreadTab, true);
});

test('normalizeSettings rejects a sound outside the package', () => {
  const settings = Shared.normalizeSettings({ selectedSound: '../../bad.mp3' });
  assert.equal(settings.selectedSound, Shared.DEFAULT_SETTINGS.selectedSound);
});

test('local date keys use the local calendar date', () => {
  const date = new Date(2026, 0, 2, 23, 30, 0);
  assert.equal(Shared.localDayKey(date), '2026-01-02');
  assert.equal(Shared.localMonthKey(date), '2026-01');
});

test('completion metrics use the timed response count for the average', () => {
  const firstDate = new Date(2026, 3, 10, 12, 0, 0);
  const secondDate = new Date(2026, 3, 10, 13, 0, 0);
  let metrics = Shared.applyCompletionToMetrics({}, {
    duration: 1000,
    soundFile: 'ding.mp3',
    occurredAt: firstDate
  });
  metrics = Shared.applyCompletionToMetrics(metrics, {
    duration: 3000,
    soundFile: 'ding.mp3',
    occurredAt: secondDate
  });

  assert.equal(metrics.total, 2);
  assert.equal(metrics.timedResponseCount, 2);
  assert.equal(metrics.totalGenTime, 4000);
  assert.equal(metrics.avgGenTime, 2000);
  assert.equal(metrics.todayCount, 2);
  assert.equal(metrics.soundsUsed['ding.mp3'], 2);
});

test('completion metrics update a local-day streak', () => {
  const dayOne = new Date(2026, 5, 7, 12, 0, 0);
  const dayTwo = new Date(2026, 5, 8, 12, 0, 0);
  let metrics = Shared.applyCompletionToMetrics({}, { occurredAt: dayOne });
  metrics = Shared.applyCompletionToMetrics(metrics, { occurredAt: dayTwo });

  assert.equal(metrics.todayCount, 1);
  assert.equal(metrics.streak, 2);
  assert.equal(metrics.bestStreak, 2);
});

test('normalizeMetrics hides a stale today count', () => {
  const referenceDate = new Date(2026, 6, 2, 12, 0, 0);
  const metrics = Shared.normalizeMetrics({
    total: 9,
    todayCount: 4,
    lastDate: '2026-06-20',
    streak: 7
  }, referenceDate);

  assert.equal(metrics.total, 9);
  assert.equal(metrics.todayCount, 0);
  assert.equal(metrics.streak, 0);
});

test('normalizeMetrics keeps a streak through the next local day', () => {
  const referenceDate = new Date(2026, 6, 2, 12, 0, 0);
  const metrics = Shared.normalizeMetrics({
    total: 9,
    todayCount: 4,
    lastDate: '2026-07-01',
    streak: 4
  }, referenceDate);

  assert.equal(metrics.todayCount, 0);
  assert.equal(metrics.streak, 4);
});

test('selector validation accepts and versions the live legacy shape', () => {
  const config = Shared.validateSelectorConfig({
    mainButtonSelectors: ['#composer-submit-button'],
    muteToggleSelectors: {
      dictateButton: 'button[aria-label="Start dictation"]',
      flexWrapper: '[class*="items-center"]'
    }
  });

  assert.equal(config.version, 1);
  assert.deepEqual(config.mainButtonSelectors, ['#composer-submit-button']);
});

test('selector validation rejects extra fields and long selectors', () => {
  const valid = {
    version: 1,
    mainButtonSelectors: ['#composer-submit-button'],
    muteToggleSelectors: {
      dictateButton: 'button',
      flexWrapper: 'div'
    }
  };

  assert.equal(Shared.validateSelectorConfig({ ...valid, code: 'alert(1)' }), null);
  assert.equal(Shared.validateSelectorConfig({
    ...valid,
    mainButtonSelectors: ['a'.repeat(257)]
  }), null);
});

test('button state uses stop and send identifiers', () => {
  const button = attributes => ({
    getAttribute(name) {
      return attributes[name] || null;
    }
  });

  assert.equal(Shared.getChatGPTButtonState(button({ 'data-testid': 'stop-button' })).isGenerating, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'data-testid': 'send-button' })).isGenerating, false);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Stop streaming' })).isGenerating, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Send' })).isIdle, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Send feedback' })).isIdle, false);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Start voice mode' })).isVoice, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'data-testid': 'composer-speech-button' })).isVoice, true);
  // German labels captured from a signed-in composer on October 13, 2026.
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Senden' })).isIdle, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Sprachchat starten' })).isVoice, true);
  assert.equal(Shared.getChatGPTButtonState(button({ 'aria-label': 'Stoppen' })).isGenerating, true);
});

test('button state reads the lightweight composer labels in any language', () => {
  const button = attributes => ({
    getAttribute(name) {
      return attributes[name] || null;
    }
  });
  const labels = { 'data-send-label': 'Nachricht senden', 'data-stop-label': 'Generierung stoppen' };
  const sending = Shared.getChatGPTButtonState(button({ ...labels, 'aria-label': 'Nachricht senden' }));
  assert.equal(sending.isIdle, true);
  assert.equal(sending.isGenerating, false);
  assert.equal(sending.method, 'send-label-attribute');
  const stopping = Shared.getChatGPTButtonState(button({ ...labels, 'aria-label': 'Generierung stoppen' }));
  assert.equal(stopping.isGenerating, true);
  assert.equal(stopping.method, 'stop-label-attribute');
  const unknown = Shared.getChatGPTButtonState(button({ ...labels, 'aria-label': 'Wird geladen' }));
  assert.equal(unknown.isIdle, false);
  assert.equal(unknown.isGenerating, false);
  const sameLabels = Shared.getChatGPTButtonState(button({ 'data-send-label': 'x', 'data-stop-label': 'x', 'aria-label': 'x' }));
  assert.equal(sameLabels.method, 'unknown-control');
});
