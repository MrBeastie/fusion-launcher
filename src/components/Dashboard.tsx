'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  RotateCw,
  Search,
  Settings,
  ShieldAlert,
  X
} from 'lucide-react';
import { I18nProvider, useI18n } from '@/components/I18nProvider';
import { GameDetailsModal } from '@/components/GameDetailsModal';
import { LaunchErrorModal } from '@/components/LaunchErrorModal';
import { SettingsModal } from '@/components/SettingsModal';
import { AppShell } from '@/components/shell/AppShell';
import {
  collectionTargetForId,
  CollectionsPanel,
  type CollectionTarget,
  HeroPanel,
  HomeRailsPanel,
  type HomeRail,
  mergeRailItems
} from '@/components/shell/CockpitPanels';
import { GameArt, GamePoster } from '@/components/shell/GamePoster';
import { useGamepad } from '@/hooks/useGamepad';
import {
  buildGameLibraryItems,
  filterLibraryItems,
  type GameLibraryItem,
  searchAndSortLibraryItems,
  type LibraryFilter,
  type LibrarySort
} from '@/lib/libraryStatus';
import { api } from '@/lib/api';
import { isDirectGameDownload } from '@/lib/downloadActions';
import { getUiText, updateErrorText, type UiText } from '@/lib/i18n';
import { normalizeLaunchFailure } from '@/lib/launchErrors';
import { isTauriRuntime } from '@/lib/runtime';
import { loadSettings, saveSettings, type AppSettings } from '@/lib/settings';
import { unknownSourcePrompt } from '@/lib/sourceTrust';
import { useLauncherStore, type ActivityEvent, type LauncherView } from '@/stores/launcherStore';
import type {
  CatalogGame,
  DownloadProgressEvent,
  HealthReport,
  LaunchFailure,
  RepositoryPreview,
  RepositorySummary,
  TorrentDownloadRecord,
  TorrentDownloadStatus,
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

interface DashboardProps {
  initialSettings: AppSettings;
  catalog: CatalogGame[];
  repositories: RepositorySummary[];
  message: string | null;
  onDisconnectRepository: (repositoryId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const FILTERS: LibraryFilter[] = ['all', 'installed', 'downloading', 'missing'];
const SORTS: LibrarySort[] = ['title', 'status', 'platform', 'repository'];

const ACTIVE_DOWNLOAD_STATUSES: TorrentDownloadStatus[] = ['resolving', 'downloading', 'cancelling'];
const RESUMABLE_DOWNLOAD_STATUSES: TorrentDownloadStatus[] = ['paused', 'interrupted', 'error'];

export function Dashboard({
  initialSettings,
  catalog,
  repositories,
  message,
  onDisconnectRepository,
  onRefresh
}: DashboardProps) {
  const storeCatalog = useLauncherStore((state) => state.catalog);
  const storeRepositories = useLauncherStore((state) => state.repositories);
  const libraryStatuses = useLauncherStore((state) => state.libraryStatuses);
  const downloads = useLauncherStore((state) => state.downloads);
  const settings = useLauncherStore((state) => state.settings);
  const activeView = useLauncherStore((state) => state.activeView);
  const focusedItemId = useLauncherStore((state) => state.focusedItemId);
  const selectedGameId = useLauncherStore((state) => state.selectedGameId);
  const activityEvents = useLauncherStore((state) => state.activityEvents);
  const setCatalog = useLauncherStore((state) => state.setCatalog);
  const setRepositories = useLauncherStore((state) => state.setRepositories);
  const setLibraryStatuses = useLauncherStore((state) => state.setLibraryStatuses);
  const setDownloads = useLauncherStore((state) => state.setDownloads);
  const setSettings = useLauncherStore((state) => state.setSettings);
  const setActiveView = useLauncherStore((state) => state.setActiveView);
  const setFocusedItemId = useLauncherStore((state) => state.setFocusedItemId);
  const setSelectedGameId = useLauncherStore((state) => state.setSelectedGameId);
  const mergeDownloadEvent = useLauncherStore((state) => state.mergeDownloadEvent);
  const addActivityEvent = useLauncherStore((state) => state.addActivityEvent);

  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('title');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [launcherMessage, setLauncherMessage] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourcePreview, setSourcePreview] = useState<RepositoryPreview | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [dataReady, setDataReady] = useState(false);
  const [launchFailure, setLaunchFailure] = useState<LaunchFailure | null>(null);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [seenNotificationKey, setSeenNotificationKey] = useState('');
  const [updatePanel, setUpdatePanel] = useState<UpdatePanelState>({
    phase: 'idle',
    report: null,
    error: null
  });
  const locale = settings.language;
  const t = getUiText(locale);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings, setSettings]);

  useEffect(() => {
    setCatalog(catalog);
    setRepositories(repositories);
  }, [catalog, repositories, setCatalog, setRepositories]);

  const refreshLauncherData = useCallback(async () => {
    try {
      const [nextLibraryStatuses, nextDownloads] = await Promise.all([
        api.getLibraryStatuses(),
        api.listTorrentDownloads()
      ]);
      setLibraryStatuses(nextLibraryStatuses);
      setDownloads(nextDownloads);
      setLauncherMessage(null);
    } catch (error) {
      setLauncherMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDataReady(true);
    }
  }, [setDownloads, setLibraryStatuses]);

  useEffect(() => {
    let cancelled = false;
    const loadPersistedSettings = async () => {
      try {
        const persistedSettings = await loadSettings();
        if (!cancelled) {
          setSettings(persistedSettings);
          setSettingsMessage(null);
        }
      } catch (error) {
        if (!cancelled) setSettingsMessage(t.dashboard.messages.settingsLoadError(error));
      }
    };

    void loadPersistedSettings();
    return () => {
      cancelled = true;
    };
  }, [setSettings, t]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    void refreshLauncherData();
  }, [storeCatalog.length, refreshLauncherData]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let active = true;
    const unlistenPromise = listen<DownloadProgressEvent>('download:progress', (event) => {
      if (active) mergeDownloadEvent(event.payload);
    });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [mergeDownloadEvent]);

  const items = useMemo(
    () => buildGameLibraryItems(storeCatalog, libraryStatuses, settings),
    [libraryStatuses, settings, storeCatalog]
  );
  const itemsByGameId = useMemo(() => new Map(items.map((item) => [item.game.id, item])), [items]);
  const activeDownloadItems = useMemo(
    () => items.filter((item) => item.isDownloading || item.isPaused || item.hasError),
    [items]
  );
  const selectedGame = selectedGameId ? storeCatalog.find((game) => game.id === selectedGameId) ?? null : null;
  const visibleLibraryItems = useMemo(
    () => searchAndSortLibraryItems(items, libraryFilter, librarySearch, librarySort),
    [items, libraryFilter, librarySearch, librarySort]
  );
  const homeRails = useMemo(() => composeHomeRails(items, t), [items, t]);
  const notificationAlertKey = useMemo(() => {
    const updateKey = updatePanel.phase === 'available'
      ? `update:${updatePanel.report?.version ?? 'available'}`
      : '';
    const eventKey = activityEvents[0]?.id ? `event:${activityEvents[0].id}` : '';
    return [updateKey, eventKey].filter(Boolean).join('|');
  }, [activityEvents, updatePanel.phase, updatePanel.report?.version]);
  const hasNotificationAlert = Boolean(notificationAlertKey && notificationAlertKey !== seenNotificationKey);

  useEffect(() => {
    if (notificationsOpen) setSeenNotificationKey(notificationAlertKey);
  }, [notificationAlertKey, notificationsOpen]);

  const persistSettings = async (nextSettings: AppSettings) => {
    const savedSettings = await saveSettings(nextSettings);
    setSettings(savedSettings);
    setSettingsMessage(null);
    await refreshLauncherData();
    return savedSettings;
  };

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setBusyAction(label);
    setLauncherMessage(null);
    try {
      await action();
      await refreshLauncherData();
    } catch (error) {
      setLauncherMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const refreshAll = async () => {
    await runAction('refresh', async () => {
      await onRefresh();
      await refreshLauncherData();
    });
  };

  const disconnect = async (repositoryId: string) => {
    await runAction(`repo:${repositoryId}`, async () => onDisconnectRepository(repositoryId));
  };

  const refreshRepository = async (repositoryId: string) => {
    await runAction(`repo-refresh:${repositoryId}`, async () => {
      await api.refreshRepository(repositoryId);
      await onRefresh();
    });
  };

  const updateSourceUrl = (value: string) => {
    setSourceUrl(value);
    setSourcePreview(null);
  };

  const previewRepositoryUrl = async () => {
    const trimmedUrl = sourceUrl.trim();
    if (!trimmedUrl) {
      setLauncherMessage(t.dashboard.messages.sourceUrlRequired);
      return;
    }

    await runAction('repo-preview-url', async () => {
      const preview = await api.previewRepository(trimmedUrl);
      setSourcePreview(preview);
      addActivityEvent({
        title: t.dashboard.messages.sourceChecked,
        detail: preview.name,
        tone: preview.hasExecutableAssets ? 'warning' : 'info'
      });
    });
  };

  const connectRepositoryUrl = async () => {
    const trimmedUrl = sourceUrl.trim();
    if (!trimmedUrl) {
      setLauncherMessage(t.dashboard.messages.sourceUrlRequired);
      return;
    }

    await runAction('repo-connect-url', async () => {
      const preview = sourcePreview?.url === trimmedUrl
        ? sourcePreview
        : await api.previewRepository(trimmedUrl);
      if (preview.trustLevel === 'unknown') {
        const confirmed = window.confirm(unknownSourcePrompt(preview, locale));
        if (!confirmed) return;
      }
      await api.connectRepository(trimmedUrl);
      setSourceUrl('');
      setSourcePreview(null);
      addActivityEvent({
        title: t.dashboard.messages.sourceConnected,
        detail: preview.name,
        tone: preview.hasExecutableAssets ? 'warning' : 'success'
      });
      await onRefresh();
    });
  };

  const connectRepositoryFile = async () => {
    if (!isTauriRuntime()) {
      setLauncherMessage(t.dashboard.messages.localJsonDesktopOnly);
      return;
    }
    await runAction('repo-file', async () => {
      const selected = await open({
        title: t.dashboard.messages.selectSourceJson,
        multiple: false,
        directory: false,
        filters: [{ name: t.dashboard.messages.repositoryJson, extensions: ['json'] }]
      });
      if (typeof selected !== 'string') return;
      const preview = await api.previewRepositoryFile(selected);
      if (preview.trustLevel === 'unknown') {
        const confirmed = window.confirm(unknownSourcePrompt(preview, locale));
        if (!confirmed) return;
      }
      await api.connectRepositoryFile(selected);
      await onRefresh();
    });
  };

  const runHealthCheck = async () => {
    await runAction('health', async () => {
      setHealthReport(await api.runHealthCheck());
    });
  };

  const copyDiagnostics = async () => {
    await runAction('diagnostics', async () => {
      const bundle = await api.getDiagnosticsBundle();
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setHealthReport(bundle.health);
      addActivityEvent({
        title: t.dashboard.messages.diagnosticsCopied,
        detail: bundle.logPath,
        tone: 'success'
      });
    });
  };

  const openLogs = async () => {
    await runAction('logs', () => api.openLogsFolder());
  };

  const checkAppUpdate = async () => {
    setUpdatePanel((current) => ({ ...current, phase: 'checking', error: null }));
    try {
      const report = await api.checkAppUpdate();
      setUpdatePanel({
        phase: report.available ? 'available' : 'up-to-date',
        report,
        error: null
      });
    } catch (error) {
      setUpdatePanel({
        phase: 'error',
        report: null,
        error: normalizeUpdateCheckError(error)
      });
    }
  };

  const installAppUpdate = async () => {
    setUpdatePanel((current) => ({ ...current, phase: 'installing', error: null }));
    try {
      await api.installAppUpdate();
      setUpdatePanel((current) => ({
        phase: 'up-to-date',
        report: current.report,
        error: null
      }));
    } catch (error) {
      setUpdatePanel((current) => ({
        phase: 'error',
        report: current.report,
        error: normalizeUpdateCheckError(error)
      }));
    }
  };

  const installItem = async (item: GameLibraryItem) => {
    setBusyAction(`download:${item.game.id}`);
    setLauncherMessage(null);
    try {
      const result = await api.installGame(item.game.id);
      setSettings(await loadSettings());
      addActivityEvent({
        title: result.status === 'ready' ? t.dashboard.messages.installComplete : t.dashboard.messages.installNeedsAttention,
        detail: item.game.title,
        gameId: item.game.id,
        tone: result.status === 'ready' ? 'success' : 'warning'
      });
      if (result.status !== 'ready') {
        setLauncherMessage(result.message ?? result.errorCode ?? t.dashboard.messages.installNeedsAttentionDetail);
        setSelectedGameId(item.game.id);
      }
      await refreshLauncherData();
    } catch (error) {
      setLauncherMessage(error instanceof Error ? error.message : String(error));
      setSelectedGameId(item.game.id);
    } finally {
      setBusyAction(null);
    }
  };

  const launchItem = async (item: GameLibraryItem) => {
    setBusyAction(`play:${item.game.id}`);
    setLauncherMessage(null);
    setLaunchFailure(null);
    try {
      await api.launchGame(item.game.id);
      addActivityEvent({
        title: t.dashboard.messages.launchSent,
        detail: item.game.title,
        gameId: item.game.id,
        tone: 'success'
      });
      await refreshLauncherData();
    } catch (error) {
      setLaunchFailure(normalizeLaunchFailure(error, item.game));
    } finally {
      setBusyAction(null);
    }
  };

  const executePrimaryAction = async (item: GameLibraryItem) => {
    if (item.primaryAction === 'play') return launchItem(item);
    if (item.primaryAction === 'download') return installItem(item);
    if (item.primaryAction === 'resume' || item.primaryAction === 'retry') {
      return runAction(`resume:${item.game.id}`, () => (
        isDirectGameDownload(item.game, item.download)
          ? api.startGameDownload(item.game.id)
          : api.resumeDownload(item.game.id)
      ));
    }
    setSelectedGameId(item.game.id);
  };

  const openLibraryCollection = useCallback((target: CollectionTarget) => {
    setLibraryFilter(target.filter);
    setLibrarySearch(target.query);
    setLibrarySort(target.sort);
    setActiveView('library');
  }, [setActiveView]);

  const focusActivate = useCallback((focusId: string) => {
    const [kind, ...rest] = focusId.split(':');
    const value = rest.join(':');
    const encodedTail = rest[rest.length - 1] ?? '';
    const gameId = safeDecodeURIComponent(encodedTail);

    if (kind === 'nav') {
      setActiveView(value as LauncherView);
      return;
    }
    if (kind === 'top') {
      if (value === 'refresh') void refreshAll();
      if (value === 'notifications') setNotificationsOpen((open) => !open);
      if (value === 'update-check') {
        setNotificationsOpen(true);
        void checkAppUpdate();
      }
      if (value === 'update-install') {
        setNotificationsOpen(true);
        void installAppUpdate();
      }
      if (value === 'settings') {
        setNotificationsOpen(false);
        setSettingsOpen(true);
      }
      return;
    }
    if (kind === 'filter') {
      setLibraryFilter(value as LibraryFilter);
      return;
    }
    if (kind === 'action') {
      const item = itemsByGameId.get(gameId || value);
      if (item) void executePrimaryAction(item);
      return;
    }
    if (kind === 'details' || kind === 'game') {
      if (gameId || value) setSelectedGameId(gameId || value);
      return;
    }
    if (kind === 'download-action') {
      const [downloadAction] = rest;
      if (!gameId) return;
      if (downloadAction === 'pause') void runAction(`pause:${gameId}`, () => api.pauseDownload(gameId));
      if (downloadAction === 'resume' || downloadAction === 'retry') {
        const item = itemsByGameId.get(gameId);
        void runAction(`resume:${gameId}`, () => (
          isDirectGameDownload(item?.game, item?.download)
            ? api.startGameDownload(gameId)
            : api.resumeDownload(gameId)
        ));
      }
      if (downloadAction === 'cancel') void runAction(`cancel:${gameId}`, () => api.cancelDownload(gameId));
      if (downloadAction === 'play') {
        const item = itemsByGameId.get(gameId);
        if (item) void launchItem(item);
      }
      return;
    }
    if (kind === 'activity') {
      if (itemsByGameId.has(gameId)) setSelectedGameId(gameId);
      return;
    }
    if (kind === 'collection') {
      openLibraryCollection(collectionTargetForId(value));
      return;
    }
    if (focusId === 'settings:open') {
      setNotificationsOpen(false);
      setSettingsOpen(true);
      return;
    }
    if (kind === 'downloads' && rest[0] === 'open') {
      setActiveView('downloads');
      return;
    }
    if (kind === 'library' && rest[0] === 'open') {
      setActiveView('library');
      return;
    }
    if (focusId === 'downloads:open') setActiveView('downloads');
    if (focusId === 'library:open') setActiveView('library');
  }, [checkAppUpdate, executePrimaryAction, installAppUpdate, itemsByGameId, launchItem, openLibraryCollection, refreshAll, runAction, setActiveView, setSelectedGameId]);

  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[data-focus-active="true"]').forEach((element) => {
      element.removeAttribute('data-focus-active');
    });

    if (!focusedItemId) return;
    document
      .querySelector<HTMLElement>(`[data-focus-id="${cssEscape(focusedItemId)}"]`)
      ?.setAttribute('data-focus-active', 'true');
  }, [activeView, downloads.length, focusedItemId, items.length, notificationsOpen, selectedGameId, settingsOpen]);

  useGamepad({
    focusedItemId,
    setFocusedItemId,
    onActivate: focusActivate,
    onBack: () => {
      if (notificationsOpen) setNotificationsOpen(false);
      else if (selectedGameId) setSelectedGameId(null);
      else if (settingsOpen) setSettingsOpen(false);
      else setActiveView('home');
    },
    onMenu: (focusId) => {
      const gameId = focusId?.startsWith('game:') ? safeDecodeURIComponent(focusId.split(':').at(-1) ?? '') : null;
      if (gameId) setSelectedGameId(gameId);
    }
  });

  const bannerMessage = message || settingsMessage || launcherMessage;

  return (
    <I18nProvider locale={locale}>
      <AppShell
        activeView={activeView}
        repositoriesCount={storeRepositories.length}
        activeDownloadsCount={activeDownloadItems.length}
        onNavigate={setActiveView}
        onOpenSettings={() => {
          setNotificationsOpen(false);
          setSettingsOpen(true);
        }}
        onFocus={setFocusedItemId}
      >
        <TopChrome
          onRefresh={refreshAll}
          onOpenSettings={() => {
            setNotificationsOpen(false);
            setSettingsOpen(true);
          }}
          onFocus={setFocusedItemId}
          refreshing={busyAction === 'refresh'}
          notificationsOpen={notificationsOpen}
          hasNotificationAlert={hasNotificationAlert}
          updatePanel={updatePanel}
          activityEvents={activityEvents}
          onNotificationsOpenChange={setNotificationsOpen}
          onCheckAppUpdate={checkAppUpdate}
          onInstallAppUpdate={installAppUpdate}
        />
        {bannerMessage && <div className="rh-banner">{bannerMessage}</div>}

        {activeView === 'home' && (
          <HomeScreen
            loading={!dataReady}
            heroItem={homeRails.heroItem}
            rails={homeRails.rails}
            collectionItems={items}
            busyAction={busyAction}
            onPrimaryAction={(item) => void executePrimaryAction(item)}
            onOpenDetails={(game) => setSelectedGameId(game.id)}
            onOpenCollection={openLibraryCollection}
            onOpenSettings={() => setSettingsOpen(true)}
            onFocus={setFocusedItemId}
          />
        )}

        {activeView === 'library' && (
          <LibraryScreen
            items={visibleLibraryItems}
            allItems={items}
            totalCount={items.length}
            filter={libraryFilter}
            query={librarySearch}
            sort={librarySort}
            busyAction={busyAction}
            onFilterChange={setLibraryFilter}
            onQueryChange={setLibrarySearch}
            onSortChange={setLibrarySort}
            onPrimaryAction={(item) => void executePrimaryAction(item)}
            onOpenDetails={(game) => setSelectedGameId(game.id)}
            onFocus={setFocusedItemId}
          />
        )}

        {activeView === 'downloads' && (
          <DownloadsScreen
            downloads={downloads}
            itemsByGameId={itemsByGameId}
            busyAction={busyAction}
            onOpenDetails={(game) => setSelectedGameId(game.id)}
            onPause={(gameId) => runAction(`pause:${gameId}`, () => api.pauseDownload(gameId))}
            onResume={(gameId) => {
              const item = itemsByGameId.get(gameId);
              const record = downloads.find((download) => download.gameId === gameId) ?? item?.download;
              return runAction(`resume:${gameId}`, () => (
                isDirectGameDownload(item?.game, record)
                  ? api.startGameDownload(gameId)
                  : api.resumeDownload(gameId)
              ));
            }}
            onCancel={(gameId) => runAction(`cancel:${gameId}`, () => api.cancelDownload(gameId))}
            onPlay={(item) => void launchItem(item)}
            onFocus={setFocusedItemId}
          />
        )}

        {activeView === 'explore' && (
          <ExploreScreen
            events={activityEvents}
            items={items}
            onOpenEvent={(event) => {
              if (event.gameId) setSelectedGameId(event.gameId);
            }}
            onFocus={setFocusedItemId}
          />
        )}

        {activeView === 'collections' && (
          <CollectionsScreen
            items={items}
            onOpenCollection={openLibraryCollection}
            onFocus={setFocusedItemId}
          />
        )}

        {selectedGame && (
          <GameDetailsModal
            game={selectedGame}
            settings={settings}
            onOpenSettings={() => {
              setSelectedGameId(null);
              setSettingsOpen(true);
            }}
            onClose={() => setSelectedGameId(null)}
            onRefresh={async () => {
              await refreshLauncherData();
              setSettings(await loadSettings());
              await onRefresh();
            }}
          />
        )}

        {launchFailure && (
          <LaunchErrorModal
            failure={launchFailure}
            onClose={() => setLaunchFailure(null)}
            onOpenSettings={() => {
              setLaunchFailure(null);
              setSettingsOpen(true);
            }}
            onOpenDetails={() => {
              if (launchFailure.gameId) setSelectedGameId(launchFailure.gameId);
              setLaunchFailure(null);
            }}
            onRetryDownload={() => {
              const item = launchFailure.gameId ? itemsByGameId.get(launchFailure.gameId) : null;
              setLaunchFailure(null);
              if (item) void installItem(item);
            }}
          />
        )}

        {settingsOpen && (
          <SettingsModal
            settings={settings}
            repositories={storeRepositories}
            downloads={downloads}
            busyAction={busyAction}
            healthReport={healthReport}
            updatePanel={updatePanel}
            sourceUrl={sourceUrl}
            sourcePreview={sourcePreview}
            onClose={() => setSettingsOpen(false)}
            onSave={persistSettings}
            onSourceUrlChange={updateSourceUrl}
            onPreviewRepositoryUrl={previewRepositoryUrl}
            onConnectRepositoryUrl={connectRepositoryUrl}
            onConnectRepositoryFile={connectRepositoryFile}
            onDisconnect={disconnect}
            onRefreshRepository={refreshRepository}
            onRunHealth={runHealthCheck}
            onCopyDiagnostics={copyDiagnostics}
            onOpenLogs={openLogs}
            onCheckAppUpdate={checkAppUpdate}
            onInstallAppUpdate={installAppUpdate}
          />
        )}
      </AppShell>
    </I18nProvider>
  );
}

