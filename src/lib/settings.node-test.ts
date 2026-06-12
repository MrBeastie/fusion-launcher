import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSettings } from './settings.ts';

describe('settings normalization', () => {
  it('defaults missing language to English', () => {
    assert.equal(normalizeSettings({ emulators: {}, emulatorConfigs: {} }).language, 'en');
  });

  it('preserves supported language values', () => {
    assert.equal(normalizeSettings({ emulators: {}, emulatorConfigs: {}, language: 'ru' }).language, 'ru');
  });

  it('normalizes unknown language values to English', () => {
    assert.equal(normalizeSettings({
      emulators: {},
      emulatorConfigs: {},
      language: 'fr' as never
    }).language, 'en');
  });
});
