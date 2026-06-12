import type { RepositoryPreview, RepositorySummary, RepositoryTrustLevel } from '@/types/repository';
import { DEFAULT_LOCALE, getUiText, type Locale } from './i18n.ts';

type SourceTrustTarget = Pick<RepositoryPreview, 'name' | 'url' | 'catalogCount' | 'systemFileCount'>;

export function sourceTrustLabel(trustLevel: RepositoryTrustLevel | string, locale: Locale = DEFAULT_LOCALE) {
  const text = getUiText(locale).sourceTrust;
  if (trustLevel === 'official') return text.official;
  if (trustLevel === 'community') return text.community;
  return text.unknown;
}

export function unknownSourcePrompt(source: SourceTrustTarget | RepositorySummary, locale: Locale = DEFAULT_LOCALE) {
  return getUiText(locale).sourceTrust.unknownPrompt(
    source.name,
    source.url,
    source.catalogCount,
    source.systemFileCount
  );
}
