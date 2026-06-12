import type { UpdateCheckError } from '@/types/repository';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ru';
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export const en = {
  language: {
    label: 'Language',
    description: 'Choose the interface language. Catalog text stays as the source provides it.',
    options: {
      en: 'English',
      ru: 'Русский'
    }
  },
  common: {
    close: 'Close',
    save: 'Save',
    loading: 'Loading',
    unknown: 'unknown',
    yes: 'Yes',
    no: 'No',
    notRun: 'Not run',
    details: 'Details',
    retry: 'Retry',
    check: 'Check',
    connect: 'Connect',
    remove: 'Remove',
    refresh: 'Refresh',
    import: 'Import',
    download: 'Download',
    install: 'Install',
    ready: 'Ready',
    missing: 'Missing',
    browse: 'Browse',
    select: 'Select',
    version: 'Version',
    hash: 'Hash',
    team: 'Team',
    license: 'License',
    games: 'Games',
    systemFiles: 'System files',
    sources: 'Sources',
    updated: 'Updated',
    published: 'Published',
    peers: 'peers'
  },
  brand: {
    tagline: 'Your games. All in one place.',
    demoCopy: 'Fusion includes first-party demo content and loads community sources only after you connect them.'
  },
  actions: {
    Play: 'Play',
    Retry: 'Retry',
    Resume: 'Resume',
    Details: 'Details',
    Import: 'Import',
    'Re-download': 'Re-download',
    'Fix Requirements': 'Fix requirements',
    Install: 'Install'
  },
  statusLabels: {
    'Ready to Play': 'Ready to play',
    'Game File Issue': 'Game file issue',
    'Missing Requirements': 'Missing requirements',
    'Download Error': 'Download error',
    Interrupted: 'Interrupted',
    Paused: 'Paused',
    'Resolving Magnet': 'Resolving magnet',
    Cancelling: 'Cancelling',
    Downloading: 'Downloading',
    Installed: 'Installed',
    Cancelled: 'Cancelled',
    'Not Installed': 'Not installed'
  },
  shortStatusLabels: {
    'Missing Requirements': 'Set up',
    'Ready to Play': 'Ready',
    'Not Installed': 'New',
    'Resolving Magnet': 'Resolving'
  },
  sourceTrust: {
    official: 'Official source',
    community: 'Community source',
    unknown: 'User source',
    confirmTitle: 'Connect user source?',
    confirmBody: 'Fusion has not verified this source. Connect it only if you trust the author and have the right to use the listed files.',
    unknownPrompt: (name: string, url: string, catalogCount: number, systemFileCount: number) => [
      'Connect user source?',
      '',
      name,
      url,
      `${catalogCount} games, ${systemFileCount} system files.`,
      '',
      'Fusion has not verified this source. Connect it only if you trust the author and have the right to use the listed files.'
    ].join('\n')
  },
  settings: {
    title: 'Settings',
    description: 'Emulators, sources, storage, launcher health, and updates.',
    unsaved: 'Unsaved',
    unsavedBadge: 'Unsaved',
    footerDirty: 'Changes are local until you save.',
    footerClean: 'No unsaved changes.',
    closeTitle: 'Close settings',
    sections: {
      general: 'General',
      emulators: 'Emulators',
      metadata: 'Metadata',
      sources: 'Sources',
      storage: 'Storage',
      diagnostics: 'Diagnostics',
      updates: 'Updates'
    },
    readiness: {
      title: 'Readiness',
      configured: 'Configured',
      ready: 'Ready',
      sources: 'Sources',
      unsaved: 'Unsaved'
    },
    statusChip: {
      ready: 'Ready',
      missing: 'Not set',
      notSet: 'Not set',
      unsaved: 'Unsaved',
      saved: 'Saved',
      removeOnSave: 'Remove on save',
      fileMoved: 'File moved',
      invalid: 'Invalid'
    },
    emulatorDraft: {
      removeOnSave: {
        label: 'Remove on save',
        detail: 'This platform path will be cleared when changes are saved.'
      },
      notSet: {
        label: 'Not set',
        detail: 'Select an executable before launching this platform.'
      },
      unsaved: {
        label: 'Unsaved',
        detail: 'Selected locally. Save changes to validate and persist it.'
      },
      ready: {
        label: 'Ready',
        detail: 'Executable is saved and available.'
      },
      fileMoved: {
        label: 'File moved',
        detail: 'The saved executable can no longer be found.'
      },
      invalid: {
        label: 'Invalid',
        detail: 'The saved executable failed validation.'
      },
      saved: {
        label: 'Saved',
        detail: 'Executable path is saved.'
      }
    },
    messages: {
      loadDetailsError: (error: unknown) => `Failed to load settings details: ${error}`,
      nativeFilePickerUnavailable: 'Native file browsing is available in the Tauri desktop build. In preview, paste the path manually.',
      browseError: (error: unknown) => `Failed to open file picker: ${error}`,
      saveSuccess: 'Settings saved. Emulator readiness has been updated.',
      saveError: (error: unknown) => `Failed to save settings: ${error}`
    },
    general: {
      configured: 'Configured',
      sources: 'Sources',
      downloads: 'Downloads',
      ready: 'Ready',
      health: 'Health',
      update: 'Update',
      launcherSetup: 'Launcher setup',
      copy: 'Everything important is in one window: emulator paths, sources, storage, diagnostics, and updates.',
      dirty: 'There are unsaved changes. Save them to update launch readiness.',
      synced: (mode: string) => `Settings are synced. Mode: ${mode}.`
    },
    emulators: {
      title: 'Emulator paths',
      copy: 'Choose the Windows `.exe` for each platform. Paths are stored locally and used only to launch games.',
      active: (platform: string) => `Active: ${platform}`,
      expectedFile: (file: string) => `Expected file: ${file}`,
      pathSr: (platform: string) => `Emulator path for ${platform}`,
      pathPlaceholder: 'Path to .exe',
      chooseExecutable: (platform: string) => `Choose ${platform} executable`,
      pickerTitle: (platform: string) => `Choose emulator for ${platform}`,
      windowsExecutable: 'Windows executable'
    },
    sourcesPanel: {
      title: 'Community and personal sources',
      copy: 'Connect a community URL or import a local JSON file. Unknown sources should be checked before connecting.',
      template: 'Template',
      templateTitle: 'Fill in template source URL',
      importJsonTitle: 'Import source JSON',
      connected: 'Connected sources',
      busy: 'Working...',
      empty: 'No community sources connected yet.',
      executableAssets: 'Source contains executable files',
      unknownSource: 'User source: check the team and file rights before connecting.',
      executableRequiresTrust: 'Executable files require a trusted source'
    },
    storage: {
      title: 'Storage',
      copy: 'Choose the folder for downloaded games and inspect local desktop-build paths.',
      downloadFolder: 'Downloads folder',
      appData: 'App data',
      logs: 'Logs'
    },
    diagnostics: {
      title: 'Diagnostics',
      copy: 'Check launch profiles, system files, sources, and downloader state.',
      run: 'Run',
      copyReport: 'Copy report',
      openLogs: 'Open logs',
      profilesLoading: 'Platform profiles are loading.',
      notRun: 'Diagnostics have not run yet.',
      groups: {
        emulators: 'Emulators',
        launchProfiles: 'Launch profiles',
        systemFiles: 'System files',
        gameFiles: 'Game files',
        sources: 'Sources'
      }
    },
    updates: {
      title: 'Updates',
      copy: 'Check updates for the Windows MVP build through GitHub Releases.',
      panelTitle: 'Update check',
      panelCopy: 'Windows MVP build updates through GitHub Releases.',
      checkIdle: 'Check for updates when convenient.',
      checking: 'Checking GitHub Releases...',
      installing: 'Downloading and installing the update...',
      upToDate: (version?: string | null) => `Fusion is up to date${version ? ` (${version})` : ''}.`,
      available: (version?: string | null) => `Version ${version ?? 'unknown'} is available`,
      installNow: 'Update now',
      retry: 'Retry',
      check: 'Check'
    },
    updatePhase: {
      idle: 'Idle',
      checking: 'Checking',
      installing: 'Installing',
      'up-to-date': 'Up to date',
      available: 'Available',
      error: 'Error'
    },
    updateErrors: {
      endpointUnreachable: 'Could not reach the update server.',
      signatureInvalid: 'Could not verify the update signature.',
      parseError: (message?: string) => message ? `Update metadata is invalid: ${message}` : 'Update metadata is invalid.',
      fallback: 'Could not check for updates.'
    },
    healthStatus: {
      ready: 'ready',
      missing: 'missing',
      error: 'error',
      corrupt: 'corrupt'
    },
    emptyHealth: 'No records yet.'
  },
  dashboard: {
    filters: {
      all: 'All games',
      installed: 'Installed',
      downloading: 'Downloading',
      missing: 'Needs setup'
    },
    sorts: {
      title: 'By title',
      status: 'By status',
      platform: 'By platform',
      repository: 'By source'
    },
    topbar: {
      searchAria: 'Search games and collections',
      searchPlaceholder: 'Search games, collections, friends...',
      refreshTitle: 'Refresh',
      settingsTitle: 'Open settings',
      notificationsTitle: 'Open notifications',
      notifications: {
        title: 'Notifications',
        subtitle: 'Launcher news and update status',
        updateTitle: 'Launcher update',
        activityTitle: 'Recent activity',
        empty: 'No notifications yet.',
        unread: 'Unread notifications',
        availableBadge: 'Update ready',
        releaseNotes: 'Release notes',
        updateIdle: 'Open this panel to check for launcher updates.'
      }
    },
    messages: {
      settingsLoadError: (error: unknown) => `Failed to load settings: ${error}`,
      sourceUrlRequired: 'Enter a source URL.',
      sourceChecked: 'Source checked',
      sourceConnected: 'Source connected',
      localJsonDesktopOnly: 'Local JSON import is available in the desktop build.',
      selectSourceJson: 'Select Fusion source JSON',
      repositoryJson: 'Repository JSON',
      diagnosticsCopied: 'Diagnostics copied',
      downloadCompleted: 'Download completed',
      installComplete: 'Install complete',
      installNeedsAttention: 'Install needs attention',
      installNeedsAttentionDetail: 'Install needs attention.',
      launchSent: 'Launch sent'
    },
    rails: {
      continuePlaying: 'Continue playing',
      downloads: 'Downloads',
      needsSetup: 'Needs setup',
      recentlyAdded: 'Recently added'
    },
    explore: {
      eyebrow: 'Activity',
      title: 'What is new',
      description: 'Source, library, and download events',
      empty: 'No activity yet.',
      libraryStats: 'Library stats',
      games: 'Games',
      ready: 'Ready',
      downloads: 'Downloads'
    },
    library: {
      eyebrow: 'Library',
      title: 'All your games',
      description: (visible: number, total: number) => `${visible} visible / ${total} total`,
      searchPlaceholder: 'Search library',
      clearSearch: 'Clear search',
      sortAria: 'Library sort',
      empty: 'No games match the selected filters.'
    },
    downloads: {
      eyebrow: 'Downloads',
      title: 'Download center',
      activeDescription: (count: number) => `Active download in progress / ${count} records`,
      idleDescription: (count: number) => `Queue ready / ${count} records`,
      active: 'Active',
      paused: 'Paused',
      errors: 'Errors',
      downloaded: 'Downloaded',
      empty: 'No downloads yet. Start an install from Home or Library.',
      pause: 'Pause',
      resume: 'Resume',
      retry: 'Retry',
      play: 'Play',
      cancel: 'Cancel',
      statusHints: {
        interrupted: 'Restored after restart. Resume to continue.',
        paused: 'Paused state is persisted.',
        resolving: 'Resolving magnet metadata.',
        cancelling: 'Cancelling and cleaning partial files.',
        cancelled: 'Cancelled session retained for diagnostics.',
        error: 'Retry from the persisted download state.'
      }
    }
  },
  shell: {
    nav: {
      home: 'Home',
      library: 'Library',
      explore: 'Activity',
      downloads: 'Downloads',
      collections: 'Collections',
      settings: 'Settings'
    },
    stats: {
      sources: 'Sources',
      activeDownloads: 'Active downloads'
    },
    hints: {
      select: 'Select',
      back: 'Back',
      details: 'Details',
      open: 'Open',
      home: 'Home',
      filters: 'Filters',
      action: 'Action',
      retry: 'Retry'
    },
    hero: {
      emptyTitle: 'Library is empty',
      emptyCopy: 'Open settings, connect a source, or restore the built-in demo library.',
      openSettings: 'Open settings',
      status: 'Status',
      source: 'Source',
      progress: 'Progress',
      mvpDemo: 'MVP Demo',
      detailsTitle: 'Details'
    },
    collections: {
      title: 'Collections',
      all: 'All games',
      ready: 'Ready to play',
      downloads: 'Downloads',
      missing: 'Needs setup',
      count: (count: number) => `${count} games`
    }
  },
  onboarding: {
    messages: {
      builtInDemoMissing: 'Built-in NES demo was not found after repository setup.',
      playableReady: 'Playable demo is ready.',
      noPlayableDemo: 'No playable demo game is connected.',
      launched: (title: string) => `Launched ${title}.`,
      localJsonDesktopOnly: 'Local JSON import is available in the desktop build.',
      fileBrowseDesktopOnly: 'File browsing is available in the desktop build. Paste a path for preview.',
      browseError: (error: unknown) => `Failed to browse for emulator: ${error}`
    },
    firstRun: 'First run',
    title: 'Set up Fusion before you play',
    copy: 'Connect a source and set up one matching emulator. Commercial ROMs, BIOS, firmware, and keys are not bundled.',
    stepperLabel: 'First run setup steps',
    continue: 'Continue',
    steps: {
      welcome: 'Welcome',
      source: 'Source',
      emulator: 'Emulator',
      ready: 'Ready'
    },
    stepDetails: {
      welcome: 'Language and setup overview',
      source: 'Connect demo, community, or local JSON',
      emulator: 'Install or select one matching emulator',
      ready: 'Check readiness and open launcher'
    },
    welcome: {
      title: 'Start with the basics',
      copy: 'Fusion needs a game source and at least one emulator that matches that source. You can finish optional storage, metadata, and diagnostics later in Settings.'
    },
    sourceStep: {
      title: 'Choose where games come from',
      copy: 'Use the built-in demo source for a safe first run, or connect a community URL or local source JSON.',
      demoCopy: 'The built-in source contains first-party demo content and is the fastest way to verify that launching works.',
      useDemo: 'Use demo source',
      connected: (count: number) => `Source connected / ${count} games found`,
      notConnected: 'Connect a source before configuring emulators.'
    },
    emulatorStep: {
      title: 'Set up a matching emulator',
      copy: 'Only one ready emulator is required to enter the launcher. Other platforms can be configured later from Settings.',
      needsSource: 'Connect a source first so Fusion can show only the emulator profiles your library needs.',
      noCatalog: 'The source is connected, but the catalog is empty.',
      noProfiles: 'No supported setup profile was found for this catalog.',
      autoDetail: (name: string) => `${name} can be installed automatically for this platform.`,
      manualDetail: (name: string) => `${name} requires selecting an executable you already have installed.`,
      install: (name: string) => `Install ${name}`
    },
    readyStep: {
      title: 'Launcher is ready',
      copy: 'The required setup is complete. Optional metadata, storage, diagnostics, and extra emulators stay available in Settings.',
      catalog: 'Catalog',
      sourceReady: 'A source is connected.',
      catalogReady: 'Games are available in the catalog.',
      catalogMissing: 'The connected source has no catalog entries.',
      emulatorReady: 'At least one matching emulator is ready.',
      emulatorMissing: 'Set up one emulator for a platform in the catalog.',
      demoOptional: 'Optional: download the demo ROM to test launch immediately.',
      fixSource: 'Fix source',
      fixEmulator: 'Fix emulator',
      openLauncher: 'Open launcher'
    },
    builtInDemo: 'Built-in NES demo',
    withMesen: (version: string) => `with Mesen2 ${version}`,
    play: 'Play',
    setupDemo: 'Set up demo',
    setup: {
      source: 'Source',
      sourceDetail: 'Built-in demo library connected',
      emulator: 'Emulator',
      emulatorDetail: 'Mesen2 auto setup',
      demoRom: 'Demo ROM',
      demoRomDetail: 'Built-in smoke ROM',
      ready: 'Ready',
      readyDetail: 'After setup, launch should complete without errors'
    },
    sourceCard: {
      title: 'Community or personal source',
      copy: 'Connect a community URL or local JSON.',
      sourceUrl: 'Source URL',
      jsonFile: 'JSON file'
    },
    manualTools: 'Manual emulator and demo tools',
    manualEmulator: 'Manual emulator setup',
    expected: (file: string) => `Expected: ${file}`,
    saveEmulator: 'Save emulator',
    demoTools: 'Demo tools',
    builtInDemoButton: 'Built-in demo',
    checkDemo: 'Check demo',
    downloadDemo: 'Download demo',
    preview: {
      games: (count: number) => `${count} games`,
      systemFiles: (count: number) => `${count} system files`,
      version: (version: string) => `Version ${version}`,
      executableAssets: 'Contains executable assets',
      verifyUnknown: 'Verify this user source before connecting.'
    }
  },
  gameDetails: {
    downloadTitles: {
      resolving: 'Resolving metadata',
      downloading: 'Downloading',
      paused: 'Paused',
      interrupted: 'Interrupted',
      completed: 'Downloaded',
      cancelling: 'Cancelling',
      cancelled: 'Cancelled',
      error: 'Download error',
      checking: 'Checking download',
      idle: 'Download'
    },
    messages: {
      resolveDownloadFolderFailed: (error: unknown) => `Failed to resolve download folder: ${error}`,
      importLocalGame: 'Import the local game file from the setup panel.',
      noAutomaticSource: 'This game has no automatic download source.',
      installComplete: 'Install complete. You can play.',
      installNeedsAttention: 'Install needs attention.',
      importFailed: (code?: string) => `Import failed: ${code ?? 'error'}`,
      gameAlreadyInstalled: 'Game file is already installed.',
      gameImported: 'Game file imported.',
      assetImportDesktopOnly: 'File import is available in the desktop build.',
      assetAlreadyInstalled: 'File is already installed.',
      assetImported: 'File imported.',
      systemFileAlreadyInstalled: 'System file is already installed.',
      systemFileImported: 'System file imported.',
      downloadFolderNotReady: 'Downloaded game folder is not ready yet.',
      launchSent: 'Launch sent.',
      removeConfirm: (title: string) => `Delete downloaded files for ${title}?`
    },
    closeTitle: 'Close',
    setup: {
      emulator: 'Emulator',
      configureEmulator: (platform: string) => `Set up ${platform} emulator`,
      chooseEmulatorAgain: (platform: string) => `Choose ${platform} emulator again`,
      choose: 'Choose',
      systemFiles: 'System files',
      neededFiles: (count: number) => `Required files: ${count}`,
      noExtraFiles: 'No extra files required',
      gameFile: 'Game file',
      imported: 'Imported',
      importGameFile: 'Import local game file',
      needsDownload: 'Needs download',
      launch: 'Launch',
      finishSetupFirst: 'Finish setup first',
      check: 'Check',
      trust: 'Trust',
      manualSource: 'Manual source',
      finishSetup: 'Finish setup',
      play: 'Play',
      hideDetails: 'Hide details',
      details: 'Details',
      openFolder: 'Open folder',
      deleteFiles: 'Delete files'
    },
    requirementStatus: {
      ready: 'Ready',
      corrupt: 'Corrupt',
      blocked: 'Blocked',
      error: 'Error',
      missing: 'Missing'
    },
    assetKind: {
      keys: 'keys',
      firmware: 'firmware',
      bios: 'BIOS',
      runtime: 'runtime'
    },
    downloadActions: {
      pause: 'Pause',
      retry: 'Retry',
      resume: 'Resume',
      cancel: 'Cancel'
    },
    selectExecutable: 'Executable'
  },
  launchErrors: {
    fallbackMessage: 'Could not start the emulator.',
    emulatorNotConfigured: {
      title: 'Emulator is not configured',
      message: 'Set the emulator path in Fusion before launching this platform.',
      action: 'Open settings'
    },
    emulatorFileMissing: {
      title: 'Emulator file was not found',
      message: (path?: string) => path ? `Configured emulator executable was not found: ${path}` : 'Configured emulator executable was not found.',
      action: 'Choose again'
    },
    gameFileMissing: {
      title: 'Game file was not found',
      message: 'The downloaded game file was moved or deleted.',
      action: 'Download again'
    },
    gameFileCorrupt: {
      title: 'Game file cannot launch',
      message: 'The downloaded game file failed validation.',
      action: 'Download again'
    },
    systemFilesMissing: {
      title: 'System files required',
      prefix: 'Missing',
      empty: 'system files are required before launch.',
      action: 'Open details'
    },
    systemFileCorrupt: {
      title: 'System file failed validation',
      prefix: 'Corrupt',
      empty: 'system files are required before launch.',
      action: 'Open details'
    },
    alreadyRunning: {
      title: 'Game is already running',
      message: 'Fusion has already started an emulator process for this game.',
      action: 'Close'
    },
    spawnFailed: {
      title: 'Launch failed',
      message: 'The emulator could not be started.',
      action: 'Close'
    }
  },
  installProgress: {
    emulator: 'Preparing emulator',
    system_files: 'Checking system files',
    game: 'Installing game',
    verify: 'Final check',
    done: 'Ready to play'
  }
} as const;