function TopChrome({
  onRefresh,
  onOpenSettings,
  onFocus,
  refreshing,
  notificationsOpen,
  hasNotificationAlert,
  updatePanel,
  activityEvents,
  onNotificationsOpenChange,
  onCheckAppUpdate,
  onInstallAppUpdate
}: {
  onRefresh: () => void;
  onOpenSettings: () => void;
  onFocus: (focusId: string) => void;
  refreshing: boolean;
  notificationsOpen: boolean;
  hasNotificationAlert: boolean;
  updatePanel: UpdatePanelState;
  activityEvents: ActivityEvent[];
  onNotificationsOpenChange: (open: boolean) => void;
  onCheckAppUpdate: () => Promise<void>;
  onInstallAppUpdate: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => new Date());
  const [searchValue, setSearchValue] = useState('');
  const actionsRef = useRef<HTMLDivElement>(null);
  const updateCheckedFromPopoverRef = useRef(false);
  const { locale, t } = useI18n();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notificationsOpen || updatePanel.phase !== 'idle' || updateCheckedFromPopoverRef.current) return;
    updateCheckedFromPopoverRef.current = true;
    void onCheckAppUpdate();
  }, [notificationsOpen, onCheckAppUpdate, updatePanel.phase]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!actionsRef.current?.contains(event.target)) onNotificationsOpenChange(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onNotificationsOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationsOpen, onNotificationsOpenChange]);

  return (
    <header className="rh-topbar">
      <label className="rh-global-search" aria-label={t.dashboard.topbar.searchAria}>
        <Search className="h-4 w-4 text-white/42" />
        <input
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder={t.dashboard.topbar.searchPlaceholder}
        />
      </label>
      <div ref={actionsRef} className="rh-topbar-actions">
        <button
          data-focus-id="top:refresh"
          data-focus-zone="topbar"
          onFocus={() => onFocus('top:refresh')}
          onClick={onRefresh}
          disabled={refreshing}
          className="rh-icon-button rh-focusable"
          title={t.dashboard.topbar.refreshTitle}
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
        <div className="rh-notification-root">
          <button
            id="rh-notifications-trigger"
            data-testid="top-notifications"
            data-focus-id="top:notifications"
            data-focus-zone="topbar"
            onFocus={() => onFocus('top:notifications')}
            onClick={() => onNotificationsOpenChange(!notificationsOpen)}
            className="rh-icon-button rh-notification-button rh-focusable"
            title={t.dashboard.topbar.notificationsTitle}
            aria-label={t.dashboard.topbar.notificationsTitle}
            aria-expanded={notificationsOpen}
            aria-controls="rh-notifications-popover"
          >
            <Bell className="h-4 w-4" />
            {hasNotificationAlert && (
              <span className="rh-notification-dot">
                <span className="sr-only">{t.dashboard.topbar.notifications.unread}</span>
              </span>
            )}
          </button>
          {notificationsOpen && (
            <TopNotificationsPopover
              state={updatePanel}
              events={activityEvents}
              onFocus={onFocus}
              onCheck={onCheckAppUpdate}
              onInstall={onInstallAppUpdate}
            />
          )}
        </div>
        <button
          data-testid="top-settings"
          data-focus-id="top:settings"
          data-focus-zone="topbar"
          onFocus={() => onFocus('top:settings')}
          onClick={onOpenSettings}
          className="rh-icon-button rh-focusable"
          title={t.dashboard.topbar.settingsTitle}
        >
          <Settings className="h-4 w-4" />
        </button>
        <div className="rh-clock">{formatClock(now, locale)}</div>
      </div>
    </header>
  );
}

