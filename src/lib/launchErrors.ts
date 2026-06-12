import type { CatalogGame, LaunchFailure } from '@/types/repository';
import { DEFAULT_LOCALE, getUiText, type Locale } from './i18n.ts';

export interface LaunchFailureView {
  title: string;
  message: string;
  actionLabel: string;
  actionKind: 'settings' | 'details' | 'retry-download' | 'close';
}

const FALLBACK_FAILURE: LaunchFailure = {
  kind: 'SpawnFailed',
  assets: [],
  message: getUiText(DEFAULT_LOCALE).launchErrors.fallbackMessage
};

export function normalizeLaunchFailure(error: unknown, game?: CatalogGame): LaunchFailure {
  if (isLaunchFailure(error)) {
    return error;
  }

  if (typeof error === 'string') {
    return {
      ...FALLBACK_FAILURE,
      gameId: game?.id,
      message: error
    };
  }

  if (error instanceof Error) {
    return {
      ...FALLBACK_FAILURE,
      gameId: game?.id,
      message: error.message
    };
  }

  return {
    ...FALLBACK_FAILURE,
    gameId: game?.id
  };
}

export function launchFailureView(failure: LaunchFailure, locale: Locale = DEFAULT_LOCALE): LaunchFailureView {
  const text = getUiText(locale).launchErrors;
  switch (failure.kind) {
    case 'EmulatorNotConfigured':
      return {
        title: text.emulatorNotConfigured.title,
        message: text.emulatorNotConfigured.message,
        actionLabel: text.emulatorNotConfigured.action,
        actionKind: 'settings'
      };
    case 'EmulatorFileMissing':
      return {
        title: text.emulatorFileMissing.title,
        message: text.emulatorFileMissing.message(failure.path),
        actionLabel: text.emulatorFileMissing.action,
        actionKind: 'settings'
      };
    case 'GameFileMissing':
      return {
        title: text.gameFileMissing.title,
        message: failure.message ?? text.gameFileMissing.message,
        actionLabel: text.gameFileMissing.action,
        actionKind: 'retry-download'
      };
    case 'GameFileCorrupt':
      return {
        title: text.gameFileCorrupt.title,
        message: failure.message ?? text.gameFileCorrupt.message,
        actionLabel: text.gameFileCorrupt.action,
        actionKind: 'retry-download'
      };
    case 'SystemFilesMissing':
      return {
        title: text.systemFilesMissing.title,
        message: missingAssetsMessage(text.systemFilesMissing.prefix, text.systemFilesMissing.empty, failure.assets),
        actionLabel: text.systemFilesMissing.action,
        actionKind: 'details'
      };
    case 'SystemFileCorrupt':
      return {
        title: text.systemFileCorrupt.title,
        message: missingAssetsMessage(text.systemFileCorrupt.prefix, text.systemFileCorrupt.empty, failure.assets),
        actionLabel: text.systemFileCorrupt.action,
        actionKind: 'details'
      };
    case 'AlreadyRunning':
      return {
        title: text.alreadyRunning.title,
        message: text.alreadyRunning.message,
        actionLabel: text.alreadyRunning.action,
        actionKind: 'close'
      };
    default:
      return {
        title: text.spawnFailed.title,
        message: failure.message ?? text.spawnFailed.message,
        actionLabel: text.spawnFailed.action,
        actionKind: 'close'
      };
  }
}

function missingAssetsMessage(prefix: string, emptyMessage: string, assets: string[]) {
  if (assets.length === 0) {
    return `${prefix}: ${emptyMessage}`;
  }

  return `${prefix}: ${assets.join(', ')}`;
}

function isLaunchFailure(value: unknown): value is LaunchFailure {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<LaunchFailure>;
  return typeof record.kind === 'string' && Array.isArray(record.assets);
}
