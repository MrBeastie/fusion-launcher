'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Activity,
  Ban,
  Clipboard,
  DatabaseZap,
  Download,
  FolderOpen,
  Gamepad2,
  HardDrive,
  HeartPulse,
  Link2,
  Loader2,
  RefreshCcw,
  Save,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';
import { displayProductText } from '@/lib/brandText';
import { isTauriRuntime } from '@/lib/runtime';
import { getEmulatorPath, type AppSettings } from '@/lib/settings';
import { LOCALES, updateErrorText, type Locale, type UiText } from '@/lib/i18n';
import {
  countConfiguredEmulators,
  getEmulatorDraftState,
  hasEmulatorDraftChanges,
  updateDraftEmulatorPath,
  type EmulatorDraftTone
} from '@/lib/settingsModalState';
import { sourceTrustLabel } from '@/lib/sourceTrust';
import { MVP_PLATFORMS, PLATFORM_EMULATOR_HINTS, PLATFORM_LABELS, type MvpPlatform } from '@/types/platform';
import type {
  HealthCheckItem,
  HealthReport,
  LibraryScrapeProgressEvent,
  PlatformSetupProfile,
  RepositoryPreview,
  RepositorySummary,
  ScreenScraperStatus,
  SteamGridDbStatus,
  TorrentDownloadRecord,
  UpdateCheckError,
  UpdateCheckReport
} from '@/types/repository';

type BusyAction = string | null;
type UpdatePanelPhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';

interface UpdatePanelState {
  phase: UpdatePanelPhase;
  report: UpdateCheckReport | null;
  error: UpdateCheckError | null;
}

interface SettingsModalProps {
  settings: AppSettings;
  repositories: RepositorySummary[];
  downloads: TorrentDownloadRecord[];
  busyAction: BusyAction;
  healthReport: HealthReport | null;
  updatePanel: UpdatePanelState;
  sourceUrl: string;
  sourcePreview: RepositoryPreview | null;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<AppSettings>;
  onSourceUrlChange: (value: string) => void;
  onPreviewRepositoryUrl: () => Promise<void>;
  onConnectRepositoryUrl: () => Promise<void>;
  onConnectRepositoryFile: () => Promise<void>;
  onDisconnect: (repositoryId: string) => Promise<void>;
  onRefreshRepository: (repositoryId: string) => Promise<void>;
  onRunHealth: () => Promise<void>;
  onCopyDiagnostics: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
  onCheckAppUpdate: () => Promise<void>;
  onInstallAppUpdate: () => Promise<void>;
}

type BusyState = `browse:${MvpPlatform}` | 'save' | null;
type SettingsSection = 'general' | 'emulators' | 'metadata' | 'sources' | 'storage' | 'diagnostics' | 'updates';

const SECTIONS: Array<{ id: SettingsSection; icon: typeof Settings }> = [
  { id: 'general', icon: SlidersHorizontal },
  { id: 'emulators', icon: Gamepad2 },
  { id: 'metadata', icon: DatabaseZap },
  { id: 'sources', icon: Link2 },
  { id: 'storage', icon: HardDrive },
  { id: 'diagnostics', icon: Activity },
  { id: 'updates', icon: RefreshCcw }
];

const PUBLIC_SOURCE_TEMPLATE_URL = 'https://mrbeastie.github.io/RetroHydra/source-library-template/repository.json';

