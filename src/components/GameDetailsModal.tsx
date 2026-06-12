'use client';

import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import {
  Ban,
  DatabaseZap,
  Download as DownloadIcon,
  Loader2,
  Pause,
  Play,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  X
} from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { LaunchErrorModal } from '@/components/LaunchErrorModal';
import { InstallProgressOverlay } from '@/components/InstallProgressOverlay';
import { GameArt } from '@/components/shell/GamePoster';
import { useDownloadState } from '@/hooks/useDownloadState';
import { api } from '@/lib/api';
import { displayProductText } from '@/lib/brandText';
import { isDirectGameDownload } from '@/lib/downloadActions';
import { normalizeLaunchFailure } from '@/lib/launchErrors';
import { useInstallGame } from '@/lib/orchestratorApi';
import { defaultSaveDirForGame } from '@/lib/paths';
import { getEmulatorConfig, getEmulatorPath, type AppSettings } from '@/lib/settings';
import { isTauriRuntime } from '@/lib/runtime';
import type {
  CatalogGame,
  GameSetupState,
  GameSetupSystemFileState,
  LaunchFailure,
  RequirementItem,
  RequirementsReport,
  ScrapeCandidate,
  ScrapeState,
} from '@/types/repository';

interface GameDetailsModalProps {
  game: CatalogGame;
  settings: AppSettings;
  onClose: () => void;
  onOpenSettings: () => void;
  onRefresh: () => Promise<void>;
}

