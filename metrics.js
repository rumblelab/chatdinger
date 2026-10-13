(function initMetrics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatDingerMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMetricsAPI() {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  // Display order expresses scale, not the date when a milestone was reached.
  const MILESTONES = Object.freeze([
    { id: 'ding-1', metric: 'dings', goal: 1, stamp: '1', title: 'The first ding.', detail: 'Every collection starts with one.' },
    { id: 'ding-10', metric: 'dings', goal: 10, stamp: '10', title: 'Ten and counting.', detail: '10 completed response alerts.' },
    { id: 'wait-1', metric: 'wait', goal: HOUR, stamp: '1h', title: 'The first hour.', detail: '1 hour of total wait time.' },
    { id: 'ding-100', metric: 'dings', goal: 100, stamp: '100', title: 'Triple digits.', detail: '100 completed response alerts.' },
    { id: 'wait-10', metric: 'wait', goal: 10 * HOUR, stamp: '10h', title: 'Double digits.', detail: '10 hours of total wait time.' },
    { id: 'ding-1000', metric: 'dings', goal: 1000, stamp: '1k', title: 'A thousand dings.', detail: '1,000 completed response alerts.' },
    { id: 'wait-24', metric: 'wait', goal: 24 * HOUR, stamp: '24h', title: 'One whole day.', detail: '24 hours of total wait time.' },
    { id: 'wait-100', metric: 'wait', goal: 100 * HOUR, stamp: '100h', title: 'A hundred hours.', detail: '100 hours of total wait time.' },
    { id: 'ding-10000', metric: 'dings', goal: 10000, stamp: '10k', title: 'Five figures.', detail: '10,000 completed response alerts.' },
    { id: 'wait-168', metric: 'wait', goal: 168 * HOUR, stamp: '7d', title: 'One whole week.', detail: '7 days of total wait time.' }
  ].map(Object.freeze));

  function formatWaitTime(milliseconds) {
    const seconds = Math.floor(Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : 0);
    if (seconds < 60) return [{ value: seconds, unit: 's' }];
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return [{ value: minutes, unit: 'm' }, { value: seconds % 60, unit: 's' }];
    const hours = Math.floor(minutes / 60);
    if (hours < 1000) return [{ value: hours, unit: 'h' }, { value: minutes % 60, unit: 'm' }];
    return [{ value: Math.floor(hours / 24), unit: 'd' }, { value: hours % 24, unit: 'h' }];
  }

  function summary(metrics, legacyCount = 0) {
    const validCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const dings = validCount(metrics?.total) || validCount(legacyCount);
    const wait = Number.isFinite(metrics?.totalGenTime) && metrics.totalGenTime > 0 ? metrics.totalGenTime : 0;
    const time = formatWaitTime(wait);
    const milestones = MILESTONES.map(item => ({ ...item, reached: (item.metric === 'dings' ? dings : wait) >= item.goal }));
    const reached = milestones.filter(item => item.reached);
    return { dings, wait, time, timeText: time.map(part => `${part.value.toLocaleString('en-US')}${part.unit}`).join(' '),
      milestones, reached: reached.length, featured: reached.at(-1) || null };
  }

  return Object.freeze({ MILESTONES, formatWaitTime, summary });
});