export function SettingsModal({
  settings,
  repositories,
  downloads,
  busyAction,
  healthReport,
  updatePanel,
  sourceUrl,
  sourcePreview,
  onClose,
  onSave,
  onSourceUrlChange,
  onPreviewRepositoryUrl,
  onConnectRepositoryUrl,
  onConnectRepositoryFile,
  onDisconnect,
  onRefreshRepository,
  onRunHealth,
  onCopyDiagnostics,
  onOpenLogs,
  onCheckAppUpdate,
  onInstallAppUpdate
}: SettingsModalProps) {
  const { locale, t } = useI18n();
  const [savedSettings, setSavedSettings] = useState<AppSettings>(settings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);
  const [activeSection, setActiveSection] = useState<SettingsSection>('emulators');
  const [activePlatform, setActivePlatform] = useState<MvpPlatform>(MVP_PLATFORMS[0]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloadRoot, setDownloadRoot] = useState('');
  const [savedDownloadRoot, setSavedDownloadRoot] = useState('');
  const [profiles, setProfiles] = useState<PlatformSetupProfile[]>([]);
  const [appDataDir, setAppDataDir] = useState('');
  const [logPath, setLogPath] = useState('');
  const [scraperStatus, setScraperStatus] = useState<ScreenScraperStatus | null>(null);
  const [scraperSsid, setScraperSsid] = useState('');
  const [scraperPassword, setScraperPassword] = useState('');
  const [scraperRegion, setScraperRegion] = useState('auto');
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [steamgriddbStatus, setSteamgriddbStatus] = useState<SteamGridDbStatus | null>(null);
  const [steamgriddbKey, setSteamgriddbKey] = useState('');
  const [steamgriddbBusy, setSteamgriddbBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<LibraryScrapeProgressEvent | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSavedSettings(settings);
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getDownloadRoot(),
      api.listPlatformSetupProfiles(),
      api.getDiagnosticsPaths(),
      api.getScreenscraperStatus(),
      api.getSteamgriddbStatus()
    ])
      .then(([downloadFolder, setupProfiles, diagnostics, metadataStatus, steamMetadataStatus]) => {
        if (cancelled) return;
        setDownloadRoot(downloadFolder);
        setSavedDownloadRoot(downloadFolder);
        setProfiles(setupProfiles);
        setAppDataDir(diagnostics.dataDir);
        setLogPath(diagnostics.logPath);
        setScraperStatus(metadataStatus);
        setScraperSsid(metadataStatus.ssid ?? '');
        setScraperRegion(metadataStatus.region ?? 'auto');
        setSteamgriddbStatus(steamMetadataStatus);
      })
      .catch((error) => {
        if (!cancelled) setMessage(t.settings.messages.loadDetailsError(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let cleanup: (() => void) | null = null;
    const unlistenPromise = listen<LibraryScrapeProgressEvent>('scrape:batch', (event) => {
      const progress = event.payload;
      setBatchProgress(progress);
      setSteamgriddbStatus((current) => current
        ? {
            ...current,
            pendingBatch: Math.max(progress.total - progress.done, 0),
            batchRunning: progress.done < progress.total
          }
        : current);
    });
    void unlistenPromise.then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      if (cleanup) cleanup();
      else void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const configuredCount = countConfiguredEmulators(draftSettings);
  const readyCount = useMemo(() => (
    MVP_PLATFORMS.filter((platform) => (
      getEmulatorDraftState(draftSettings, savedSettings, platform, locale).tone === 'valid'
    )).length
  ), [draftSettings, locale, savedSettings]);
  const changedEmulators = hasEmulatorDraftChanges(draftSettings, savedSettings);
  const changedStorage = downloadRoot.trim() !== savedDownloadRoot.trim();
  const changedLanguage = draftSettings.language !== savedSettings.language;
  const hasUnsavedChanges = changedEmulators || changedStorage || changedLanguage;
  const activeDownloadsCount = downloads.filter((download) => (
    download.status === 'resolving' || download.status === 'downloading' || download.status === 'cancelling'
  )).length;

  const updateEmulatorPath = (platform: MvpPlatform, emulatorPath: string) => {
    setDraftSettings((currentSettings) => updateDraftEmulatorPath(currentSettings, platform, emulatorPath));
    setActivePlatform(platform);
    setMessage(null);
  };

  const browseForEmulator = async (platform: MvpPlatform) => {
    setBusy(`browse:${platform}`);
    setActivePlatform(platform);
    setMessage(null);
    try {
      if (!isTauriRuntime()) {
        setMessage(t.settings.messages.nativeFilePickerUnavailable);
        return;
      }

      const currentPath = getEmulatorPath(draftSettings, platform);
      const selected = await open({
        title: t.settings.emulators.pickerTitle(PLATFORM_LABELS[platform]),
        multiple: false,
        directory: false,
        defaultPath: currentPath || undefined,
        filters: [
          {
            name: t.settings.emulators.windowsExecutable,
            extensions: ['exe']
          }
        ]
      });

      if (typeof selected === 'string') {
        updateEmulatorPath(platform, selected);
      }
    } catch (error) {
      setMessage(t.settings.messages.browseError(error));
    } finally {
      setBusy(null);
    }
  };

  const saveMetadataSettings = async () => {
    setMetadataBusy(true);
    setMessage(null);
    try {
      const nextStatus = await api.saveScreenscraperCredentials(scraperSsid, scraperPassword, scraperRegion);
      setScraperStatus(nextStatus);
      setScraperSsid(nextStatus.ssid ?? scraperSsid.trim());
      setScraperRegion(nextStatus.region ?? 'auto');
      setScraperPassword('');
      setMessage('ScreenScraper metadata settings saved.');
    } catch (error) {
      setMessage(`Failed to save ScreenScraper settings: ${error}`);
    } finally {
      setMetadataBusy(false);
    }
  };

  const saveSteamgriddbSettings = async () => {
    setSteamgriddbBusy(true);
    setMessage(null);
    try {
      const nextStatus = await api.saveSteamgriddbKey(steamgriddbKey);
      setSteamgriddbStatus(nextStatus);
      setSteamgriddbKey('');
      setMessage('SteamGridDB artwork settings saved.');
    } catch (error) {
      setMessage(`Failed to save SteamGridDB settings: ${error}`);
    } finally {
      setSteamgriddbBusy(false);
    }
  };

  const startLibraryScrape = async () => {
    setBatchBusy(true);
    setMessage(null);
    setBatchProgress(null);
    try {
      const status = await api.scrapeLibrary();
      const nextStatus = await api.getSteamgriddbStatus();
      setSteamgriddbStatus({
        ...nextStatus,
        pendingBatch: status.pending,
        batchRunning: status.running
      });
      setMessage(status.pending > 0 ? 'Library metadata scrape started.' : 'No installed games are queued for metadata scraping.');
    } catch (error) {
      setMessage(`Failed to start library scrape: ${error}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const cancelLibraryScrape = async () => {
    setBatchBusy(true);
    setMessage(null);
    try {
      const status = await api.cancelLibraryScrape();
      setSteamgriddbStatus((current) => current
        ? { ...current, pendingBatch: status.pending, batchRunning: status.running }
        : current);
      setMessage('Library metadata scrape cancellation requested.');
    } catch (error) {
      setMessage(`Failed to cancel library scrape: ${error}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasUnsavedChanges) return;

    setBusy('save');
    setMessage(null);
    try {
      const nextSavedSettings = await onSave(draftSettings);
      if (downloadRoot.trim() && changedStorage) {
        const nextDownloadRoot = await api.setDownloadRoot(downloadRoot.trim());
        setDownloadRoot(nextDownloadRoot);
        setSavedDownloadRoot(nextDownloadRoot);
      }
      setSavedSettings(nextSavedSettings);
      setDraftSettings(nextSavedSettings);
      setMessage(t.settings.messages.saveSuccess);
    } catch (error) {
      setMessage(t.settings.messages.saveError(error));
    } finally {
      setBusy(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(modalRef.current);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/82 px-5 py-5"
      onKeyDown={handleKeyDown}
      data-testid="settings-modal"
    >
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="flex h-[min(760px,calc(100vh-40px))] w-[min(1080px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-white/10 bg-fusion-surface/95 text-white shadow-[0_40px_120px_rgba(0,0,0,0.72)] outline-none"
      >
        <aside className="hidden w-60 shrink-0 border-r border-white/10 bg-white/[0.035] p-5 md:flex md:flex-col">
          <div>
            <h2 id="settings-modal-title" className="text-2xl font-bold tracking-normal">{t.settings.title}</h2>
            <p className="mt-2 text-xs leading-5 text-white/[0.46]">{t.settings.description}</p>
          </div>

          <nav className="mt-8 grid gap-2">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid={`settings-tab-${section.id}`}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex h-11 items-center gap-3 rounded-lg border px-3 text-left text-sm font-semibold transition ${
                    active
                      ? 'border-hydra-accent/40 bg-hydra-accent/15 text-hydra-accent shadow-glow'
                      : 'border-transparent text-white/[0.48] hover:border-white/[0.14] hover:bg-white/[0.045] hover:text-white/[0.82]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t.settings.sections[section.id]}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-white/10 pt-5">
            <div className="text-xs font-semibold text-white/[0.42]">{t.settings.readiness.title}</div>
            <div className="mt-3 grid gap-2 text-xs text-white/[0.54]">
              <MetricLine label={t.settings.readiness.configured} value={`${configuredCount}/${MVP_PLATFORMS.length}`} />
              <MetricLine label={t.settings.readiness.ready} value={`${readyCount}/${MVP_PLATFORMS.length}`} />
              <MetricLine label={t.settings.readiness.sources} value={String(repositories.length)} />
              <MetricLine label={t.settings.readiness.unsaved} value={hasUnsavedChanges ? t.common.yes : t.common.no} />
            </div>
          </div>
        </aside>

        <form onSubmit={save} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-20 items-start justify-between gap-4 border-b border-white/10 px-5 py-5 md:px-7">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold tracking-normal md:hidden">{t.settings.title}</h2>
                <h3 className="text-xl font-bold tracking-normal md:text-2xl">{sectionTitle(activeSection, t)}</h3>
                {hasUnsavedChanges && (
                  <span className="rounded-lg border border-white/[0.18] bg-white/[0.07] px-2 py-1 text-xs font-semibold text-white/[0.78]">
                    {t.settings.unsavedBadge}
                  </span>
                )}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.035] text-white/[0.62] transition hover:border-hydra-accent/40 hover:bg-hydra-accent/10 hover:text-white focus:border-hydra-accent/70 focus:outline-none"
              title={t.settings.closeTitle}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex border-b border-white/10 md:hidden">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                data-testid={`settings-mobile-tab-${section.id}`}
                onClick={() => setActiveSection(section.id)}
                className={`min-w-0 flex-1 px-2 py-3 text-xs font-semibold transition ${
                  activeSection === section.id ? 'bg-hydra-accent/14 text-hydra-accent' : 'text-white/[0.46]'
                }`}
              >
                {t.settings.sections[section.id]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-5 [scrollbar-gutter:stable] md:px-7" data-testid={`settings-modal-${activeSection}`}>
            {activeSection === 'general' && (
              <GeneralSection
                configuredCount={configuredCount}
                readyCount={readyCount}
                repositoriesCount={repositories.length}
                activeDownloadsCount={activeDownloadsCount}
                updatePhase={updatePanel.phase}
                healthReport={healthReport}
                hasUnsavedChanges={hasUnsavedChanges}
                desktopBridge={isTauriRuntime()}
                draftLanguage={draftSettings.language}
                onLanguageChange={(language) => {
                  setDraftSettings((currentSettings) => ({ ...currentSettings, language }));
                  setMessage(null);
                }}
                onOpenSection={setActiveSection}
              />
            )}

            {activeSection === 'emulators' && (
              <EmulatorsSection
                draftSettings={draftSettings}
                savedSettings={savedSettings}
                activePlatform={activePlatform}
                busy={busy}
                locale={locale}
                onFocusPlatform={setActivePlatform}
                onPathChange={updateEmulatorPath}
                onBrowse={browseForEmulator}
              />
            )}

            {activeSection === 'metadata' && (
              <MetadataSection
                status={scraperStatus}
                ssid={scraperSsid}
                password={scraperPassword}
                region={scraperRegion}
                busy={metadataBusy}
                steamStatus={steamgriddbStatus}
                steamKey={steamgriddbKey}
                steamBusy={steamgriddbBusy}
                batchBusy={batchBusy}
                batchProgress={batchProgress}
                onSsidChange={setScraperSsid}
                onPasswordChange={setScraperPassword}
                onRegionChange={setScraperRegion}
                onSave={saveMetadataSettings}
                onSteamKeyChange={setSteamgriddbKey}
                onSaveSteam={saveSteamgriddbSettings}
                onScrapeLibrary={startLibraryScrape}
                onCancelLibraryScrape={cancelLibraryScrape}
              />
            )}

            {activeSection === 'sources' && (
              <SourcesSection
                repositories={repositories}
                busyAction={busyAction}
                sourceUrl={sourceUrl}
                sourcePreview={sourcePreview}
                onSourceUrlChange={onSourceUrlChange}
                onPreviewRepositoryUrl={onPreviewRepositoryUrl}
                onConnectRepositoryUrl={onConnectRepositoryUrl}
                onConnectRepositoryFile={onConnectRepositoryFile}
                onRefreshRepository={onRefreshRepository}
                onDisconnect={onDisconnect}
              />
            )}

            {activeSection === 'storage' && (
              <StorageSection
                downloadRoot={downloadRoot}
                appDataDir={appDataDir}
                logPath={logPath}
                changed={changedStorage}
                onDownloadRootChange={(value) => {
                  setDownloadRoot(value);
                  setMessage(null);
                }}
              />
            )}

            {activeSection === 'diagnostics' && (
              <DiagnosticsSection
                profiles={profiles}
                health={healthReport}
                busyAction={busyAction}
                onRunHealth={onRunHealth}
                onCopyDiagnostics={onCopyDiagnostics}
                onOpenLogs={onOpenLogs}
              />
            )}

            {activeSection === 'updates' && (
              <UpdatesSection
                state={updatePanel}
                onCheck={onCheckAppUpdate}
                onInstall={onInstallAppUpdate}
              />
            )}
          </div>

          {message && (
            <div className="mx-5 mb-4 rounded-sm border border-white/[0.12] bg-white/[0.055] px-3 py-2 text-sm text-white/70 md:mx-7">
              {message}
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 md:px-7">
            <div className="text-xs text-white/[0.38]">
              {hasUnsavedChanges ? t.settings.footerDirty : t.settings.footerClean}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy !== null}
                className="h-10 rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/[0.66] transition hover:border-white/[0.36] hover:bg-white/[0.065] hover:text-white disabled:opacity-40"
              >
                {t.common.close}
              </button>
              <button
                type="submit"
                disabled={busy !== null || !hasUnsavedChanges}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-hydra-accent/70 bg-hydra-accent px-4 text-sm font-bold text-fusion-accentOn transition hover:bg-fusion-accentHover disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-white/[0.32]"
              >
                {busy === 'save' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t.common.save}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function GeneralSection({
  configuredCount,
  readyCount,
  repositoriesCount,
  activeDownloadsCount,
  updatePhase,
  healthReport,
  hasUnsavedChanges,
  desktopBridge,
  draftLanguage,
  onLanguageChange,
  onOpenSection
}: {
  configuredCount: number;
  readyCount: number;
  repositoriesCount: number;
  activeDownloadsCount: number;
  updatePhase: UpdatePanelPhase;
  healthReport: HealthReport | null;
  hasUnsavedChanges: boolean;
  desktopBridge: boolean;
  draftLanguage: Locale;
  onLanguageChange: (language: Locale) => void;
  onOpenSection: (section: SettingsSection) => void;
}) {
  const { t } = useI18n();
  const healthReady = healthReport
    ? [
        ...healthReport.emulators,
        ...healthReport.platformSetup,
        ...healthReport.systemFiles,
        ...healthReport.gameFiles,
        ...healthReport.repositories,
        healthReport.downloader
      ].filter((item) => item.status === 'ready').length
    : 0;
  const healthTotal = healthReport
    ? healthReport.emulators.length
      + healthReport.platformSetup.length
      + healthReport.systemFiles.length
      + healthReport.gameFiles.length
      + healthReport.repositories.length
      + 1
    : 0;

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label={t.settings.general.configured} value={`${configuredCount}/${MVP_PLATFORMS.length}`} />
        <SummaryCard label={t.settings.general.sources} value={String(repositoriesCount)} />
        <SummaryCard label={t.settings.general.downloads} value={String(activeDownloadsCount)} />
        <SummaryCard label={t.settings.general.ready} value={`${readyCount}/${MVP_PLATFORMS.length}`} />
        <SummaryCard label={t.settings.general.health} value={healthTotal > 0 ? `${healthReady}/${healthTotal}` : t.common.notRun} />
        <SummaryCard label={t.settings.general.update} value={updatePhaseLabel(updatePhase, t)} />
      </div>
      <label className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-white/90">{t.language.label}</div>
            <p className="mt-1 text-xs leading-5 text-white/[0.46]">{t.language.description}</p>
          </div>
          <select
            value={draftLanguage}
            onChange={(event) => onLanguageChange(event.target.value as Locale)}
            className="h-10 rounded-sm border border-white/10 bg-black/40 px-3 text-sm font-semibold text-white/80 outline-none transition focus:border-white/60"
            data-testid="settings-language"
          >
            {LOCALES.map((language) => (
              <option key={language} value={language}>{t.language.options[language]}</option>
            ))}
          </select>
        </div>
      </label>
      <div className="rounded-sm border border-white/10 bg-black/[0.38] p-5">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-white/10 bg-white/[0.055]">
            <Settings className="h-5 w-5 text-white/[0.78]" />
          </div>
          <div className="min-w-0">
            <h4 className="text-lg font-black">{t.settings.general.launcherSetup}</h4>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
              {t.settings.general.copy}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <SectionJumpButton label={t.settings.sections.emulators} onClick={() => onOpenSection('emulators')} />
              <SectionJumpButton label={t.settings.sections.sources} onClick={() => onOpenSection('sources')} />
              <SectionJumpButton label={t.settings.sections.diagnostics} onClick={() => onOpenSection('diagnostics')} />
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-sm border border-white/10 bg-white/[0.025] p-4 text-sm text-white/50">
        {hasUnsavedChanges
          ? t.settings.general.dirty
          : t.settings.general.synced(desktopBridge ? 'desktop bridge' : 'preview')}
      </div>
    </section>
  );
}

function SectionJumpButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 rounded-lg border border-white/[0.28] px-4 text-sm font-semibold text-white/[0.82] transition hover:border-hydra-accent/50 hover:bg-hydra-accent/10"
    >
      {label}
    </button>
  );
}

function EmulatorsSection({
  draftSettings,
  savedSettings,
  activePlatform,
  busy,
  locale,
  onFocusPlatform,
  onPathChange,
  onBrowse
}: {
  draftSettings: AppSettings;
  savedSettings: AppSettings;
  activePlatform: MvpPlatform;
  busy: BusyState;
  locale: Locale;
  onFocusPlatform: (platform: MvpPlatform) => void;
  onPathChange: (platform: MvpPlatform, path: string) => void;
  onBrowse: (platform: MvpPlatform) => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-hydra-accent">{t.settings.emulators.title}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
            {t.settings.emulators.copy}
          </p>
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-white/[0.54]">
          {t.settings.emulators.active(PLATFORM_LABELS[activePlatform])}
        </div>
      </div>

      <div className="grid gap-3">
        {MVP_PLATFORMS.map((platform) => {
          const emulatorPath = getEmulatorPath(draftSettings, platform);
          const state = getEmulatorDraftState(draftSettings, savedSettings, platform, locale);
          const active = activePlatform === platform;
          const browsing = busy === `browse:${platform}`;

          return (
            <article
              key={platform}
              data-testid={`emulator-row-${platform}`}
              onFocusCapture={() => onFocusPlatform(platform)}
              className={`rounded-sm border p-4 transition ${
                active
                  ? 'border-hydra-accent/45 bg-hydra-accent/[0.07] shadow-[0_0_0_1px_rgba(92,230,140,0.18),0_20px_60px_rgba(0,0,0,0.48)]'
                  : 'border-white/10 bg-black/[0.34] hover:border-white/[0.24] hover:bg-white/[0.045]'
              }`}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(150px,220px)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white/90">{PLATFORM_LABELS[platform]}</span>
                    <StatusChip tone={state.tone} label={state.label} />
                  </div>
                  <div className="mt-2 text-xs text-white/[0.38]">{t.settings.emulators.expectedFile(PLATFORM_EMULATOR_HINTS[platform])}</div>
                  <div className="mt-3 text-xs leading-5 text-white/[0.44]">{state.detail}</div>
                </div>

                <label className="min-w-0">
                  <span className="sr-only">{t.settings.emulators.pathSr(PLATFORM_LABELS[platform])}</span>
                  <div className="flex min-w-0 gap-2">
                    <input
                      value={emulatorPath}
                      onChange={(event) => onPathChange(platform, event.target.value)}
                      onFocus={() => onFocusPlatform(platform)}
                      className="h-11 min-w-0 flex-1 rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
                      placeholder={t.settings.emulators.pathPlaceholder}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => onBrowse(platform)}
                      disabled={busy !== null}
                      aria-label={t.settings.emulators.chooseExecutable(PLATFORM_LABELS[platform])}
                      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-sm border border-white/[0.12] bg-white/[0.045] px-3 text-sm font-bold text-white/70 transition hover:border-white/[0.44] hover:bg-white/[0.08] hover:text-white disabled:opacity-40 sm:px-4"
                    >
                      {browsing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">{t.common.browse}</span>
                    </button>
                  </div>
                </label>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MetadataSection({
  status,
  ssid,
  password,
  region,
  busy,
  steamStatus,
  steamKey,
  steamBusy,
  batchBusy,
  batchProgress,
  onSsidChange,
  onPasswordChange,
  onRegionChange,
  onSave,
  onSteamKeyChange,
  onSaveSteam,
  onScrapeLibrary,
  onCancelLibraryScrape
}: {
  status: ScreenScraperStatus | null;
  ssid: string;
  password: string;
  region: string;
  busy: boolean;
  steamStatus: SteamGridDbStatus | null;
  steamKey: string;
  steamBusy: boolean;
  batchBusy: boolean;
  batchProgress: LibraryScrapeProgressEvent | null;
  onSsidChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRegionChange: (value: string) => void;
  onSave: () => Promise<void>;
  onSteamKeyChange: (value: string) => void;
  onSaveSteam: () => Promise<void>;
  onScrapeLibrary: () => Promise<void>;
  onCancelLibraryScrape: () => Promise<void>;
}) {
  const running = steamStatus?.batchRunning ?? false;
  const progressPercent = batchProgress && batchProgress.total > 0
    ? Math.min(100, Math.round((batchProgress.done / batchProgress.total) * 100))
    : 0;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-hydra-accent">ScreenScraper metadata</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
            Store your ScreenScraper account locally to fill missing game metadata and covers after imports.
          </p>
        </div>
        <span className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
          status?.configured ? 'border-emerald-200/[0.24] bg-emerald-200/10 text-emerald-100' : 'border-amber-200/[0.24] bg-amber-200/10 text-amber-100'
        }`}>
          {status?.configured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
          <span className="text-sm font-black text-white/90">ScreenScraper SSID</span>
          <input
            value={ssid}
            onChange={(event) => onSsidChange(event.target.value)}
            className="mt-3 h-11 w-full rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
            placeholder="username"
            autoComplete="username"
            spellCheck={false}
          />
        </label>

        <label className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
          <span className="text-sm font-black text-white/90">Password</span>
          <input
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            className="mt-3 h-11 w-full rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
            placeholder={status?.configured ? 'Leave blank to keep saved password' : 'password'}
            type="password"
            autoComplete="current-password"
          />
        </label>

        <label className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
          <span className="text-sm font-black text-white/90">Cover region</span>
          <select
            value={region}
            onChange={(event) => onRegionChange(event.target.value)}
            className="mt-3 h-11 w-full rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition focus:border-white/60"
          >
            <option value="auto">Auto</option>
            <option value="eu">Europe</option>
            <option value="us">United States</option>
            <option value="jp">Japan</option>
          </select>
        </label>

        <div className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
          <div className="text-sm font-black text-white/90">Daily request budget</div>
          <div className="mt-3 text-2xl font-black text-white">
            {status ? `${status.dailyRequests}/${status.dailyLimit}` : '...'}
          </div>
          <div className="mt-2 text-xs text-white/[0.42]">Tracked locally per calendar day.</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || !ssid.trim()}
          className="rh-mini-action"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
          Save metadata settings
        </button>
      </div>

      <div className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-hydra-accent">SteamGridDB artwork</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
              Adds hero, logo, and grid artwork after ScreenScraper metadata without proxying requests.
            </p>
          </div>
          <span className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
            steamStatus?.configured ? 'border-emerald-200/[0.24] bg-emerald-200/10 text-emerald-100' : 'border-amber-200/[0.24] bg-amber-200/10 text-amber-100'
          }`}>
            {steamStatus?.keySource === 'built-in' ? 'Built-in key' : steamStatus?.keySource === 'user' ? 'User key' : 'No key'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="min-w-0">
            <span className="text-sm font-black text-white/90">SteamGridDB API key</span>
            <input
              value={steamKey}
              onChange={(event) => onSteamKeyChange(event.target.value)}
              className="mt-3 h-11 w-full rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
              placeholder="Leave blank to use the built-in key"
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="rounded-sm border border-white/10 bg-white/[0.035] p-3">
            <div className="text-[10px] font-semibold text-white/[0.32]">SGDB daily requests</div>
            <div className="mt-2 text-xl font-black text-white">
              {steamStatus ? `${steamStatus.dailyRequests}/${steamStatus.dailyLimit}` : '...'}
            </div>
            <div className="mt-1 text-xs text-white/[0.38]">{steamStatus?.pendingBatch ?? 0} queued</div>
          </div>
        </div>

        {(batchProgress || running) && (
          <div className="mt-4 rounded-sm border border-white/10 bg-black/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/[0.54]">
              <span>{batchProgress?.currentGameId ?? (running ? 'Scraping library' : 'Batch scrape')}</span>
              <span>{batchProgress ? `${batchProgress.done}/${batchProgress.total}` : `${steamStatus?.pendingBatch ?? 0} pending`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm bg-white/10">
              <div className="h-full bg-hydra-accent transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSaveSteam()}
            disabled={steamBusy}
            className="rh-mini-action"
          >
            {steamBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
            Save SteamGridDB key
          </button>
          <button
            type="button"
            onClick={() => void onScrapeLibrary()}
            disabled={batchBusy || running}
            className="rh-mini-action"
          >
            {batchBusy && !running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Scrape entire library
          </button>
          <button
            type="button"
            onClick={() => void onCancelLibraryScrape()}
            disabled={batchBusy || !running}
            className="rh-mini-action"
          >
            {batchBusy && running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

function SourcesSection({
  repositories,
  busyAction,
  sourceUrl,
  sourcePreview,
  onSourceUrlChange,
  onPreviewRepositoryUrl,
  onConnectRepositoryUrl,
  onConnectRepositoryFile,
  onRefreshRepository,
  onDisconnect
}: {
  repositories: RepositorySummary[];
  busyAction: BusyAction;
  sourceUrl: string;
  sourcePreview: RepositoryPreview | null;
  onSourceUrlChange: (value: string) => void;
  onPreviewRepositoryUrl: () => Promise<void>;
  onConnectRepositoryUrl: () => Promise<void>;
  onConnectRepositoryFile: () => Promise<void>;
  onRefreshRepository: (repositoryId: string) => Promise<void>;
  onDisconnect: (repositoryId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const sourceBusy = busyAction === 'repo-preview-url' || busyAction === 'repo-connect-url' || busyAction === 'repo-file';

  return (
    <section className="grid gap-4" data-testid="settings-modal-sources-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-hydra-accent">{t.settings.sourcesPanel.title}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
            {t.settings.sourcesPanel.copy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSourceUrlChange(PUBLIC_SOURCE_TEMPLATE_URL)}
            disabled={busyAction !== null}
            className="rh-mini-action"
            title={t.settings.sourcesPanel.templateTitle}
          >
            <Clipboard className="h-3.5 w-3.5" />
            {t.settings.sourcesPanel.template}
          </button>
          <button
            type="button"
            onClick={onConnectRepositoryFile}
            disabled={busyAction !== null}
            className="rh-icon-button"
            title={t.settings.sourcesPanel.importJsonTitle}
          >
            {busyAction === 'repo-file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <input
            value={sourceUrl}
            onChange={(event) => onSourceUrlChange(event.target.value)}
            className="h-11 min-w-0 rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
            placeholder="https://example.com/retrohydra-repository.json"
            data-testid="settings-source-url"
          />
          <button
            type="button"
            onClick={onPreviewRepositoryUrl}
            disabled={busyAction !== null || !sourceUrl.trim()}
            className="rh-mini-action h-11 justify-center"
          >
            {busyAction === 'repo-preview-url' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {t.common.check}
          </button>
          <button
            type="button"
            onClick={onConnectRepositoryUrl}
            disabled={busyAction !== null || !sourceUrl.trim()}
            className="rh-mini-action h-11 justify-center"
          >
            {busyAction === 'repo-connect-url' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {t.common.connect}
          </button>
          <button
            type="button"
            onClick={onConnectRepositoryFile}
            disabled={busyAction !== null}
            className="rh-mini-action h-11 justify-center"
          >
            {busyAction === 'repo-file' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            JSON
          </button>
        </div>

        {sourcePreview && <SourcePreviewCard preview={sourcePreview} />}
      </div>

      <div className="rounded-sm border border-white/10 bg-black/[0.28] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white/[0.62]">{t.settings.sourcesPanel.connected}</div>
          {sourceBusy && <div className="text-[10px] font-bold uppercase text-white/[0.36]">{t.settings.sourcesPanel.busy}</div>}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {repositories.length === 0 ? (
            <div className="rh-empty-compact lg:col-span-2">{t.settings.sourcesPanel.empty}</div>
          ) : repositories.map((repository) => (
            <RepositorySourceCard
              key={repository.id}
              repository={repository}
              busyAction={busyAction}
              onRefreshRepository={onRefreshRepository}
              onDisconnect={onDisconnect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StorageSection({
  downloadRoot,
  appDataDir,
  logPath,
  changed,
  onDownloadRootChange
}: {
  downloadRoot: string;
  appDataDir: string;
  logPath: string;
  changed: boolean;
  onDownloadRootChange: (value: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="grid gap-4">
      <div>
          <div className="text-sm font-semibold text-hydra-accent">{t.settings.storage.title}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
          {t.settings.storage.copy}
        </p>
      </div>
      <label className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black text-white/90">{t.settings.storage.downloadFolder}</span>
          {changed && <StatusChip tone="unsaved" label={t.settings.statusChip.unsaved} />}
        </div>
        <input
          value={downloadRoot}
          onChange={(event) => onDownloadRootChange(event.target.value)}
          className="mt-3 h-11 w-full rounded-sm border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/60"
          placeholder="D:\\Games\\Fusion"
          spellCheck={false}
        />
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        <PathCard label={t.settings.storage.appData} value={appDataDir || t.common.loading} />
        <PathCard label={t.settings.storage.logs} value={logPath || t.common.loading} />
      </div>
    </section>
  );
}

function DiagnosticsSection({
  profiles,
  health,
  busyAction,
  onRunHealth,
  onCopyDiagnostics,
  onOpenLogs
}: {
  profiles: PlatformSetupProfile[];
  health: HealthReport | null;
  busyAction: BusyAction;
  onRunHealth: () => Promise<void>;
  onCopyDiagnostics: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-hydra-accent">{t.settings.diagnostics.title}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
            {t.settings.diagnostics.copy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRunHealth} disabled={busyAction === 'health'} className="rh-mini-action">
            {busyAction === 'health' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HeartPulse className="h-3.5 w-3.5" />}
            {t.settings.diagnostics.run}
          </button>
          <button type="button" onClick={onCopyDiagnostics} disabled={busyAction === 'diagnostics'} className="rh-mini-action">
            {busyAction === 'diagnostics' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clipboard className="h-3.5 w-3.5" />}
            {t.settings.diagnostics.copyReport}
          </button>
          <button type="button" onClick={onOpenLogs} disabled={busyAction === 'logs'} className="rh-mini-action">
            {busyAction === 'logs' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            {t.settings.diagnostics.openLogs}
          </button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {profiles.length === 0 ? (
          <div className="rounded-sm border border-white/10 bg-black/[0.34] p-4 text-sm text-white/[0.42] lg:col-span-2">
            {t.settings.diagnostics.profilesLoading}
          </div>
        ) : profiles.map((profile) => {
          const item = health?.platformSetup.find((entry) => entry.id === `profile:${profile.id}`);
          const ready = item?.status === 'ready';

          return (
            <div key={profile.id} className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white/[0.86]">{profile.displayName}</div>
                  <div className="mt-1 truncate text-xs text-white/[0.38]">
                    {profile.emulator.emulatorName} / {profile.gameFiles.expectedExtensions.join(', ')}
                  </div>
                </div>
                <StatusChip tone={ready ? 'valid' : 'missing'} label={ready ? t.settings.statusChip.ready : t.settings.statusChip.missing} />
              </div>
              <div className="mt-3 text-xs leading-5 text-white/[0.44]">{item?.message ?? t.settings.diagnostics.notRun}</div>
            </div>
          );
        })}
      </div>
      {health && (
        <div className="grid gap-3 lg:grid-cols-2">
          <HealthGroup title={t.settings.diagnostics.groups.emulators} items={health.emulators} />
          <HealthGroup title={t.settings.diagnostics.groups.launchProfiles} items={health.platformSetup} />
          <HealthGroup title={t.settings.diagnostics.groups.systemFiles} items={health.systemFiles} />
          <HealthGroup title={t.settings.diagnostics.groups.gameFiles} items={health.gameFiles} />
          <HealthGroup title={t.settings.diagnostics.groups.sources} items={[...health.repositories, health.downloader]} />
        </div>
      )}
    </section>
  );
}

function UpdatesSection({
  state,
  onCheck,
  onInstall
}: {
  state: UpdatePanelState;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <section className="grid gap-4" data-testid="settings-modal-updates-panel">
      <div>
        <div className="text-sm font-semibold text-hydra-accent">{t.settings.updates.title}</div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/[0.52]">
          {t.settings.updates.copy}
        </p>
      </div>
      <UpdateCheckPanel state={state} onCheck={onCheck} onInstall={onInstall} />
    </section>
  );
}

function SourcePreviewCard({ preview }: { preview: RepositoryPreview }) {
  const { locale, t } = useI18n();

  return (
    <div className="mt-4 rounded-sm border border-white/[0.16] bg-white/[0.055] p-4" data-testid="source-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{displayProductText(preview.name)}</div>
          <div className="mt-1 truncate text-xs text-white/50">{preview.url}</div>
          <div className="mt-1 text-[10px] font-semibold text-white/[0.36]">{sourceTrustLabel(preview.trustLevel, locale)}</div>
        </div>
        <TrustBadge trustLevel={preview.trustLevel} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-white/56 sm:grid-cols-2">
        <SourceFact label={t.common.games} value={String(preview.catalogCount)} />
        <SourceFact label={t.common.systemFiles} value={String(preview.systemFileCount)} />
        <SourceFact label={t.common.version} value={preview.version} />
        <SourceFact label={t.common.hash} value={shortHash(preview.contentHash)} />
        {preview.maintainer && <SourceFact label={t.common.team} value={displayProductText(preview.maintainer)} />}
        {preview.license && <SourceFact label={t.common.license} value={preview.license} />}
      </div>
      {preview.hasExecutableAssets && (
        <div className="mt-3 flex items-center gap-2 rounded-sm border border-amber-200/[0.2] bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          <ShieldAlert className="h-3.5 w-3.5" />
          {t.settings.sourcesPanel.executableAssets}
        </div>
      )}
      {preview.trustLevel === 'unknown' && (
        <div className="mt-3 flex items-center gap-2 rounded-sm border border-amber-200/[0.2] bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          <ShieldAlert className="h-3.5 w-3.5" />
          {t.settings.sourcesPanel.unknownSource}
        </div>
      )}
    </div>
  );
}

function RepositorySourceCard({
  repository,
  busyAction,
  onRefreshRepository,
  onDisconnect
}: {
  repository: RepositorySummary;
  busyAction: BusyAction;
  onRefreshRepository: (repositoryId: string) => Promise<void>;
  onDisconnect: (repositoryId: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const refreshing = busyAction === `repo-refresh:${repository.id}`;
  const removing = busyAction === `repo:${repository.id}`;

  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.04] p-4" data-testid="source-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{displayProductText(repository.name)}</div>
          <div className="mt-1 truncate text-xs text-white/[0.36]">{repository.url}</div>
          <div className="mt-1 text-[10px] font-semibold text-white/[0.28]">{sourceTrustLabel(repository.trustLevel, locale)}</div>
        </div>
        <TrustBadge trustLevel={repository.trustLevel} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-white/[0.46] sm:grid-cols-2">
        <SourceFact label={t.common.games} value={String(repository.catalogCount)} />
        <SourceFact label={t.common.systemFiles} value={String(repository.systemFileCount)} />
        <SourceFact label={t.common.version} value={repository.version} />
        {repository.contentHash && <SourceFact label={t.common.hash} value={shortHash(repository.contentHash)} />}
        {repository.maintainer && <SourceFact label={t.common.team} value={displayProductText(repository.maintainer)} />}
        {repository.license && <SourceFact label={t.common.license} value={repository.license} />}
      </div>
      {repository.homepageUrl && (
        <div className="mt-2 truncate text-xs text-white/[0.36]">{repository.homepageUrl}</div>
      )}
      {repository.lastRefreshedAt && (
        <div className="mt-2 text-[10px] uppercase text-white/[0.28]">{t.common.updated} {formatDateTime(repository.lastRefreshedAt, locale)}</div>
      )}
      {repository.hasExecutableAssets && (
        <div className="mt-3 flex items-center gap-2 rounded-sm border border-amber-200/[0.2] bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          <ShieldAlert className="h-3.5 w-3.5" />
          {t.settings.sourcesPanel.executableRequiresTrust}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRefreshRepository(repository.id)}
          disabled={busyAction !== null}
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-white/10 px-3 text-xs font-bold text-white/70"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          {t.common.refresh}
        </button>
        <button
          type="button"
          onClick={() => onDisconnect(repository.id)}
          disabled={busyAction !== null}
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-red-300/[0.2] px-3 text-xs font-bold text-red-100/80"
        >
          {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
          {t.common.remove}
        </button>
      </div>
    </div>
  );
}

function SourceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold text-white/[0.30]">{label}</div>
      <div className="mt-0.5 truncate text-white/70">{value}</div>
    </div>
  );
}

function TrustBadge({ trustLevel }: { trustLevel: string }) {
  const { locale } = useI18n();

  return (
    <span className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold ${trustBadgeClass(trustLevel)}`}>
      {sourceTrustLabel(trustLevel, locale)}
    </span>
  );
}

function UpdateCheckPanel({
  state,
  onCheck,
  onInstall
}: {
  state: UpdatePanelState;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const checking = state.phase === 'checking';
  const installing = state.phase === 'installing';
  const busy = checking || installing;

  return (
    <div className="rounded-sm border border-white/10 bg-black/[0.34] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <RefreshCcw className="h-4 w-4 text-white/72" />
            {t.settings.updates.panelTitle}
          </div>
          <div className="mt-1 text-sm text-white/[0.46]">{t.settings.updates.panelCopy}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCheck} disabled={busy} className="rh-mini-action">
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            {state.phase === 'error' ? t.settings.updates.retry : t.settings.updates.check}
          </button>
          {state.phase === 'available' && (
            <button type="button" onClick={onInstall} disabled={busy} className="rh-mini-action">
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t.settings.updates.installNow}
            </button>
          )}
        </div>
      </div>
      <div className={`rh-update-status rh-update-status-${state.phase}`}>
        {state.phase === 'idle' && t.settings.updates.checkIdle}
        {state.phase === 'checking' && t.settings.updates.checking}
        {state.phase === 'installing' && t.settings.updates.installing}
        {state.phase === 'up-to-date' && t.settings.updates.upToDate(state.report?.currentVersion)}
        {state.phase === 'available' && (
          <div>
            <div className="font-black text-white">{t.settings.updates.available(state.report?.version)}</div>
            {state.report?.body && <div className="mt-1 text-white/50">{state.report.body}</div>}
            {state.report?.date && <div className="mt-1 text-white/[0.36]">{t.common.published} {state.report.date}</div>}
          </div>
        )}
        {state.phase === 'error' && updateErrorText(state.error, locale)}
      </div>
    </div>
  );
}

function HealthGroup({ title, items }: { title: string; items: HealthCheckItem[] }) {
  const { t } = useI18n();

  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 text-sm font-semibold text-white/[0.62]">{title}</div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-xs text-white/[0.36]">{t.settings.emptyHealth}</div>
        ) : items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 rounded-sm border border-white/[0.08] bg-black/[0.16] px-3 py-2 text-xs">
            <span className={`mt-1 h-2 w-2 rounded-full ${healthToneClass(item.status)}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-white/[0.82]">{item.label}</div>
              <div className="mt-1 text-white/[0.42]">{item.message ?? healthStatusLabel(item.status, t)}</div>
            </div>
            <span className="rounded-sm border border-white/10 px-2 py-1 uppercase text-white/[0.48]">{healthStatusLabel(item.status, t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ tone, label }: { tone: EmulatorDraftTone; label: string }) {
  return (
    <span className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold ${statusToneClass(tone)}`}>
      {label}
    </span>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/10 bg-black/[0.34] p-4">
      <div className="text-[10px] font-semibold text-white/[0.32]">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function PathCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-white/10 bg-white/[0.025] p-4">
      <div className="text-[10px] font-semibold text-white/[0.32]">{label}</div>
      <div className="mt-2 truncate text-sm text-white/[0.62]">{value}</div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-black text-white/80">{value}</span>
    </div>
  );
}

function sectionTitle(section: SettingsSection, t: UiText) {
  return t.settings.sections[section];
}

function updatePhaseLabel(phase: UpdatePanelPhase, t: UiText) {
  return t.settings.updatePhase[phase];
}

function statusToneClass(tone: EmulatorDraftTone) {
  if (tone === 'valid') return 'border-emerald-200/[0.24] bg-emerald-200/10 text-emerald-100';
  if (tone === 'missing') return 'border-amber-200/[0.24] bg-amber-200/10 text-amber-100';
  if (tone === 'invalid') return 'border-red-200/[0.24] bg-red-200/10 text-red-100';
  if (tone === 'unsaved') return 'border-white/[0.24] bg-white/[0.09] text-white/[0.82]';
  return 'border-white/[0.12] bg-white/[0.04] text-white/[0.42]';
}

function healthStatusLabel(status: string, t: UiText) {
  if (status === 'ready') return t.settings.healthStatus.ready;
  if (status === 'missing') return t.settings.healthStatus.missing;
  if (status === 'error') return t.settings.healthStatus.error;
  if (status === 'corrupt') return t.settings.healthStatus.corrupt;
  return status;
}

function healthToneClass(status: string) {
  if (status === 'ready') return 'bg-hydra-green';
  if (status === 'corrupt' || status === 'error') return 'bg-red-300';
  return 'bg-amber-300';
}

function formatDateTime(timestamp: string, locale: Locale) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function shortHash(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function trustBadgeClass(trustLevel: string) {
  if (trustLevel === 'official') return 'border-emerald-300/[0.24] bg-emerald-300/10 text-emerald-100';
  if (trustLevel === 'community') return 'border-hydra-accent/[0.24] bg-hydra-accent/10 text-hydra-accent';
  return 'border-amber-300/[0.24] bg-amber-300/10 text-amber-100';
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
}