export function GameDetailsModal({
  game,
  settings,
  onClose,
  onOpenSettings,
  onRefresh
}: GameDetailsModalProps) {
  const { t } = useI18n();
  const [requirements, setRequirements] = useState<RequirementsReport | null>(null);
  const [setupState, setSetupState] = useState<GameSetupState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showSetupDetails, setShowSetupDetails] = useState(false);
  const [defaultSaveDir, setDefaultSaveDir] = useState<string | null>(null);
  const [launchFailure, setLaunchFailure] = useState<LaunchFailure | null>(null);
  const [scrapeState, setScrapeState] = useState<ScrapeState | null>(null);
  const download = useDownloadState(game.id);
  const orchestrator = useInstallGame(game.id);
  const userProvidedGame = isUserProvidedGame(game);
  const metadataOnlyGame = game.contentMode === 'metadata_only';
  const emulatorPath = getEmulatorPath(settings, game.platform);
  const emulatorConfig = getEmulatorConfig(settings, game.platform);
  const emulatorReady = setupState
    ? setupState.emulator.status === 'ready'
    : Boolean(emulatorPath) && (emulatorConfig?.status ?? 'valid') === 'valid';
  const systemFilesReady = setupState
    ? setupState.systemFiles.every((item) => !item.required || item.status === 'ready')
      && setupState.repositoryRequirements.every((item) => item.status === 'ready' && item.trusted)
    : requirements
      ? requirements.requirements.every((item) => item.status === 'ready' && item.trusted)
      : false;

  const downloadableSource = useMemo(
    () => userProvidedGame || metadataOnlyGame
      ? null
      : game.downloads.find((source) => source.kind === 'magnet' || source.kind === 'http' || source.kind === 'bundled') ?? null,
    [game.downloads, metadataOnlyGame, userProvidedGame]
  );

  const loadRequirements = async () => {
    try {
      const setup = await api.getGameSetupState(game.id);
      setSetupState(setup);
      setRequirements({
        gameId: setup.gameId,
        ready: setup.launch.status === 'ready',
        gameDownloaded: setup.gameFile.status === 'ready',
        requirements: setup.repositoryRequirements
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const loadScrapeState = async () => {
    try {
      setScrapeState(await api.getScrapeState(game.id));
    } catch {
      setScrapeState(null);
    }
  };

  useEffect(() => {
    loadRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  useEffect(() => {
    let cancelled = false;
    void api.getScrapeState(game.id)
      .then((state) => {
        if (!cancelled) setScrapeState(state);
      })
      .catch(() => {
        if (!cancelled) setScrapeState(null);
      });

    if (!isTauriRuntime()) {
      return () => {
        cancelled = true;
      };
    }

    let cleanup: (() => void) | undefined;
    void Promise.all([
      listen<{ gameId: string }>('metadata:ready', (event) => {
        if (event.payload.gameId === game.id) void loadScrapeState();
      }),
      listen<{ gameId: string }>('metadata:state', (event) => {
        if (event.payload.gameId === game.id) void loadScrapeState();
      }),
      listen<{ gameId: string }>('metadata:ambiguous', (event) => {
        if (event.payload.gameId === game.id) void loadScrapeState();
      })
    ]).then((unlisteners) => {
      if (cancelled) {
        unlisteners.forEach((unlisten) => unlisten());
        return;
      }
      cleanup = () => unlisteners.forEach((unlisten) => unlisten());
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    setDefaultSaveDir(null);

    const resolveSaveDir = async () => {
      try {
        const resolvedSaveDir = await defaultSaveDirForGame(game.id);
        if (!cancelled) {
          setDefaultSaveDir(resolvedSaveDir);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(t.gameDetails.messages.resolveDownloadFolderFailed(error));
        }
      }
    };

    void resolveSaveDir();

    return () => {
      cancelled = true;
    };
  }, [game.id]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
      await loadRequirements();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runDownloadAction = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
      await download.refresh();
      await loadRequirements();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (userProvidedGame || metadataOnlyGame) {
      setMessage(t.gameDetails.messages.importLocalGame);
      return;
    }
    if (!downloadableSource) {
      setMessage(t.gameDetails.messages.noAutomaticSource);
      return;
    }

    await runDownloadAction('download', () => api.startGameDownload(game.id));
  };

  const handleInstall = async () => {
    setMessage(null);
    try {
      const result = await orchestrator.install();
      if (result.status === 'ready') {
        setMessage(t.gameDetails.messages.installComplete);
      } else {
        setShowSetupDetails(true);
        setMessage(result.message ?? result.errorCode ?? t.gameDetails.messages.installNeedsAttention);
      }
      await download.refresh();
      await loadRequirements();
      await onRefresh();
    } catch (error) {
      setShowSetupDetails(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleImportGame = async () => {
    const importPath = isTauriRuntime()
      ? await open({
        title: `${t.common.import} ${game.title}`,
        multiple: false,
        directory: false
      })
      : `F:\\Fusion\\Fixtures\\${game.id}${game.expectedExtensions[0] ?? '.rom'}`;
    if (typeof importPath !== 'string') return;

    await runDownloadAction('import-game', async () => {
      const report = await api.importGameFile(game.id, importPath);
      if (report.status === 'error') {
        throw new Error(t.gameDetails.messages.importFailed(report.errorCode));
      }
      setMessage(report.status === 'already_installed' ? t.gameDetails.messages.gameAlreadyInstalled : t.gameDetails.messages.gameImported);
    });
  };

  const handleImportAsset = async (item: RequirementItem) => {
    if (!isTauriRuntime()) {
      setMessage(t.gameDetails.messages.assetImportDesktopOnly);
      return;
    }

    setBusy(`asset:${item.asset.id}`);
    setMessage(null);
    try {
      const selected = await open({
        title: `${t.common.import} ${item.asset.displayName}`,
        multiple: false,
        directory: false
      });
      if (typeof selected !== 'string') return;

      const report = await api.importAssetFile(item.asset.id, selected);
      if (report.status === 'error') {
        setMessage(t.gameDetails.messages.importFailed(report.errorCode));
      } else {
        setMessage(report.status === 'already_installed' ? t.gameDetails.messages.assetAlreadyInstalled : t.gameDetails.messages.assetImported);
      }
      await loadRequirements();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const handleInstallProfileEmulator = async () => {
    if (!setupState?.profileId) {
      onOpenSettings();
      return;
    }
    await run('profile-emulator', () => api.installProfileEmulator(setupState.profileId ?? ''));
  };

  const handleSelectProfileEmulator = async () => {
    if (!setupState?.profileId) {
      onOpenSettings();
      return;
    }
    const selected = isTauriRuntime()
      ? await open({
        title: `${t.common.select} ${setupState.emulator.emulatorName}`,
        multiple: false,
        directory: false,
        filters: [{ name: t.gameDetails.selectExecutable, extensions: ['exe'] }]
      })
      : `F:\\Fusion\\Emulators\\${setupState.profileId}.exe`;
    if (typeof selected !== 'string') return;
    await run('profile-emulator', () => api.selectProfileEmulator(setupState.profileId ?? '', selected));
  };

  const handleImportProfileSystemFile = async (item: GameSetupSystemFileState) => {
    if (!setupState?.profileId) return;
    const selected = isTauriRuntime()
      ? await open({
        title: `${t.common.import} ${item.label}`,
        multiple: false,
        directory: false,
        filters: item.expectedExtensions.length > 0
          ? [{ name: item.label, extensions: item.expectedExtensions.map((extension) => extension.replace(/^\./, '')) }]
          : undefined
      })
      : `F:\\Fusion\\System\\${item.id}${item.expectedExtensions[0] ?? '.bin'}`;
    if (typeof selected !== 'string') return;
    await run(`profile-file:${item.id}`, async () => {
      const report = await api.importProfileSystemFile(game.id, item.id, selected);
      if (report.status === 'error') {
        throw new Error(t.gameDetails.messages.importFailed(report.errorCode));
      }
      setMessage(report.status === 'already_installed' ? t.gameDetails.messages.systemFileAlreadyInstalled : t.gameDetails.messages.systemFileImported);
    });
  };

  const handleRescrape = async () => {
    setBusy('metadata');
    setMessage(null);
    try {
      await api.scrapeGame(game.id);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await loadScrapeState();
      setBusy(null);
    }
  };

  const handleApplyCandidate = async (candidate: ScrapeCandidate) => {
    setBusy(`metadata:${candidate.providerGameId}`);
    setMessage(null);
    try {
      await api.applyScrapeOverride(game.id, candidate.providerGameId);
      await loadScrapeState();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const handleClearMetadataOverride = async () => {
    setBusy('metadata-clear');
    setMessage(null);
    try {
      await api.clearScrapeOverride(game.id);
      await loadScrapeState();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const handlePlay = async () => {
    const saveDir = download.saveDir ?? defaultSaveDir;
    if (!saveDir) {
      setMessage(t.gameDetails.messages.downloadFolderNotReady);
      return;
    }

    setBusy('launch');
    setMessage(null);
    setLaunchFailure(null);
    try {
      await api.launchGame(game.id);
      setMessage(t.gameDetails.messages.launchSent);
    } catch (error) {
      setLaunchFailure(normalizeLaunchFailure(error, game));
    } finally {
      setBusy(null);
    }
  };

  const saveDir = download.saveDir ?? defaultSaveDir;
  const status = download.status;
  const progressPercent = (download.canPlay ? 100 : download.progressPercent).toFixed(1);
  const statusMessage = message ?? download.errorMessage;
  const showDownloadPanel = download.isLoading || (status !== null && status !== 'cancelled');
  const canDownload = !download.isLoading && (status === null || status === 'cancelled');
  const gameFileReady = setupState ? setupState.gameFile.status === 'ready' : download.canPlay;
  const launchReady = setupState ? setupState.launch.status === 'ready' : Boolean(requirements?.ready);
  const canPlay = gameFileReady && launchReady && Boolean(saveDir) && busy === null;
  const downloadTitle = download.isLoading
    ? t.gameDetails.downloadTitles.checking
    : status
      ? t.gameDetails.downloadTitles[status]
      : t.gameDetails.downloadTitles.idle;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/78 px-5 backdrop-blur-xl">
      <section data-testid="game-details-modal" className="relative max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/12 bg-fusion-surface/95 shadow-[0_40px_120px_rgba(0,0,0,0.72)]">
        <header className="flex items-start gap-4 border-b border-white/10 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold">{displayProductText(game.title)}</h2>
            <div className="mt-1 text-sm text-white/46">{game.platform} / {displayProductText(game.repositoryName)}</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:border-hydra-accent/40 hover:bg-hydra-accent/10 hover:text-white"
            title={t.gameDetails.closeTitle}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-[210px_1fr] gap-5 p-5">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-fusion-raised">
            <div className="aspect-[3/4]">
              <GameArt game={game} className="h-full w-full" />
            </div>
          </div>

          <div className="min-w-0">
            {game.description && (
              <p className="mb-5 text-sm leading-6 text-white/66">{displayProductText(game.description)}</p>
            )}
            {game.metadata && (
              <div className="mb-5 flex flex-wrap gap-2 text-[11px] font-bold uppercase text-white/50">
                {game.metadata.releaseYear && <span className="rounded border border-white/10 px-2 py-1">{game.metadata.releaseYear}</span>}
                {game.metadata.genres?.slice(0, 2).map((genre) => (
                  <span key={genre} className="rounded border border-white/10 px-2 py-1">{genre}</span>
                ))}
                {game.metadata.developer && <span className="rounded border border-white/10 px-2 py-1">{game.metadata.developer}</span>}
                {game.metadata.players && <span className="rounded border border-white/10 px-2 py-1">{game.metadata.players}</span>}
              </div>
            )}

            <MetadataScrapePanel
              state={scrapeState}
              busy={busy}
              onRescrape={handleRescrape}
              onApplyCandidate={handleApplyCandidate}
              onClearOverride={handleClearMetadataOverride}
            />

            {showSetupDetails && (
              <>
            <div className="mb-5 grid gap-2" data-testid="setup-checklist">
              <SetupRow
                label={t.gameDetails.setup.emulator}
                detail={emulatorReady
                  ? setupState?.emulator.executablePath ?? emulatorPath
                  : setupState?.emulator.message ?? t.gameDetails.setup.configureEmulator(game.platform.toUpperCase())}
                ready={emulatorReady}
                actionLabel={emulatorReady
                  ? undefined
                  : setupState?.emulator.installMode === 'downloadable'
                    ? t.common.install
                    : t.gameDetails.setup.choose}
                onAction={setupState?.emulator.installMode === 'downloadable'
                  ? () => void handleInstallProfileEmulator()
                  : () => void handleSelectProfileEmulator()}
                disabled={busy !== null || emulatorReady}
              />
              <SetupRow
                label={t.gameDetails.setup.systemFiles}
                detail={setupState
                  ? t.gameDetails.setup.neededFiles(setupState.systemFiles.filter((item) => item.required).length + setupState.repositoryRequirements.length)
                  : requirements?.requirements.length ? t.gameDetails.setup.neededFiles(requirements.requirements.length) : t.gameDetails.setup.noExtraFiles}
                ready={systemFilesReady}
                actionLabel={t.gameDetails.setup.check}
                onAction={() => void loadRequirements()}
                disabled={busy !== null}
              />
              <SetupRow
                label={t.gameDetails.setup.gameFile}
                detail={gameFileReady
                  ? setupState?.gameFile.installedPath ?? saveDir ?? t.gameDetails.setup.imported
                  : userProvidedGame ? t.gameDetails.setup.importGameFile : t.gameDetails.setup.needsDownload}
                ready={gameFileReady}
                actionLabel={gameFileReady ? undefined : userProvidedGame ? t.common.import : t.common.download}
                onAction={userProvidedGame ? () => void handleImportGame() : () => void handleDownload()}
                disabled={busy !== null || gameFileReady}
                testId="setup-game-file-row"
              />
              <SetupRow
                label={t.gameDetails.setup.launch}
                detail={launchReady ? t.common.ready : setupState?.launch.blockers[0] ?? t.gameDetails.setup.finishSetupFirst}
                ready={launchReady}
                actionLabel={t.gameDetails.setup.check}
                onAction={() => void loadRequirements()}
                disabled={busy !== null}
              />
            </div>

            <div className="mb-5 space-y-2">
              {(setupState?.systemFiles || []).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md bg-black/22 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{item.label}</div>
                    <div className="mt-1 truncate text-xs text-white/38">
                      {assetKindLabel(item.assetKind, t)} / {item.status === 'ready' ? item.installedPath ?? t.common.ready : item.message ?? t.common.missing}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status === 'ready' ? (
                      <ShieldCheck className="h-4 w-4 text-hydra-green" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-200" />
                    )}
                    <button
                      onClick={() => void handleImportProfileSystemFile(item)}
                      disabled={busy !== null || item.status === 'ready'}
                      className="h-8 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {busy === `profile-file:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.common.import}
                    </button>
                  </div>
                </div>
              ))}
              {(requirements?.requirements || []).map((item) => (
                <div key={item.asset.id} className="flex items-center justify-between gap-3 rounded-md bg-black/22 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{item.asset.displayName}</div>
                    <div className="mt-1 text-xs text-white/38">
                      {item.asset.assetKind} / {requirementStatusLabel(item.status, t)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status === 'ready' ? (
                      <ShieldCheck className="h-4 w-4 text-hydra-green" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-200" />
                    )}
                    <button
                      onClick={() => {
                        if (isUserProvidedRequirement(item)) {
                          void handleImportAsset(item);
                          return;
                        }
                        void run(`asset:${item.asset.id}`, () => (
                          item.status === 'corrupt' || item.status === 'error'
                            ? api.redownloadAsset(item.asset.id)
                            : api.downloadAsset(item.asset.id)
                        ));
                      }}
                      disabled={busy !== null || item.status === 'ready'}
                      className="h-8 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {busy === `asset:${item.asset.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isUserProvidedRequirement(item) ? t.common.import : item.status === 'corrupt' || item.status === 'error' ? t.common.retry : t.common.download}
                    </button>
                    {item.asset.executable && item.downloaded && !item.trusted && (
                      <button
                        onClick={() => run(`trust:${item.asset.id}`, () => api.trustExecutable(item.asset.id))}
                        disabled={busy !== null}
                        className="h-8 rounded-lg bg-hydra-accent px-3 text-xs font-bold text-fusion-accentOn transition hover:bg-fusion-accentHover disabled:opacity-40"
                      >
                        {t.gameDetails.setup.trust}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
              </>
            )}

            {statusMessage && (
              <div className="mb-4 rounded-md border border-amber-300/24 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                {statusMessage}
              </div>
            )}

            <div className="space-y-3">
              {showDownloadPanel ? (
                <div className="rounded-md border border-white/10 bg-white/[0.06] px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-white/80">{downloadTitle}</span>
                    <span className="text-xs text-white/50">{progressPercent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded bg-black/35">
                    <div
                      className={`h-full rounded transition-[width] duration-500 ${download.hasError ? 'bg-red-400' : 'bg-hydra-green'}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                    <span>{formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}</span>
                    <span>{formatSpeed(download.downloadSpeedBytesPerSec)}</span>
                    <span>{download.peersCount} {t.common.peers}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status === 'downloading' && (
                      <button
                        onClick={() => runDownloadAction('pause', download.pause)}
                        disabled={busy !== null}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
                      >
                        {busy === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                        {t.gameDetails.downloadActions.pause}
                      </button>
                    )}
                    {(status === 'paused' || status === 'interrupted' || status === 'error') && (
                      <button
                        onClick={() => runDownloadAction(
                          status === 'error' ? 'retry' : 'resume',
                          status === 'error' && isDirectGameDownload(game, download.record)
                            ? () => api.startGameDownload(game.id)
                            : download.resume
                        )}
                        disabled={busy !== null}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
                      >
                        {busy === (status === 'error' ? 'retry' : 'resume') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                        {status === 'error' ? t.gameDetails.downloadActions.retry : t.gameDetails.downloadActions.resume}
                      </button>
                    )}
                    {(status === 'resolving' || status === 'downloading' || status === 'paused' || status === 'interrupted' || status === 'error') && (
                      <button
                        onClick={() => runDownloadAction('cancel', download.cancel)}
                        disabled={busy !== null}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-red-300/20 px-3 text-xs font-semibold text-red-100/80 transition hover:bg-red-300/10 disabled:opacity-40"
                      >
                        {busy === 'cancel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                        {t.gameDetails.downloadActions.cancel}
                      </button>
                    )}
                  </div>
                </div>
              ) : userProvidedGame ? (
                <button
                  data-testid="import-game-file"
                  onClick={() => void handleImportGame()}
                  disabled={busy !== null || metadataOnlyGame}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/76 transition hover:bg-white/12 disabled:opacity-40"
                >
                  {busy === 'import-game' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
                  {t.gameDetails.setup.importGameFile}
                </button>
              ) : (
                <button
                  onClick={() => void handleInstall()}
                  disabled={!canDownload || !downloadableSource || busy !== null || orchestrator.running}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/76 transition hover:bg-white/12 disabled:opacity-40"
                >
                  {orchestrator.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
                  {downloadableSource ? t.common.install : t.gameDetails.setup.manualSource}
                </button>
              )}

              {status === 'completed' && !launchReady && !userProvidedGame && (
                <button
                  onClick={() => void handleInstall()}
                  disabled={busy !== null || orchestrator.running}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/76 transition hover:bg-white/12 disabled:opacity-40"
                >
                  {orchestrator.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
                  {t.gameDetails.setup.finishSetup}
                </button>
              )}

              <button
                onClick={handlePlay}
                disabled={!canPlay}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-hydra-accent px-4 text-sm font-bold text-fusion-accentOn shadow-glow transition hover:bg-fusion-accentHover disabled:opacity-40"
              >
                {busy === 'launch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {t.gameDetails.setup.play}
              </button>
              <button
                onClick={() => setShowSetupDetails((current) => !current)}
                disabled={orchestrator.running}
                className="ml-2 inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
              >
                {showSetupDetails ? t.gameDetails.setup.hideDetails : t.gameDetails.setup.details}
              </button>
              {(download.canPlay || status === 'completed') && (
                <button
                  onClick={() => runDownloadAction('open-folder', () => api.openGameFolder(game.id))}
                  disabled={busy !== null}
                  className="ml-2 inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
                >
                  {t.gameDetails.setup.openFolder}
                </button>
              )}
              {(download.canPlay || status === 'completed' || status === 'cancelled') && (
                <button
                  onClick={() => {
                    if (window.confirm(t.gameDetails.messages.removeConfirm(displayProductText(game.title)))) {
                      void runDownloadAction('remove', () => api.removeGame(game.id, true));
                    }
                  }}
                  disabled={busy !== null}
                  className="ml-2 inline-flex h-10 items-center gap-2 rounded-md border border-red-300/20 px-4 text-sm font-semibold text-red-100/80 transition hover:bg-red-300/10 disabled:opacity-40"
                >
                  {t.gameDetails.setup.deleteFiles}
                </button>
              )}
            </div>
          </div>
        </div>
        {orchestrator.running && orchestrator.progress && (
          <InstallProgressOverlay progress={orchestrator.progress} />
        )}
      </section>

      {launchFailure && (
        <LaunchErrorModal
          failure={launchFailure}
          onClose={() => setLaunchFailure(null)}
          onOpenSettings={() => {
            setLaunchFailure(null);
            onOpenSettings();
          }}
          onOpenDetails={() => setLaunchFailure(null)}
          onRetryDownload={() => {
            setLaunchFailure(null);
            void handleDownload();
          }}
        />
      )}
    </div>
  );
}

function requirementStatusLabel(status: RequirementsReport['requirements'][number]['status'], t: ReturnType<typeof useI18n>['t']) {
  switch (status) {
    case 'ready':
      return t.gameDetails.requirementStatus.ready;
    case 'corrupt':
      return t.gameDetails.requirementStatus.corrupt;
    case 'blocked':
      return t.gameDetails.requirementStatus.blocked;
    case 'error':
      return t.gameDetails.requirementStatus.error;
    default:
      return t.gameDetails.requirementStatus.missing;
  }
}

function assetKindLabel(kind: string, t: ReturnType<typeof useI18n>['t']) {
  if (kind === 'keys') return t.gameDetails.assetKind.keys;
  if (kind === 'firmware') return t.gameDetails.assetKind.firmware;
  if (kind === 'bios') return t.gameDetails.assetKind.bios;
  if (kind === 'runtime') return t.gameDetails.assetKind.runtime;
  return kind;
}

function isUserProvidedRequirement(item: RequirementItem) {
  return item.asset.sources[0]?.kind === 'user_provided';
}

function isUserProvidedGame(game: CatalogGame) {
  return game.contentMode === 'user_provided' || game.downloads.some((source) => source.kind === 'user_provided');
}

function MetadataScrapePanel({
  state,
  busy,
  onRescrape,
  onApplyCandidate,
  onClearOverride
}: {
  state: ScrapeState | null;
  busy: string | null;
  onRescrape: () => Promise<void>;
  onApplyCandidate: (candidate: ScrapeCandidate) => Promise<void>;
  onClearOverride: () => Promise<void>;
}) {
  const status = state?.status ?? 'pending';
  const active = busy === 'metadata' || busy === 'metadata-clear' || busy?.startsWith('metadata:');

  return (
    <div className="mb-5 rounded-md border border-white/10 bg-white/[0.045] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-white/82">
            <DatabaseZap className="h-4 w-4 text-hydra-accent" />
            Metadata
          </div>
          <div className="mt-1 text-xs text-white/42">
            {scrapeStatusLabel(status, state?.matchKind, state?.message)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRescrape()}
          disabled={active}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
        >
          {busy === 'metadata' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
          Re-scrape
        </button>
        {state?.matchKind === 'override' && (
          <button
            type="button"
            onClick={() => void onClearOverride()}
            disabled={active}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
          >
            {busy === 'metadata-clear' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Clear override
          </button>
        )}
      </div>

      {state?.status === 'ambiguous' && state.candidates.length > 0 && (
        <div className="mt-3 grid gap-2">
          {state.candidates.map((candidate) => (
            <div key={candidate.providerGameId} className="flex items-center justify-between gap-3 rounded-md bg-black/22 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-bold text-white/80">{candidate.title}</div>
                <div className="mt-1 truncate text-white/38">
                  {[candidate.releaseYear, candidate.developer, candidate.platform].filter(Boolean).join(' / ') || candidate.provider}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onApplyCandidate(candidate)}
                disabled={active}
                className="h-8 shrink-0 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
              >
                {busy === `metadata:${candidate.providerGameId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function scrapeStatusLabel(status: ScrapeState['status'], matchKind?: string | null, message?: string | null) {
  if (message) return message;
  if (status === 'ready') return matchKind === 'hash' ? 'Matched by ROM hash.' : matchKind === 'override' ? 'Manual metadata override is active.' : 'Matched by game name.';
  if (status === 'hashing') return 'Hashing local ROM.';
  if (status === 'fetching') return 'Fetching metadata.';
  if (status === 'ambiguous') return 'Choose the correct ScreenScraper match.';
  if (status === 'failed') return 'Metadata lookup failed.';
  if (status === 'skipped') return 'Metadata lookup is skipped.';
  return 'Metadata has not been fetched yet.';
}

function SetupRow({
  label,
  detail,
  ready,
  actionLabel,
  onAction,
  disabled,
  testId
}: {
  label: string;
  detail: string;
  ready: boolean;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-3 rounded-md bg-black/22 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-semibold">{label}</div>
        <div className="mt-1 truncate text-xs text-white/38">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="h-8 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:opacity-40"
          >
            {actionLabel}
          </button>
        )}
        {ready ? <ShieldCheck className="h-4 w-4 text-hydra-green" /> : <ShieldAlert className="h-4 w-4 text-amber-200" />}
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0.00 MB/s';
  }

  return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
}