function TopNotificationsPopover({
  state,
  events,
  onFocus,
  onCheck,
  onInstall
}: {
  state: UpdatePanelState;
  events: ActivityEvent[];
  onFocus: (focusId: string) => void;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const checking = state.phase === 'checking';
  const installing = state.phase === 'installing';
  const busy = checking || installing;
  const visibleEvents = events.slice(0, 5);

  return (
    <section
      id="rh-notifications-popover"
      className="rh-notifications-popover"
      aria-labelledby="rh-notifications-title"
    >
      <div className="rh-notifications-header">
        <div>
          <div id="rh-notifications-title" className="rh-notifications-title">{t.dashboard.topbar.notifications.title}</div>
          <div className="rh-notifications-subtitle">{t.dashboard.topbar.notifications.subtitle}</div>
        </div>
        {state.phase === 'available' && (
          <span className="rh-notifications-badge">{t.dashboard.topbar.notifications.availableBadge}</span>
        )}
      </div>

      <div className={`rh-notification-update rh-notification-update-${state.phase}`}>
        <div className="rh-notification-update-heading">
          <UpdateStatusIcon phase={state.phase} />
          <div className="min-w-0">
            <div className="rh-notification-section-title">{t.dashboard.topbar.notifications.updateTitle}</div>
            <div className="rh-notification-status-text">{updateNotificationText(state, t, locale)}</div>
          </div>
        </div>
        <div className="rh-notification-actions">
          <button
            type="button"
            data-focus-id="top:update-check"
            data-focus-zone="topbar"
            onFocus={() => onFocus('top:update-check')}
            onClick={() => void onCheck()}
            disabled={busy}
            className="rh-mini-action rh-focusable"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            {state.phase === 'error' ? t.settings.updates.retry : t.settings.updates.check}
          </button>
          {state.phase === 'available' && (
            <button
              type="button"
              data-focus-id="top:update-install"
              data-focus-zone="topbar"
              onFocus={() => onFocus('top:update-install')}
              onClick={() => void onInstall()}
              disabled={busy}
              className="rh-mini-action rh-focusable"
            >
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t.settings.updates.installNow}
            </button>
          )}
        </div>
        {state.phase === 'available' && state.report?.body && (
          <div className="rh-notification-release">
            <div className="rh-notification-release-label">{t.dashboard.topbar.notifications.releaseNotes}</div>
            <div>{state.report.body}</div>
          </div>
        )}
        {state.phase === 'available' && state.report?.date && (
          <div className="rh-notification-published">{t.common.published} {state.report.date}</div>
        )}
      </div>

      <div className="rh-notification-feed-heading">{t.dashboard.topbar.notifications.activityTitle}</div>
      <div className="rh-notification-feed">
        {visibleEvents.length === 0 ? (
          <div className="rh-notification-empty">{t.dashboard.topbar.notifications.empty}</div>
        ) : visibleEvents.map((event) => (
          <div key={event.id} className="rh-notification-event">
            <ActivityIcon tone={event.tone} />
            <div className="min-w-0 flex-1">
              <div className="rh-notification-event-title">{displayActivityTitle(event.title, t)}</div>
              <div className="rh-notification-event-detail">{event.detail}</div>
            </div>
            <div className="rh-notification-event-time">{formatEventTime(event.timestamp, locale)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UpdateStatusIcon({ phase }: { phase: UpdatePanelPhase }) {
  const iconClass = 'h-4 w-4';
  if (phase === 'checking' || phase === 'installing') return <Loader2 className={`${iconClass} animate-spin text-hydra-accent`} />;
  if (phase === 'available') return <Download className={`${iconClass} text-hydra-green`} />;
  if (phase === 'error') return <AlertTriangle className={`${iconClass} text-red-200`} />;
  if (phase === 'up-to-date') return <CheckCircle2 className={`${iconClass} text-hydra-green`} />;
  return <Bell className={`${iconClass} text-white/58`} />;
}

function updateNotificationText(state: UpdatePanelState, t: UiText, locale: string) {
  if (state.phase === 'idle') return t.dashboard.topbar.notifications.updateIdle;
  if (state.phase === 'checking') return t.settings.updates.checking;
  if (state.phase === 'installing') return t.settings.updates.installing;
  if (state.phase === 'up-to-date') return t.settings.updates.upToDate(state.report?.currentVersion);
  if (state.phase === 'available') return t.settings.updates.available(state.report?.version);
  return updateErrorText(state.error, locale);
}

function composeHomeRails(
  items: GameLibraryItem[],
  t: UiText
): { heroItem: GameLibraryItem | null; rails: HomeRail[] } {
  const ready = items.filter((item) => item.readyToPlay);
  const downloading = items.filter((item) => item.isDownloading || item.isPaused || item.hasError);
  const needsSetup = items.filter((item) => item.missingRequirements.length > 0);
  const heroItem = ready[0] ?? downloading[0] ?? items[0] ?? null;

  const rails: HomeRail[] = [
    {
      title: t.dashboard.rails.continuePlaying,
      testId: 'home-rail-ready',
      zone: 'ready',
      items: mergeRailItems(ready, [], 12)
    },
    {
      title: t.dashboard.rails.downloads,
      testId: 'home-rail-downloads',
      zone: 'downloads',
      items: mergeRailItems(downloading, [], 12)
    },
    {
      title: t.dashboard.rails.needsSetup,
      testId: 'home-rail-setup',
      zone: 'setup',
      items: mergeRailItems(needsSetup, [], 12)
    },
    {
      title: t.dashboard.rails.recentlyAdded,
      testId: 'home-rail-recent',
      zone: 'recent',
      items: mergeRailItems(items, [], 12)
    }
  ];

  return { heroItem, rails };
}

interface HomeScreenProps {
  loading: boolean;
  heroItem: GameLibraryItem | null;
  rails: HomeRail[];
  collectionItems: GameLibraryItem[];
  busyAction: BusyAction;
  onPrimaryAction: (item: GameLibraryItem) => void;
  onOpenDetails: (game: CatalogGame) => void;
  onOpenCollection: (target: CollectionTarget) => void;
  onOpenSettings: () => void;
  onFocus: (focusId: string) => void;
}

function HomeScreen({
  loading,
  heroItem,
  rails,
  collectionItems,
  busyAction,
  onPrimaryAction,
  onOpenDetails,
  onOpenCollection,
  onOpenSettings,
  onFocus
}: HomeScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rh-home-screen"
      data-testid="home-screen"
    >
      {loading ? (
        <HomeSkeleton />
      ) : (
        <>
          <HeroPanel
            heroItem={heroItem}
            busyAction={busyAction}
            onPrimaryAction={onPrimaryAction}
            onOpenDetails={onOpenDetails}
            onOpenSettings={onOpenSettings}
            onFocus={onFocus}
          />
          <HomeRailsPanel
            rails={rails}
            onPrimaryAction={onPrimaryAction}
            onOpenDetails={onOpenDetails}
            onFocus={onFocus}
          />
          <CollectionsPanel
            items={collectionItems}
            onOpenCollection={onOpenCollection}
            onFocus={onFocus}
          />
        </>
      )}
    </motion.div>
  );
}

function HomeSkeleton() {
  return (
    <div className="rh-home-skeleton" data-testid="home-skeleton" aria-hidden="true">
      <div className="sk-hero sk-block" />

      <div className="sk-toolbar">
        <div className="sk-chips">
          <span className="sk-chip sk-chip-active" />
          {Array.from({ length: 5 }).map((_, index) => (
            <span key={index} className="sk-chip sk-block" />
          ))}
        </div>
        <div className="sk-view-toggle">
          <span className="sk-view-btn sk-block" />
          <span className="sk-view-btn sk-block" />
        </div>
      </div>

      {[0, 1].map((rail) => (
        <div key={rail} className="sk-rail">
          <span className="sk-rail-label sk-block" />
          <div className="sk-rail-track">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="sk-card sk-block">
                <span className="sk-card-label" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="sk-bottom">
        <div className="sk-collections">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} className="sk-collection-card sk-block" />
          ))}
        </div>
        <div className="sk-filters-panel">
          <span className="sk-rail-label sk-block" />
          <div className="sk-filter-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} className="sk-filter-chip sk-block" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CollectionsScreen({
  items,
  onOpenCollection,
  onFocus
}: {
  items: GameLibraryItem[];
  onOpenCollection: (target: CollectionTarget) => void;
  onFocus: (focusId: string) => void;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rh-screen rh-panel" data-testid="collections-screen">
      <CollectionsPanel items={items} onOpenCollection={onOpenCollection} onFocus={onFocus} />
    </motion.section>
  );
}

function ExploreScreen({
  events,
  items,
  onOpenEvent,
  onFocus
}: {
  events: ReturnType<typeof useLauncherStore.getState>['activityEvents'];
  items: GameLibraryItem[];
  onOpenEvent: (event: ActivityEvent) => void;
  onFocus: (focusId: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rh-screen rh-panel" data-testid="explore-screen">
      <ScreenHeader eyebrow={t.dashboard.explore.eyebrow} title={t.dashboard.explore.title} description={t.dashboard.explore.description} />
      <div className="rh-explore-layout">
        <div className="rh-activity-list">
          {events.length === 0 ? (
            <div className="rh-empty-compact">{t.dashboard.explore.empty}</div>
          ) : events.slice(0, 12).map((event) => {
            const focusId = `activity:${encodeURIComponent(event.gameId ?? event.id)}`;
            return (
              <button
                key={event.id}
                data-focus-id={focusId}
                data-focus-zone="activity"
                onFocus={() => onFocus(focusId)}
                onClick={() => onOpenEvent(event)}
                className="rh-activity-row rh-focusable"
              >
                <ActivityIcon tone={event.tone} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{displayActivityTitle(event.title, t)}</div>
                  <div className="truncate text-xs text-white/42">{event.detail}</div>
                </div>
                <div className="ml-auto text-[10px] uppercase text-white/34">{formatEventTime(event.timestamp, locale)}</div>
              </button>
            );
          })}
        </div>
        <div className="rh-explore-stats">
          <div className="text-[10px] font-semibold text-white/42">{t.dashboard.explore.libraryStats}</div>
          <StatsLine label={t.dashboard.explore.games} value={String(items.length)} />
          <StatsLine label={t.dashboard.explore.ready} value={String(items.filter((item) => item.readyToPlay).length)} />
          <StatsLine label={t.dashboard.explore.downloads} value={String(items.filter((item) => item.isDownloading || item.isPaused || item.hasError).length)} />
        </div>
      </div>
    </motion.section>
  );
}

const LIBRARY_PAGE_SIZE = 60;

function LibraryScreen({
  items,
  allItems,
  totalCount,
  filter,
  query,
  sort,
  busyAction,
  onFilterChange,
  onQueryChange,
  onSortChange,
  onPrimaryAction,
  onOpenDetails,
  onFocus
}: {
  items: GameLibraryItem[];
  allItems: GameLibraryItem[];
  totalCount: number;
  filter: LibraryFilter;
  query: string;
  sort: LibrarySort;
  busyAction: BusyAction;
  onFilterChange: (filter: LibraryFilter) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onPrimaryAction: (item: GameLibraryItem) => void;
  onOpenDetails: (game: CatalogGame) => void;
  onFocus: (focusId: string) => void;
}) {
  const { t } = useI18n();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);

  // Reset the render window whenever the filtered/sorted/searched set changes.
  useEffect(() => {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }, [items]);

  // Grow the window as the bottom sentinel scrolls into view, so large catalogs
  // never mount thousands of cards at once (which froze the initial render).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= items.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + LIBRARY_PAGE_SIZE, items.length));
        }
      },
      { root: gridRef.current, rootMargin: '600px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, visibleCount]);

  const renderedItems = items.slice(0, visibleCount);

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rh-screen rh-panel" data-testid="library-screen">
      <ScreenHeader eyebrow={t.dashboard.library.eyebrow} title={t.dashboard.library.title} description={t.dashboard.library.description(items.length, totalCount)} />
      <div className="rh-library-toolbar">
        <div className="rh-library-search">
          <Search className="h-4 w-4 text-white/42" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t.dashboard.library.searchPlaceholder}
            data-testid="library-search"
          />
          {query && (
            <button onClick={() => onQueryChange('')} className="rh-search-clear" title={t.dashboard.library.clearSearch}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as LibrarySort)}
          className="rh-library-sort"
          aria-label={t.dashboard.library.sortAria}
          data-testid="library-sort"
        >
          {SORTS.map((item) => (
            <option key={item} value={item}>{t.dashboard.sorts[item]}</option>
          ))}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" data-testid="library-filters">
        {FILTERS.map((item) => {
          const count = filterCountLabel(item, totalCount, allItems);
          return (
            <button
              key={item}
              data-focus-id={`filter:${item}`}
              data-focus-zone="library-filters"
              onFocus={() => onFocus(`filter:${item}`)}
              onClick={() => onFilterChange(item)}
              className={`rh-filter-chip rh-focusable ${filter === item ? 'rh-filter-chip-active' : ''}`}
            >
              {t.dashboard.filters[item]}
              <span>{count}</span>
            </button>
          );
        })}
      </div>
      <div ref={gridRef} className="rh-library-grid" data-testid="library-grid">
        {items.length === 0 ? (
          <div className="rh-empty-compact" data-testid="library-empty">{t.dashboard.library.empty}</div>
        ) : (
          <>
            {renderedItems.map((item) => (
              <GamePoster
                key={item.game.id}
                item={item}
                focusId={`game:library:${encodeURIComponent(item.game.id)}`}
                zone="library"
                selected={busyAction?.endsWith(item.game.id)}
                onOpen={onOpenDetails}
                onAction={onPrimaryAction}
                onFocus={onFocus}
              />
            ))}
            {visibleCount < items.length && (
              <div ref={sentinelRef} className="rh-library-sentinel" aria-hidden="true" data-testid="library-sentinel" />
            )}
          </>
        )}
      </div>
    </motion.section>
  );
}

function DownloadsScreen({
  downloads,
  itemsByGameId,
  busyAction,
  onOpenDetails,
  onPause,
  onResume,
  onCancel,
  onPlay,
  onFocus
}: {
  downloads: TorrentDownloadRecord[];
  itemsByGameId: Map<string, GameLibraryItem>;
  busyAction: BusyAction;
  onOpenDetails: (game: CatalogGame) => void;
  onPause: (gameId: string) => Promise<void>;
  onResume: (gameId: string) => Promise<void>;
  onCancel: (gameId: string) => Promise<void>;
  onPlay: (item: GameLibraryItem) => void;
  onFocus: (focusId: string) => void;
}) {
  const { t } = useI18n();
  const summary = summarizeDownloads(downloads);
  const description = summary.active > 0
    ? t.dashboard.downloads.activeDescription(downloads.length)
    : t.dashboard.downloads.idleDescription(downloads.length);

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rh-screen rh-panel">
      <div className="rh-downloads-center" data-testid="downloads-center">
        <ScreenHeader eyebrow={t.dashboard.downloads.eyebrow} title={t.dashboard.downloads.title} description={description} />
        <div className="rh-download-summary">
          <DownloadMetric label={t.dashboard.downloads.active} value={String(summary.active)} tone="active" />
          <DownloadMetric label={t.dashboard.downloads.paused} value={String(summary.paused)} tone="paused" />
          <DownloadMetric label={t.dashboard.downloads.errors} value={String(summary.errors)} tone="error" />
          <DownloadMetric label={t.dashboard.downloads.downloaded} value={formatBytes(summary.downloadedBytes)} tone="ready" />
        </div>
        <div className="rh-download-list">
          {downloads.length === 0 ? (
            <div className="rh-empty-compact">{t.dashboard.downloads.empty}</div>
          ) : downloads.map((download) => {
            const item = itemsByGameId.get(download.gameId) ?? null;
            return (
              <DownloadRow
                key={download.gameId}
                download={download}
                item={item}
                busyAction={busyAction}
                onOpenDetails={onOpenDetails}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onPlay={onPlay}
                onFocus={onFocus}
              />
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

function DownloadRow({
  download,
  item,
  busyAction,
  onOpenDetails,
  onPause,
  onResume,
  onCancel,
  onPlay,
  onFocus
}: {
  download: TorrentDownloadRecord;
  item: GameLibraryItem | null;
  busyAction: BusyAction;
  onOpenDetails: (game: CatalogGame) => void;
  onPause: (gameId: string) => Promise<void>;
  onResume: (gameId: string) => Promise<void>;
  onCancel: (gameId: string) => Promise<void>;
  onPlay: (item: GameLibraryItem) => void;
  onFocus: (focusId: string) => void;
}) {
  const { t } = useI18n();
  const active = ACTIVE_DOWNLOAD_STATUSES.includes(download.status);
  const resumable = RESUMABLE_DOWNLOAD_STATUSES.includes(download.status);
  const cancellable = !['completed', 'cancelled', 'cancelling'].includes(download.status);
  const statusHint = downloadStatusHint(download, t);

  return (
    <article className="rh-download-row" data-testid="download-row">
      <button
        data-focus-id={`details:${encodeURIComponent(download.gameId)}`}
        data-focus-zone="downloads"
        onFocus={() => onFocus(`details:${encodeURIComponent(download.gameId)}`)}
        onClick={() => item && onOpenDetails(item.game)}
        className="rh-download-art rh-focusable"
      >
        {item ? <GameArt game={item.game} className="h-full w-full" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-black">{item?.game.title ?? download.gameId}</div>
          <span className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-white/54">{t.gameDetails.downloadTitles[download.status]}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-black/42">
          <div className="h-full rounded bg-hydra-accent" style={{ width: `${download.status === 'completed' ? 100 : download.progressPercent}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-white/42">
          <span>{formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}</span>
          <span>{formatSpeed(download.downloadSpeedBytesPerSec)}</span>
          <span>{download.peersCount} {t.common.peers}</span>
        </div>
        {download.saveDir && <div className="mt-2 truncate text-xs text-white/32">{download.saveDir}</div>}
        {statusHint && <div className="mt-2 text-xs text-white/42">{statusHint}</div>}
        {download.errorMessage && <div className="mt-2 text-xs text-red-100">{download.errorMessage}</div>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {active && download.status !== 'cancelling' && (
          <IconAction
            focusId={`download-action:pause:${encodeURIComponent(download.gameId)}`}
            onFocus={onFocus}
            busy={busyAction === `pause:${download.gameId}`}
            label={t.dashboard.downloads.pause}
            icon={<Pause className="h-3.5 w-3.5" />}
            onClick={() => onPause(download.gameId)}
          />
        )}
        {resumable && (
          <IconAction
            focusId={`download-action:${download.status === 'error' ? 'retry' : 'resume'}:${encodeURIComponent(download.gameId)}`}
            onFocus={onFocus}
            busy={busyAction === `resume:${download.gameId}`}
            label={download.status === 'error' ? t.dashboard.downloads.retry : t.dashboard.downloads.resume}
            icon={<RotateCw className="h-3.5 w-3.5" />}
            onClick={() => onResume(download.gameId)}
          />
        )}
        {item?.readyToPlay && download.status === 'completed' && (
          <IconAction
            focusId={`download-action:play:${encodeURIComponent(download.gameId)}`}
            onFocus={onFocus}
            busy={busyAction === `play:${download.gameId}`}
            label={t.dashboard.downloads.play}
            icon={<Play className="h-3.5 w-3.5" />}
            onClick={() => onPlay(item)}
          />
        )}
        {cancellable && (
          <IconAction
            focusId={`download-action:cancel:${encodeURIComponent(download.gameId)}`}
            onFocus={onFocus}
            busy={busyAction === `cancel:${download.gameId}`}
            label={t.dashboard.downloads.cancel}
            icon={<Ban className="h-3.5 w-3.5" />}
            onClick={() => onCancel(download.gameId)}
            danger
          />
        )}
      </div>
    </article>
  );
}

function IconAction({
  label,
  icon,
  busy,
  danger,
  focusId,
  onFocus,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  danger?: boolean;
  focusId: string;
  onFocus: (focusId: string) => void;
  onClick: () => void;
}) {
  return (
    <button
      data-focus-id={focusId}
      data-focus-zone="download-actions"
      onFocus={() => onFocus(focusId)}
      onClick={onClick}
      className={`rh-mini-action rh-focusable ${danger ? 'rh-mini-action-danger' : ''}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function ScreenHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-5">
      <div className="text-sm font-semibold text-hydra-accent">{eyebrow}</div>
      <h1 className="mt-2 text-3xl font-bold tracking-normal">{title}</h1>
      <p className="mt-1 text-sm text-white/46">{description}</p>
    </header>
  );
}

function ActivityIcon({ tone }: { tone: ActivityEvent['tone'] }) {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10">
      {tone === 'success' ? (
        <CheckCircle2 className="h-4 w-4 text-hydra-green" />
      ) : tone === 'error' ? (
        <AlertTriangle className="h-4 w-4 text-red-200" />
      ) : tone === 'warning' ? (
        <ShieldAlert className="h-4 w-4 text-amber-200" />
      ) : (
        <Activity className="h-4 w-4 text-white/60" />
      )}
    </div>
  );
}

function StatsLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex items-center justify-between text-xs">
      <span className="text-white/48">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function displayActivityTitle(title: string, t: UiText) {
  if (title === 'Download completed') return t.dashboard.messages.downloadCompleted;
  return title;
}

function normalizeUpdateCheckError(error: unknown): UpdateCheckError {
  if (isUpdateCheckError(error)) return error;
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = String((error as { kind?: unknown }).kind);
    if (kind === 'endpointUnreachable' || kind === 'parseError' || kind === 'signatureInvalid') {
      const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : undefined;
      return { kind, message };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'parseError', message };
}

function isUpdateCheckError(error: unknown): error is UpdateCheckError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'kind' in error &&
    ['endpointUnreachable', 'parseError', 'signatureInvalid'].includes(String((error as { kind?: unknown }).kind))
  );
}

function formatEventTime(timestamp: string, locale: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0.00 MB/s';
  return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
}

function formatClock(date: Date, locale: string) {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function filterCountLabel(filter: LibraryFilter, totalCount: number, allItems: GameLibraryItem[]) {
  if (filter === 'all') return totalCount;
  return filterLibraryItems(allItems, filter).length;
}

function summarizeDownloads(downloads: TorrentDownloadRecord[]) {
  return downloads.reduce((summary, download) => {
    if (ACTIVE_DOWNLOAD_STATUSES.includes(download.status)) summary.active += 1;
    if (download.status === 'paused' || download.status === 'interrupted') summary.paused += 1;
    if (download.status === 'error') summary.errors += 1;
    summary.downloadedBytes += download.downloadedBytes;
    return summary;
  }, {
    active: 0,
    paused: 0,
    errors: 0,
    downloadedBytes: 0
  });
}

function downloadStatusHint(download: TorrentDownloadRecord, t: UiText) {
  if (download.status === 'interrupted') return t.dashboard.downloads.statusHints.interrupted;
  if (download.status === 'paused') return t.dashboard.downloads.statusHints.paused;
  if (download.status === 'resolving') return t.dashboard.downloads.statusHints.resolving;
  if (download.status === 'cancelling') return t.dashboard.downloads.statusHints.cancelling;
  if (download.status === 'cancelled') return t.dashboard.downloads.statusHints.cancelled;
  if (download.status === 'error' && !download.errorMessage) return t.dashboard.downloads.statusHints.error;
  return null;
}

function DownloadMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: 'active' | 'paused' | 'error' | 'ready';
}) {
  return (
    <div className={`rh-download-metric rh-download-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }

  return value.replace(/"/g, '\\"');
}
