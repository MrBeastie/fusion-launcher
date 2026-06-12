'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, getUiText, normalizeLocale, type Locale, type UiText } from '@/lib/i18n';

interface I18nContextValue {
  locale: Locale;
  t: UiText;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: getUiText(DEFAULT_LOCALE)
});

export function I18nProvider({
  locale,
  children
}: {
  locale: Locale | string | undefined | null;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const normalizedLocale = normalizeLocale(locale);
    return {
      locale: normalizedLocale,
      t: getUiText(normalizedLocale)
    };
  }, [locale]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