type DeepWiden<T> =
  T extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : T extends string
      ? string
      : T extends object
        ? { [Key in keyof T]: DeepWiden<T[Key]> }
        : T;

export type UiText = DeepWiden<typeof en>;

export const ru: UiText = {
  language: {
    label: 'Язык',
    description: 'Выбери язык интерфейса. Текст каталогов остается таким, каким его дает источник.',
    options: {
      en: 'English',
      ru: 'Русский'
    }
  },
  common: {
    close: 'Закрыть',
    save: 'Сохранить',
    loading: 'Загрузка',
    unknown: 'unknown',
    yes: 'Да',
    no: 'Нет',
    notRun: 'Не запускалась',
    details: 'Детали',
    retry: 'Повторить',
    check: 'Проверить',
    connect: 'Подключить',
    remove: 'Удалить',
    refresh: 'Обновить',
    import: 'Импорт',
    download: 'Скачать',
    install: 'Установить',
    ready: 'Готово',
    missing: 'Не задано',
    browse: 'Выбрать',
    select: 'Выбрать',
    version: 'Версия',
    hash: 'Хеш',
    team: 'Команда',
    license: 'Лицензия',
    games: 'Игры',
    systemFiles: 'Системные файлы',
    sources: 'Источники',
    updated: 'Обновлено',
    published: 'Опубликовано',
    peers: 'peers'
  },
  brand: {
    tagline: 'Твои игры. Все в одном месте.',
    demoCopy: 'Fusion включает first-party demo и загружает community-источники только после твоего подключения.'
  },
  actions: {
    Play: 'Играть',
    Retry: 'Повторить',
    Resume: 'Продолжить',
    Details: 'Детали',
    Import: 'Импорт',
    'Re-download': 'Скачать заново',
    'Fix Requirements': 'Настроить',
    Install: 'Установить'
  },
  statusLabels: {
    'Ready to Play': 'Готово к запуску',
    'Game File Issue': 'Проблема с файлом',
    'Missing Requirements': 'Нужна настройка',
    'Download Error': 'Ошибка загрузки',
    Interrupted: 'Прервано',
    Paused: 'Пауза',
    'Resolving Magnet': 'Поиск метаданных',
    Cancelling: 'Отмена',
    Downloading: 'Загрузка',
    Installed: 'Установлено',
    Cancelled: 'Отменено',
    'Not Installed': 'Не установлено'
  },
  shortStatusLabels: {
    'Missing Requirements': 'Настроить',
    'Ready to Play': 'Готово',
    'Not Installed': 'Новое',
    'Resolving Magnet': 'Поиск'
  },
  sourceTrust: {
    official: 'Официальный источник',
    community: 'Источник сообщества',
    unknown: 'Пользовательский источник',
    confirmTitle: 'Подключить пользовательский источник?',
    confirmBody: 'Fusion не проверял этот источник. Подключай его только если доверяешь автору и имеешь право использовать указанные файлы.',
    unknownPrompt: (name: string, url: string, catalogCount: number, systemFileCount: number) => [
      'Подключить пользовательский источник?',
      '',
      name,
      url,
      `${catalogCount} игр, ${systemFileCount} системных файлов.`,
      '',
      'Fusion не проверял этот источник. Подключай его только если доверяешь автору и имеешь право использовать указанные файлы.'
    ].join('\n')
  },
  settings: {
    title: 'Настройки',
    description: 'Эмуляторы, источники, хранилище и состояние лаунчера.',
    unsaved: 'Не сохранено',
    unsavedBadge: 'Не сохранено',
    footerDirty: 'Изменения локальные до сохранения.',
    footerClean: 'Нет несохраненных изменений.',
    closeTitle: 'Закрыть настройки',
    sections: {
      general: 'Основные',
      emulators: 'Эмуляторы',
      metadata: 'Метаданные',
      sources: 'Источники',
      storage: 'Хранилище',
      diagnostics: 'Диагностика',
      updates: 'Обновления'
    },
    readiness: {
      title: 'Готовность',
      configured: 'Настроено',
      ready: 'Готово',
      sources: 'Источники',
      unsaved: 'Несохранено'
    },
    statusChip: {
      ready: 'Готово',
      missing: 'Не задано',
      notSet: 'Не задано',
      unsaved: 'Не сохранено',
      saved: 'Сохранено',
      removeOnSave: 'Удалить при сохранении',
      fileMoved: 'Файл перемещен',
      invalid: 'Некорректно'
    },
    emulatorDraft: {
      removeOnSave: {
        label: 'Удалить при сохранении',
        detail: 'Путь этой платформы будет очищен при сохранении изменений.'
      },
      notSet: {
        label: 'Не задано',
        detail: 'Выбери executable перед запуском этой платформы.'
      },
      unsaved: {
        label: 'Не сохранено',
        detail: 'Выбрано локально. Сохрани изменения, чтобы проверить и записать путь.'
      },
      ready: {
        label: 'Готово',
        detail: 'Executable сохранен и доступен.'
      },
      fileMoved: {
        label: 'Файл перемещен',
        detail: 'Сохраненный executable больше не найден.'
      },
      invalid: {
        label: 'Некорректно',
        detail: 'Сохраненный executable не прошел проверку.'
      },
      saved: {
        label: 'Сохранено',
        detail: 'Путь executable сохранен.'
      }
    },
    messages: {
      loadDetailsError: (error: unknown) => `Не удалось загрузить детали настроек: ${error}`,
      nativeFilePickerUnavailable: 'Нативный выбор файла доступен в desktop-сборке Tauri. В preview можно вставить путь вручную.',
      browseError: (error: unknown) => `Не удалось открыть выбор файла: ${error}`,
      saveSuccess: 'Настройки сохранены. Готовность эмуляторов обновлена.',
      saveError: (error: unknown) => `Не удалось сохранить настройки: ${error}`
    },
    general: {
      configured: 'Настроено',
      sources: 'Источники',
      downloads: 'Загрузки',
      ready: 'Готово',
      health: 'Проверка',
      update: 'Обновление',
      launcherSetup: 'Настройка лаунчера',
      copy: 'Все важное собрано в одном окне: пути к эмуляторам, источники, хранилище, диагностика и обновления.',
      dirty: 'Есть несохраненные изменения. Сохрани их, чтобы обновить готовность запуска.',
      synced: (mode: string) => `Настройки синхронизированы. Режим: ${mode}.`
    },
    emulators: {
      title: 'Пути к эмуляторам',
      copy: 'Выбери Windows `.exe` для каждой платформы. Пути хранятся локально и нужны только для запуска игр.',
      active: (platform: string) => `Активно: ${platform}`,
      expectedFile: (file: string) => `Ожидаемый файл: ${file}`,
      pathSr: (platform: string) => `Путь к эмулятору ${platform}`,
      pathPlaceholder: 'Путь к .exe',
      chooseExecutable: (platform: string) => `Выбрать ${platform} executable`,
      pickerTitle: (platform: string) => `Выбери эмулятор для ${platform}`,
      windowsExecutable: 'Windows executable'
    },
    sourcesPanel: {
      title: 'Сообщество и личные источники',
      copy: 'Подключи URL сообщества или импортируй локальный JSON. Неизвестные источники стоит проверить перед подключением.',
      template: 'Шаблон',
      templateTitle: 'Подставить шаблон source URL',
      importJsonTitle: 'Импортировать JSON источника',
      connected: 'Подключенные источники',
      busy: 'В работе...',
      empty: 'Источники сообщества пока не подключены.',
      executableAssets: 'Источник содержит исполняемые файлы',
      unknownSource: 'Пользовательский источник: проверь команду и права на файлы перед подключением.',
      executableRequiresTrust: 'Исполняемые файлы требуют доверенного источника'
    },
    storage: {
      title: 'Хранилище',
      copy: 'Выбери папку для скачанных игр и проверь локальные пути desktop-сборки.',
      downloadFolder: 'Папка загрузок',
      appData: 'Данные приложения',
      logs: 'Логи'
    },
    diagnostics: {
      title: 'Диагностика',
      copy: 'Проверка профилей запуска, системных файлов, источников и состояния загрузчика.',
      run: 'Запустить',
      copyReport: 'Копировать отчет',
      openLogs: 'Открыть логи',
      profilesLoading: 'Профили платформ загружаются.',
      notRun: 'Диагностика еще не запускалась.',
      groups: {
        emulators: 'Эмуляторы',
        launchProfiles: 'Профили запуска',
        systemFiles: 'Системные файлы',
        gameFiles: 'Файлы игр',
        sources: 'Источники'
      }
    },
    updates: {
      title: 'Обновления',
      copy: 'Проверка обновлений для Windows MVP-сборки через GitHub Releases.',
      panelTitle: 'Проверка обновлений',
      panelCopy: 'Обновления Windows MVP-сборки через GitHub Releases.',
      checkIdle: 'Проверь обновления, когда будет удобно.',
      checking: 'Проверяем GitHub Releases...',
      installing: 'Скачиваем и устанавливаем обновление...',
      upToDate: (version?: string | null) => `Fusion обновлен${version ? ` (${version})` : ''}.`,
      available: (version?: string | null) => `Доступна версия ${version ?? 'unknown'}`,
      installNow: 'Обновить сейчас',
      retry: 'Повторить',
      check: 'Проверить'
    },
    updatePhase: {
      idle: 'Ожидание',
      checking: 'Проверка',
      installing: 'Установка',
      'up-to-date': 'Актуально',
      available: 'Доступно',
      error: 'Ошибка'
    },
    updateErrors: {
      endpointUnreachable: 'Не удалось связаться с сервером обновлений.',
      signatureInvalid: 'Не удалось проверить подпись обновления.',
      parseError: (message?: string) => message ? `Метаданные обновления некорректны: ${message}` : 'Метаданные обновления некорректны.',
      fallback: 'Не удалось проверить обновления.'
    },
    healthStatus: {
      ready: 'готово',
      missing: 'не найдено',
      error: 'ошибка',
      corrupt: 'повреждено'
    },
    emptyHealth: 'Записей пока нет.'
  },
  dashboard: {
    filters: {
      all: 'Все игры',
      installed: 'Установленные',
      downloading: 'Загружаются',
      missing: 'Нужна настройка'
    },
    sorts: {
      title: 'По названию',
      status: 'По статусу',
      platform: 'По платформе',
      repository: 'По источнику'
    },
    topbar: {
      searchAria: 'Поиск игр и коллекций',
      searchPlaceholder: 'Поиск игр, коллекций, друзей...',
      refreshTitle: 'Обновить',
      settingsTitle: 'Открыть настройки',
      notificationsTitle: 'Открыть уведомления',
      notifications: {
        title: 'Уведомления',
        subtitle: 'Новости лаунчера и статус обновлений',
        updateTitle: 'Обновление лаунчера',
        activityTitle: 'Последние события',
        empty: 'Уведомлений пока нет.',
        unread: 'Непрочитанные уведомления',
        availableBadge: 'Обновление готово',
        releaseNotes: 'Заметки релиза',
        updateIdle: 'Открой эту панель, чтобы проверить обновления лаунчера.'
      }
    },
    messages: {
      settingsLoadError: (error: unknown) => `Не удалось загрузить настройки: ${error}`,
      sourceUrlRequired: 'Укажи URL источника.',
      sourceChecked: 'Источник проверен',
      sourceConnected: 'Источник подключен',
      localJsonDesktopOnly: 'Импорт локального JSON доступен в desktop-сборке.',
      selectSourceJson: 'Select Fusion source JSON',
      repositoryJson: 'Repository JSON',
      diagnosticsCopied: 'Диагностика скопирована',
      downloadCompleted: 'Загрузка завершена',
      installComplete: 'Установка завершена',
      installNeedsAttention: 'Установка требует внимания',
      installNeedsAttentionDetail: 'Установка требует внимания.',
      launchSent: 'Запуск отправлен'
    },
    rails: {
      continuePlaying: 'Продолжить играть',
      downloads: 'Загрузки',
      needsSetup: 'Нужна настройка',
      recentlyAdded: 'Недавно добавленные'
    },
    explore: {
      eyebrow: 'Лента',
      title: 'Что нового',
      description: 'События источников, библиотеки и загрузок',
      empty: 'Событий пока нет.',
      libraryStats: 'Статистика библиотеки',
      games: 'Игры',
      ready: 'Готово',
      downloads: 'Загрузки'
    },
    library: {
      eyebrow: 'Библиотека',
      title: 'Все твои игры',
      description: (visible: number, total: number) => `${visible} видно / ${total} всего`,
      searchPlaceholder: 'Поиск по библиотеке',
      clearSearch: 'Очистить поиск',
      sortAria: 'Сортировка библиотеки',
      empty: 'Нет игр под выбранные фильтры.'
    },
    downloads: {
      eyebrow: 'Загрузки',
      title: 'Центр загрузок',
      activeDescription: (count: number) => `Активная загрузка в работе / ${count} записей`,
      idleDescription: (count: number) => `Очередь готова / ${count} записей`,
      active: 'Активно',
      paused: 'Пауза',
      errors: 'Ошибки',
      downloaded: 'Скачано',
      empty: 'Загрузок пока нет. Начни установку из главной или библиотеки.',
      pause: 'Пауза',
      resume: 'Продолжить',
      retry: 'Повторить',
      play: 'Играть',
      cancel: 'Отменить',
      statusHints: {
        interrupted: 'Восстановлено после перезапуска. Продолжи, чтобы скачать дальше.',
        paused: 'Пауза сохранена.',
        resolving: 'Ищем magnet-метаданные.',
        cancelling: 'Отменяем и очищаем частичные файлы.',
        cancelled: 'Отмененная сессия сохранена для диагностики.',
        error: 'Повтори из сохраненного состояния загрузки.'
      }
    }
  },
  shell: {
    nav: {
      home: 'Главная',
      library: 'Библиотека',
      explore: 'Лента',
      downloads: 'Загрузки',
      collections: 'Коллекции',
      settings: 'Настройки'
    },
    stats: {
      sources: 'Источники',
      activeDownloads: 'Активные загрузки'
    },
    hints: {
      select: 'Выбрать',
      back: 'Назад',
      details: 'Детали',
      open: 'Открыть',
      home: 'Главная',
      filters: 'Фильтры',
      action: 'Действие',
      retry: 'Повтор'
    },
    hero: {
      emptyTitle: 'Библиотека пока пустая',
      emptyCopy: 'Открой настройки, подключи источник или восстанови встроенную demo-библиотеку.',
      openSettings: 'Открыть настройки',
      status: 'Статус',
      source: 'Источник',
      progress: 'Прогресс',
      mvpDemo: 'MVP Demo',
      detailsTitle: 'Детали'
    },
    collections: {
      title: 'Коллекции',
      all: 'Все игры',
      ready: 'Готово к запуску',
      downloads: 'Загрузки',
      missing: 'Нужна настройка',
      count: (count: number) => `${count} игр`
    }
  },
  onboarding: {
    messages: {
      builtInDemoMissing: 'Встроенная NES demo не найдена после настройки источника.',
      playableReady: 'Playable demo готова.',
      noPlayableDemo: 'Подключенной playable demo нет.',
      launched: (title: string) => `Запущено: ${title}.`,
      localJsonDesktopOnly: 'Импорт локального JSON доступен в desktop-сборке.',
      fileBrowseDesktopOnly: 'Выбор файла доступен в desktop-сборке. Для preview вставь путь вручную.',
      browseError: (error: unknown) => `Не удалось выбрать эмулятор: ${error}`
    },
    firstRun: 'Первый запуск',
    title: 'Настрой Fusion перед запуском',
    copy: 'Подключи источник и настрой один подходящий эмулятор. Коммерческие ROM, BIOS, firmware и keys не входят в поставку.',
    stepperLabel: 'Шаги первого запуска',
    continue: 'Продолжить',
    steps: {
      welcome: 'Старт',
      source: 'Источник',
      emulator: 'Эмулятор',
      ready: 'Готово'
    },
    stepDetails: {
      welcome: 'Язык и общий план настройки',
      source: 'Demo, URL сообщества или локальный JSON',
      emulator: 'Установка или выбор подходящего эмулятора',
      ready: 'Проверка готовности и вход в лаунчер'
    },
    welcome: {
      title: 'Начнем с базовой настройки',
      copy: 'Fusion нужен источник игр и хотя бы один эмулятор под этот источник. Storage, metadata и diagnostics можно настроить позже в Settings.'
    },
    sourceStep: {
      title: 'Выбери источник игр',
      copy: 'Используй встроенный demo-источник для безопасного первого запуска или подключи URL сообщества либо локальный JSON.',
      demoCopy: 'Встроенный источник содержит first-party demo-контент и быстрее всего проверяет, что запуск работает.',
      useDemo: 'Использовать demo',
      connected: (count: number) => `Источник подключен / игр: ${count}`,
      notConnected: 'Сначала подключи источник, потом настраивай эмуляторы.'
    },
    emulatorStep: {
      title: 'Настрой подходящий эмулятор',
      copy: 'Для входа в лаунчер достаточно одного готового эмулятора. Остальные платформы можно настроить позже в Settings.',
      needsSource: 'Сначала подключи источник, чтобы Fusion показал только нужные профили эмуляторов.',
      noCatalog: 'Источник подключен, но каталог пуст.',
      noProfiles: 'Для этого каталога не найден поддерживаемый профиль настройки.',
      autoDetail: (name: string) => `${name} можно установить автоматически для этой платформы.`,
      manualDetail: (name: string) => `${name} требует выбрать уже установленный executable.`,
      install: (name: string) => `Установить ${name}`
    },
    readyStep: {
      title: 'Лаунчер готов',
      copy: 'Обязательная настройка завершена. Metadata, storage, diagnostics и дополнительные эмуляторы останутся в Settings.',
      catalog: 'Каталог',
      sourceReady: 'Источник подключен.',
      catalogReady: 'Игры доступны в каталоге.',
      catalogMissing: 'В подключенном источнике нет игр.',
      emulatorReady: 'Хотя бы один подходящий эмулятор готов.',
      emulatorMissing: 'Настрой один эмулятор для платформы из каталога.',
      demoOptional: 'Опционально: скачай demo ROM, чтобы сразу проверить запуск.',
      fixSource: 'Исправить источник',
      fixEmulator: 'Исправить эмулятор',
      openLauncher: 'Открыть лаунчер'
    },
    builtInDemo: 'Встроенная NES demo',
    withMesen: (version: string) => `с Mesen2 ${version}`,
    play: 'Играть',
    setupDemo: 'Настроить demo',
    setup: {
      source: 'Источник',
      sourceDetail: 'Встроенная demo-библиотека подключена',
      emulator: 'Эмулятор',
      emulatorDetail: 'Автонастройка Mesen2',
      demoRom: 'Demo ROM',
      demoRomDetail: 'Встроенный smoke ROM',
      ready: 'Готово',
      readyDetail: 'После настройки запуск должен пройти без ошибок'
    },
    sourceCard: {
      title: 'Community или личный источник',
      copy: 'Подключи URL сообщества или локальный JSON.',
      sourceUrl: 'Source URL',
      jsonFile: 'JSON file'
    },
    manualTools: 'Ручные инструменты эмулятора и demo',
    manualEmulator: 'Ручная настройка эмулятора',
    expected: (file: string) => `Expected: ${file}`,
    saveEmulator: 'Сохранить эмулятор',
    demoTools: 'Demo-инструменты',
    builtInDemoButton: 'Встроенная demo',
    checkDemo: 'Проверить demo',
    downloadDemo: 'Скачать demo',
    preview: {
      games: (count: number) => `${count} games`,
      systemFiles: (count: number) => `${count} system files`,
      version: (version: string) => `Version ${version}`,
      executableAssets: 'Источник содержит исполняемые файлы',
      verifyUnknown: 'Проверь этот пользовательский источник перед подключением.'
    }
  },
  gameDetails: {
    downloadTitles: {
      resolving: 'Поиск метаданных',
      downloading: 'Загрузка',
      paused: 'Пауза',
      interrupted: 'Прервано',
      completed: 'Скачано',
      cancelling: 'Отмена',
      cancelled: 'Отменено',
      error: 'Ошибка загрузки',
      checking: 'Проверка загрузки',
      idle: 'Загрузка'
    },
    messages: {
      resolveDownloadFolderFailed: (error: unknown) => `Не удалось определить папку загрузки: ${error}`,
      importLocalGame: 'Импортируй локальный файл игры из панели настройки.',
      noAutomaticSource: 'Для этой игры нет автоматического источника загрузки.',
      installComplete: 'Установка завершена. Можно играть.',
      installNeedsAttention: 'Установка требует внимания.',
      importFailed: (code?: string) => `Import failed: ${code ?? 'error'}`,
      gameAlreadyInstalled: 'Файл игры уже установлен.',
      gameImported: 'Файл игры импортирован.',
      assetImportDesktopOnly: 'Импорт файла доступен в desktop-сборке.',
      assetAlreadyInstalled: 'Файл уже установлен.',
      assetImported: 'Файл импортирован.',
      systemFileAlreadyInstalled: 'Системный файл уже установлен.',
      systemFileImported: 'Системный файл импортирован.',
      downloadFolderNotReady: 'Папка скачанной игры пока не готова.',
      launchSent: 'Запуск отправлен.',
      removeConfirm: (title: string) => `Удалить скачанные файлы для ${title}?`
    },
    closeTitle: 'Закрыть',
    setup: {
      emulator: 'Эмулятор',
      configureEmulator: (platform: string) => `Настрой эмулятор ${platform}`,
      chooseEmulatorAgain: (platform: string) => `Выбери эмулятор ${platform} заново`,
      choose: 'Выбрать',
      systemFiles: 'Системные файлы',
      neededFiles: (count: number) => `Нужных файлов: ${count}`,
      noExtraFiles: 'Дополнительные файлы не нужны',
      gameFile: 'Файл игры',
      imported: 'Импортировано',
      importGameFile: 'Импортировать файл игры',
      needsDownload: 'Нужно скачать',
      launch: 'Запуск',
      finishSetupFirst: 'Сначала заверши настройку',
      check: 'Проверить',
      trust: 'Доверять',
      manualSource: 'Ручной источник',
      finishSetup: 'Завершить настройку',
      play: 'Играть',
      hideDetails: 'Скрыть детали',
      details: 'Детали',
      openFolder: 'Открыть папку',
      deleteFiles: 'Удалить файлы'
    },
    requirementStatus: {
      ready: 'Готово',
      corrupt: 'Поврежден',
      blocked: 'Заблокировано',
      error: 'Ошибка',
      missing: 'Отсутствует'
    },
    assetKind: {
      keys: 'ключи',
      firmware: 'firmware',
      bios: 'BIOS',
      runtime: 'runtime'
    },
    downloadActions: {
      pause: 'Пауза',
      retry: 'Повторить',
      resume: 'Продолжить',
      cancel: 'Отменить'
    },
    selectExecutable: 'Executable'
  },
  launchErrors: {
    fallbackMessage: 'Не удалось запустить эмулятор.',
    emulatorNotConfigured: {
      title: 'Эмулятор не настроен',
      message: 'Укажи Fusion путь к эмулятору перед запуском этой платформы.',
      action: 'Открыть настройки'
    },
    emulatorFileMissing: {
      title: 'Файл эмулятора не найден',
      message: (path?: string) => path ? `Настроенный executable эмулятора не найден: ${path}` : 'Настроенный executable эмулятора не найден.',
      action: 'Выбрать заново'
    },
    gameFileMissing: {
      title: 'Файл игры не найден',
      message: 'Скачанный файл игры был перемещен или удален.',
      action: 'Скачать заново'
    },
    gameFileCorrupt: {
      title: 'Файл игры не запускается',
      message: 'Скачанный файл игры не прошел проверку.',
      action: 'Скачать заново'
    },
    systemFilesMissing: {
      title: 'Нужны системные файлы',
      prefix: 'Не хватает',
      empty: 'системные файлы нужны перед запуском.',
      action: 'Открыть детали'
    },
    systemFileCorrupt: {
      title: 'Системный файл не прошел проверку',
      prefix: 'Повреждено',
      empty: 'системные файлы нужны перед запуском.',
      action: 'Открыть детали'
    },
    alreadyRunning: {
      title: 'Игра уже запущена',
      message: 'Fusion уже запустил процесс эмулятора для этой игры.',
      action: 'Закрыть'
    },
    spawnFailed: {
      title: 'Запуск не удался',
      message: 'Эмулятор не удалось запустить.',
      action: 'Закрыть'
    }
  },
  installProgress: {
    emulator: 'Готовим эмулятор',
    system_files: 'Проверяем системные файлы',
    game: 'Устанавливаем игру',
    verify: 'Финальная проверка',
    done: 'Можно играть'
  }
};

export const UI_TEXT: Record<Locale, UiText> = {
  en,
  ru
};

export function getUiText(locale: Locale | string | undefined | null): UiText {
  return UI_TEXT[normalizeLocale(locale)];
}

export function updateErrorText(error: UpdateCheckError | null, locale: Locale | string | undefined | null): string {
  const t = getUiText(locale).settings.updateErrors;
  if (error?.kind === 'endpointUnreachable') return t.endpointUnreachable;
  if (error?.kind === 'signatureInvalid') return t.signatureInvalid;
  if (error?.kind === 'parseError') return t.parseError(error.message);
  return t.fallback;
}
