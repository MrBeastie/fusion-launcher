import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { en, getUiText, normalizeLocale, ru } from './i18n.ts';
import { launchFailureView } from './launchErrors.ts';
import { sourceTrustLabel, unknownSourcePrompt } from './sourceTrust.ts';

describe('i18n dictionaries', () => {
  it('normalizes invalid locales to English', () => {
    assert.equal(normalizeLocale('ru'), 'ru');
    assert.equal(normalizeLocale('fr'), 'en');
    assert.equal(normalizeLocale(undefined), 'en');
  });

  it('keeps English and Russian dictionary keys aligned', () => {
    assert.deepEqual(flattenKeys(ru), flattenKeys(en));
  });

  it('renders key status and action labels in both languages', () => {
    assert.equal(getUiText('en').statusLabels['Ready to Play'], 'Ready to play');
    assert.equal(getUiText('ru').statusLabels['Ready to Play'], 'Готово к запуску');
    assert.equal(getUiText('en').actions.Install, 'Install');
    assert.equal(getUiText('ru').actions.Install, 'Установить');
  });

  it('renders settings chrome in the selected language', () => {
    assert.equal(getUiText('en').settings.sections.metadata, 'Metadata');
    assert.equal(getUiText('en').settings.messages.saveSuccess, 'Settings saved. Emulator readiness has been updated.');
    assert.equal(getUiText('ru').settings.sections.metadata, 'Метаданные');
    assert.equal(getUiText('ru').settings.messages.saveSuccess, 'Настройки сохранены. Готовность эмуляторов обновлена.');
  });

  it('renders source trust prompts in both languages', () => {
    assert.equal(sourceTrustLabel('official', 'en'), 'Official source');
    assert.equal(sourceTrustLabel('official', 'ru'), 'Официальный источник');
    assert.match(unknownSourcePrompt(sourceFixture, 'en'), /Connect user source/);
    assert.match(unknownSourcePrompt(sourceFixture, 'ru'), /Подключить пользовательский источник/);
  });

  it('renders launch error views in both languages', () => {
    const failure = {
      kind: 'EmulatorNotConfigured',
      assets: []
    } as const;

    assert.equal(launchFailureView(failure, 'en').title, 'Emulator is not configured');
    assert.equal(launchFailureView(failure, 'ru').title, 'Эмулятор не настроен');
  });
});

const sourceFixture = {
  name: 'Community Repo',
  url: 'https://example.com/repo.json',
  catalogCount: 2,
  systemFileCount: 1
};

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'function') return [nextPrefix];
    if (child && typeof child === 'object') return flattenKeys(child, nextPrefix);
    return [nextPrefix];
  }).sort();
}
