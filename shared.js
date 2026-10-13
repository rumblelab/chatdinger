(function initChatDingerShared(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.ChatDingerShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChatDingerShared() {
  'use strict';

  const SOUND_FILES = Object.freeze([
    Object.freeze({ value: 'soft-tap.wav', label: 'Soft tap' }),
    Object.freeze({ value: 'cryptic.wav', label: 'Bloop' }),
    Object.freeze({ value: 'nylon.mp3', label: 'Nylon' }),
    Object.freeze({ value: 'claude.mp3', label: 'Tone' }),
    Object.freeze({ value: 'coin.mp3', label: 'Coin' }),
    Object.freeze({ value: 'ding.mp3', label: 'Ding' }),
    Object.freeze({ value: 'pew.wav', label: 'Pew' }),
    Object.freeze({ value: 'boop.mp3', label: 'Boop' }),
    Object.freeze({ value: 'twelve.wav', label: 'Meow' }),
    Object.freeze({ value: 'alert.mp3', label: 'Alert' })
  ]);

  const SOUND_VALUES = Object.freeze(SOUND_FILES.map(sound => sound.value));

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    volume: 0.7,
    selectedSound: 'soft-tap.wav',
    notifyOnActiveTab: true,
    showSystemNotification: true,
    markUnreadTab: true
  });

  const MAX_SELECTOR_LENGTH = 256;
  const MAX_MAIN_SELECTORS = 12;
  const SELECTOR_CONFIG_VERSION = 1;

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function finiteNonNegative(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function nonNegativeInteger(value, fallback = 0) {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function clampVolume(value) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULT_SETTINGS.volume;
    }
    return Math.min(1, Math.max(0, number));
  }

  function toDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? new Date() : new Date(value.getTime());
    }

    const date = value === undefined ? new Date() : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function padTwo(value) {
    return String(value).padStart(2, '0');
  }

  function localDayKey(value) {
    const date = toDate(value);
    return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
  }

  function localMonthKey(value) {
    const date = toDate(value);
    return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}`;
  }

  function normalizeSettings(value) {
    const source = isPlainObject(value) ? value : {};
    let enabled = typeof source.enabled === 'boolean'
      ? source.enabled
      : DEFAULT_SETTINGS.enabled;

    if (source.isMuted === true) {
      enabled = false;
    }

    const showSystemNotification = typeof source.showSystemNotification === 'boolean'
      ? source.showSystemNotification
      : typeof source.enableNotifications === 'boolean'
        ? source.enableNotifications
        : DEFAULT_SETTINGS.showSystemNotification;
    const legacySoundMap = Object.freeze(Object.assign(Object.create(null), {
      'cryptic.mp3': 'cryptic.wav',
      'twelve.mp3': 'twelve.wav'
    }));
    const selectedSound = SOUND_VALUES.includes(source.selectedSound)
      ? source.selectedSound
      : legacySoundMap[source.selectedSound] || DEFAULT_SETTINGS.selectedSound;

    return {
      enabled,
      volume: clampVolume(source.volume),
      selectedSound,
      notifyOnActiveTab: typeof source.notifyOnActiveTab === 'boolean'
        ? source.notifyOnActiveTab
        : DEFAULT_SETTINGS.notifyOnActiveTab,
      showSystemNotification,
      markUnreadTab: typeof source.markUnreadTab === 'boolean'
        ? source.markUnreadTab
        : DEFAULT_SETTINGS.markUnreadTab
    };
  }

  function normalizeCountMap(value, allowedKeys = null, maximumKeys = 120) {
    if (!isPlainObject(value)) {
      return {};
    }

    const result = {};
    for (const [key, count] of Object.entries(value)) {
      if (allowedKeys && !allowedKeys.includes(key)) {
        continue;
      }
      if (Number.isSafeInteger(count) && count >= 0) {
        result[key] = count;
        if (Object.keys(result).length >= maximumKeys) {
          break;
        }
      }
    }
    return result;
  }

  function normalizeMonthly(value) {
    if (!isPlainObject(value)) {
      return {};
    }

    const result = {};
    const entries = Object.entries(value)
      .filter(([key]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-120);

    for (const [key, month] of entries) {
      if (!isPlainObject(month)) {
        continue;
      }
      result[key] = {
        count: nonNegativeInteger(month.count),
        totalGenTime: finiteNonNegative(month.totalGenTime)
      };
    }
    return result;
  }

  function normalizeMetrics(value, referenceDate = new Date()) {
    const source = isPlainObject(value) ? value : {};
    const currentDay = localDayKey(referenceDate);
    const lastDate = typeof source.lastDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.lastDate)
      ? source.lastDate
      : null;
    const hasActiveStreak = lastDate === currentDay
      || lastDate === previousLocalDayKey(toDate(referenceDate));
    const total = nonNegativeInteger(source.total);
    const totalGenTime = finiteNonNegative(source.totalGenTime);
    const legacyTimedCount = totalGenTime > 0 ? total : 0;
    const timedResponseCount = Math.min(
      nonNegativeInteger(source.timedResponseCount, legacyTimedCount),
      total
    );
    const timeBuckets = normalizeCountMap(
      source.timeBuckets,
      ['lateNight', 'morning', 'afternoon', 'evening'],
      4
    );

    const soundsUsed = normalizeCountMap(source.soundsUsed, SOUND_VALUES, SOUND_VALUES.length);
    if (isPlainObject(source.soundsUsed)) {
      const legacySounds = {
        'cryptic.mp3': 'cryptic.wav',
        'twelve.mp3': 'twelve.wav'
      };
      for (const [legacySound, currentSound] of Object.entries(legacySounds)) {
        const count = source.soundsUsed[legacySound];
        if (Number.isSafeInteger(count) && count >= 0) {
          soundsUsed[currentSound] = (soundsUsed[currentSound] || 0) + count;
        }
      }
    }

    return {
      total,
      todayCount: lastDate === currentDay ? nonNegativeInteger(source.todayCount) : 0,
      lastDate,
      streak: hasActiveStreak ? nonNegativeInteger(source.streak) : 0,
      bestStreak: nonNegativeInteger(source.bestStreak),
      achievements: Array.isArray(source.achievements)
        ? source.achievements.filter(item => typeof item === 'string').slice(0, 100)
        : [],
      totalGenTime,
      timedResponseCount,
      avgGenTime: timedResponseCount > 0 ? Math.round(totalGenTime / timedResponseCount) : 0,
      longestGenTime: finiteNonNegative(source.longestGenTime),
      shortestGenTime: finiteNonNegative(source.shortestGenTime),
      soundsUsed,
      timeBuckets: {
        lateNight: timeBuckets.lateNight || 0,
        morning: timeBuckets.morning || 0,
        afternoon: timeBuckets.afternoon || 0,
        evening: timeBuckets.evening || 0
      },
      weekdayCount: nonNegativeInteger(source.weekdayCount),
      weekendCount: nonNegativeInteger(source.weekendCount),
      monthly: normalizeMonthly(source.monthly)
    };
  }

  function addAchievement(metrics, label) {
    if (!metrics.achievements.includes(label)) {
      metrics.achievements.push(label);
    }
  }

  function previousLocalDayKey(date) {
    const previous = new Date(date.getTime());
    previous.setHours(12, 0, 0, 0);
    previous.setDate(previous.getDate() - 1);
    return localDayKey(previous);
  }

  function applyCompletionToMetrics(value, completion = {}) {
    const input = isPlainObject(completion) ? completion : {};
    const date = toDate(input.occurredAt);
    const metrics = normalizeMetrics(value, date);
    const day = localDayKey(date);
    const month = localMonthKey(date);
    const soundFile = SOUND_VALUES.includes(input.soundFile) ? input.soundFile : null;
    const duration = Number.isFinite(input.duration) && input.duration >= 0
      ? input.duration
      : null;

    metrics.total += 1;
    if (metrics.lastDate === day) {
      metrics.todayCount += 1;
    } else {
      metrics.todayCount = 1;
      metrics.streak = metrics.lastDate === previousLocalDayKey(date)
        ? Math.max(metrics.streak, 1) + 1
        : 1;
      metrics.lastDate = day;
    }
    metrics.bestStreak = Math.max(metrics.bestStreak, metrics.streak);

    if (duration !== null) {
      metrics.totalGenTime += duration;
      metrics.timedResponseCount += 1;
      metrics.avgGenTime = Math.round(metrics.totalGenTime / metrics.timedResponseCount);
      metrics.longestGenTime = Math.max(metrics.longestGenTime, duration);
      metrics.shortestGenTime = metrics.shortestGenTime > 0
        ? Math.min(metrics.shortestGenTime, duration)
        : duration;
    }

    if (soundFile) {
      metrics.soundsUsed[soundFile] = (metrics.soundsUsed[soundFile] || 0) + 1;
    }

    const hour = date.getHours();
    const bucket = hour < 6
      ? 'lateNight'
      : hour < 12
        ? 'morning'
        : hour < 18
          ? 'afternoon'
          : 'evening';
    metrics.timeBuckets[bucket] += 1;
    if (date.getDay() === 0 || date.getDay() === 6) {
      metrics.weekendCount += 1;
    } else {
      metrics.weekdayCount += 1;
    }

    const monthMetrics = metrics.monthly[month] || { count: 0, totalGenTime: 0 };
    monthMetrics.count += 1;
    if (duration !== null) {
      monthMetrics.totalGenTime += duration;
    }
    metrics.monthly[month] = monthMetrics;

    if (metrics.total === 1) addAchievement(metrics, 'First Ding!');
    if (metrics.total === 7) addAchievement(metrics, 'Deal Maker 🍕 = 5');
    if (metrics.total === 10) addAchievement(metrics, 'Ding Apprentice (10)');
    if (metrics.total === 50) addAchievement(metrics, 'Ding Devotee (50)');
    if (metrics.total === 100) addAchievement(metrics, 'Ding Centurion (100)');
    if (metrics.total === 250) addAchievement(metrics, 'Quarter Grand (250)');
    if (metrics.total === 500) addAchievement(metrics, 'Half-K Hero (500)');
    if (metrics.total === 1000) addAchievement(metrics, 'Kilo-Dinger (1,000)');
    if (metrics.total === 2500) addAchievement(metrics, 'Mega Dinger (2,500)');
    if (metrics.total === 10000) addAchievement(metrics, 'Dingstronaut (10,000)');
    if (metrics.streak === 3) addAchievement(metrics, '3-Day Streak 🔥');
    if (metrics.streak === 7) addAchievement(metrics, '7-Day Streak 🔥🔥');
    if (metrics.streak === 30) addAchievement(metrics, 'Monthly Streak 🔥');
    if (hour < 6) addAchievement(metrics, 'Night Owl 🌙');
    if (metrics.shortestGenTime > 0 && metrics.shortestGenTime <= 1500) {
      addAchievement(metrics, 'Speed Demon ⚡ (<1.5s)');
    }
    if (metrics.longestGenTime >= 120000) {
      addAchievement(metrics, 'Endurance Ding 🕰️ (2+ min)');
    }
    const soundCount = Object.keys(metrics.soundsUsed).length;
    if (soundCount >= 3) addAchievement(metrics, 'Sound Sampler 🎧');
    if (soundCount >= 5) addAchievement(metrics, 'Sound DJ 🎛️');
    if (monthMetrics.count >= 100) addAchievement(metrics, 'Monthly Grinder 💪 (100)');

    return metrics;
  }

  function isSelector(value) {
    return typeof value === 'string'
      && value.length > 0
      && value.length <= MAX_SELECTOR_LENGTH
      && value.trim() === value
      && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validateSelectorConfig(value) {
    if (!isPlainObject(value)) {
      return null;
    }

    const keys = Object.keys(value).sort();
    const expectedKeys = value.version === undefined
      ? ['mainButtonSelectors', 'muteToggleSelectors']
      : ['mainButtonSelectors', 'muteToggleSelectors', 'version'];
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      return null;
    }
    if (value.version !== undefined && value.version !== SELECTOR_CONFIG_VERSION) {
      return null;
    }
    if (!Array.isArray(value.mainButtonSelectors)
      || value.mainButtonSelectors.length < 1
      || value.mainButtonSelectors.length > MAX_MAIN_SELECTORS
      || !value.mainButtonSelectors.every(isSelector)) {
      return null;
    }
    if (!isPlainObject(value.muteToggleSelectors)) {
      return null;
    }

    const muteKeys = Object.keys(value.muteToggleSelectors).sort();
    const expectedMuteKeys = ['dictateButton', 'flexWrapper'];
    if (muteKeys.length !== expectedMuteKeys.length
      || muteKeys.some((key, index) => key !== expectedMuteKeys[index])
      || !expectedMuteKeys.every(key => isSelector(value.muteToggleSelectors[key]))) {
      return null;
    }

    return {
      version: SELECTOR_CONFIG_VERSION,
      mainButtonSelectors: [...new Set(value.mainButtonSelectors)],
      muteToggleSelectors: {
        dictateButton: value.muteToggleSelectors.dictateButton,
        flexWrapper: value.muteToggleSelectors.flexWrapper
      }
    };
  }

  // Exact paths from the ChatGPT primary controls, captured October 1, 2026.
  // Icons identify these controls without a translated label or chat text.
  const PRIMARY_ICON_PATHS = Object.freeze({
    stop: 'M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z',
    send: 'M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z',
    voice: 'M8.22266 2.45825C8.70579 2.45838 9.09766 2.85008 9.09766 3.33325V16.6663C9.09766 17.1494 8.70579 17.5411 8.22266 17.5413C7.73941 17.5413 7.34766 17.1495 7.34766 16.6663V3.33325C7.34766 2.85 7.73941 2.45825 8.22266 2.45825Z'
  });

  function isPrimaryComposerControl(button) {
    return Boolean(button.matches?.('button.bg-composer-primary, button[data-composer-submit], #composer-submit-button, button.composer-submit-button-color')
      && button.closest?.('form, [data-composer-footer-responsive], [data-composer-surface], [data-mobile-composer]'));
  }

  function primaryIcon(button) {
    if (!isPrimaryComposerControl(button)) return null;
    const paths = [...button.querySelectorAll('svg[viewBox="0 0 20 20"] path')]
      .map(path => path.getAttribute('d'));
    return Object.keys(PRIMARY_ICON_PATHS).find(kind => paths.includes(PRIMARY_ICON_PATHS[kind])) || null;
  }

  function iconSpanShown(button, attribute) {
    const span = button.querySelector?.(`[${attribute}]`);
    return Boolean(span && !span.hasAttribute('hidden'));
  }

  function getChatGPTButtonState(button) {
    if (!button || typeof button.getAttribute !== 'function') {
      return { isGenerating: false, isIdle: false, method: 'invalid-element' };
    }

    const testId = String(button.getAttribute('data-testid') || '').toLowerCase();
    const ariaLabel = String(button.getAttribute('aria-label') || '').trim().toLowerCase();
    if (button.getAttribute('data-stop-generating') !== null || testId.endsWith('stop-button') || testId.includes('stop')) {
      return { isGenerating: true, isIdle: false, method: 'stop-control' };
    }
    // The lightweight composer keeps one control for Send and Stop. It names
    // both states in data attributes and swaps icon spans. Neither signal
    // depends on the interface language or on an icon path.
    const sendLabel = String(button.getAttribute('data-send-label') || '').trim().toLowerCase();
    const stopLabel = String(button.getAttribute('data-stop-label') || '').trim().toLowerCase();
    const labelsDiffer = Boolean(sendLabel && stopLabel && sendLabel !== stopLabel);
    if (labelsDiffer && ariaLabel === stopLabel) {
      return { isGenerating: true, isIdle: false, method: 'stop-label-attribute' };
    }
    if (iconSpanShown(button, 'data-composer-stop-icon')) {
      return { isGenerating: true, isIdle: false, method: 'stop-icon-span' };
    }
    const icon = primaryIcon(button);
    if (icon === 'stop') {
      return { isGenerating: true, isIdle: false, method: 'stop-icon' };
    }
    if (/^(stop(?: generating| streaming)?|stoppen|停止(?:生成|產生|产生|回應|回应|回覆|回复)?)$/.test(ariaLabel)) {
      return { isGenerating: true, isIdle: false, method: 'stop-label' };
    }
    const voice = icon === 'voice' || testId.endsWith('speech-button')
      || /^(start voice(?: mode| conversation| chat)?|use voice mode|sprachchat starten|開始語音(?:對話|聊天)|开始语音(?:对话|聊天))$/.test(ariaLabel)
      || button.getAttribute('data-start-voice') !== null;
    if (voice) {
      return { isGenerating: false, isIdle: true, isVoice: true, method: icon === 'voice' ? 'voice-icon' : 'voice-control' };
    }
    if (labelsDiffer && ariaLabel === sendLabel) {
      return { isGenerating: false, isIdle: true, method: 'send-label-attribute' };
    }
    if (iconSpanShown(button, 'data-composer-send-icon')) {
      return { isGenerating: false, isIdle: true, method: 'send-icon-span' };
    }
    if (icon === 'send') {
      return { isGenerating: false, isIdle: true, method: 'send-icon' };
    }
    if (testId.endsWith('send-button')) {
      return { isGenerating: false, isIdle: true, method: 'send-control' };
    }
    // data-composer-submit stays on Send and Stop. It does not identify the state.
    if (/^(send(?: (?:message|prompt))?|senden|傳送(?:訊息|消息|提示)?|發送(?:訊息|消息|提示)?|发送(?:消息|提示)?)$/.test(ariaLabel)) {
      return { isGenerating: false, isIdle: true, method: 'idle-control' };
    }
    // The primary composer control is Send, Voice, or Stop. Every Stop signal
    // was checked above. So a primary control with an icon or label this code
    // does not know is idle, unless it shows a loading state. The Dutch Voice
    // button reached this point on October 13, 2026, and users got no ding
    // until they typed the next prompt. `uncertain` tells the detector that a
    // click or Enter on this control is not a known submission.
    if (isPrimaryComposerControl(button) && !iconSpanShown(button, 'data-composer-loading-icon')
      && button.getAttribute('aria-busy') !== 'true') {
      return { isGenerating: false, isIdle: true, uncertain: true, method: 'primary-fallback' };
    }
    return { isGenerating: false, isIdle: false, method: 'unknown-control' };
  }

  function selectorFingerprint(config) {
    const value = JSON.stringify(config || null);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  return Object.freeze({
    DEFAULT_SETTINGS,
    SOUND_FILES,
    clampVolume,
    localDayKey,
    localMonthKey,
    normalizeSettings,
    normalizeMetrics,
    applyCompletionToMetrics,
    validateSelectorConfig,
    getChatGPTButtonState,
    selectorFingerprint
  });
});
