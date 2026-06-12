use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use url::Url;

use crate::builtin_demo;
use crate::downloads::{
    destination_for_source, download_source_to_file, file_name_for_source, hash_file,
};
use crate::game_files;
use crate::logging;
use crate::schema::{
    AssetView, CatalogGameView, DiagnosticsBundle, DiagnosticsPaths, DownloadRecord,
    EmulatorConfig, GameDownloadStartReport, GameSetupEmulatorState, GameSetupGameFileState,
    GameSetupLaunchState, GameSetupState, GameSetupSystemFileState, HealthCheckItem, HealthReport,
    ImportAssetFileReport, ImportGameFileReport, InstallTarget, LibraryGameStatus,
    LibraryScrapeStatus, OnboardingState, PlatformSetupProfile, ProfileEmulatorConfig,
    ProfileSystemFileRequirement, RepositoryGame, RepositoryMetadata, RepositoryPreview,
    RepositorySchema, RepositorySummary, RequirementItem, RequirementsReport, ScrapeCandidate,
    ScrapeStateView, ScreenScraperStatus, SourceUri, SteamGridDbStatus, TorrentDownloadRecord,
    TrustedExecutable,
};
use crate::security::{validate_platform, validate_repository_schema, validate_repository_url};
use crate::setup_profiles;
use crate::storage::RepositoryStore;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairLibraryReport {
    pub repaired: bool,
    pub repository_id: Option<String>,
    pub removed_paths: Vec<String>,
}

#[tauri::command]
pub async fn preview_repository(
    url: String,
    state: State<'_, AppState>,
) -> Result<RepositoryPreview, String> {
    let allow_dev_http = cfg!(debug_assertions);
    let repo = fetch_repository_schema(&url, allow_dev_http).await?;
    let preview = build_repository_preview(&url, &repo);
    logging::log_event(
        &state.data_dir,
        "repository_previewed",
        &[
            ("url", url.as_str()),
            ("repository_id", preview.id.as_str()),
        ],
    );
    Ok(preview)
}

#[tauri::command]
pub fn preview_repository_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<RepositoryPreview, String> {
    let (repo, url) = load_repository_schema_from_file(&path)?;
    let preview = build_repository_preview(&url, &repo);
    logging::log_event(
        &state.data_dir,
        "repository_previewed",
        &[
            ("url", url.as_str()),
            ("repository_id", preview.id.as_str()),
        ],
    );
    Ok(preview)
}

#[tauri::command]
pub fn preview_builtin_demo_repository(
    state: State<'_, AppState>,
) -> Result<RepositoryPreview, String> {
    let repo = load_builtin_demo_repository()?;
    let preview = build_repository_preview(builtin_demo::BUILTIN_DEMO_REPOSITORY_URL, &repo);
    logging::log_event(
        &state.data_dir,
        "repository_previewed",
        &[
            ("url", builtin_demo::BUILTIN_DEMO_REPOSITORY_URL),
            ("repository_id", preview.id.as_str()),
        ],
    );
    Ok(preview)
}

#[tauri::command]
pub async fn connect_repository(
    url: String,
    state: State<'_, AppState>,
) -> Result<RepositorySummary, String> {
    let allow_dev_http = cfg!(debug_assertions);
    let repo = fetch_repository_schema(&url, allow_dev_http).await?;

    let mut store = lock_store(&state)?;
    let summary = store.store_repository(&url, &repo)?;
    logging::log_event(
        &state.data_dir,
        "repository_connected",
        &[
            ("url", url.as_str()),
            ("repository_id", summary.id.as_str()),
        ],
    );
    Ok(summary)
}

#[tauri::command]
pub fn connect_repository_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<RepositorySummary, String> {
    let (repo, url) = load_repository_schema_from_file(&path)?;
    let mut store = lock_store(&state)?;
    let summary = store.store_repository(&url, &repo)?;
    logging::log_event(
        &state.data_dir,
        "repository_connected",
        &[
            ("url", url.as_str()),
            ("repository_id", summary.id.as_str()),
        ],
    );
    Ok(summary)
}

#[tauri::command]
pub fn connect_builtin_demo_repository(
    state: State<'_, AppState>,
) -> Result<RepositorySummary, String> {
    let repo = load_builtin_demo_repository()?;
    let mut store = lock_store(&state)?;
    let summary = store.store_repository(builtin_demo::BUILTIN_DEMO_REPOSITORY_URL, &repo)?;
    logging::log_event(
        &state.data_dir,
        "repository_connected",
        &[
            ("url", builtin_demo::BUILTIN_DEMO_REPOSITORY_URL),
            ("repository_id", summary.id.as_str()),
        ],
    );
    Ok(summary)
}

#[tauri::command]
pub fn repair_library(state: State<'_, AppState>) -> Result<RepairLibraryReport, String> {
    let mut store = lock_store(&state)?;
    repair_library_state(&mut store, &state.data_dir)
}

#[tauri::command]
pub async fn refresh_repository(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<RepositorySummary, String> {
    let url = {
        let store = lock_store(&state)?;
        store
            .get_repository_url(&repository_id)?
            .ok_or_else(|| format!("Unknown repository: {repository_id}"))?
    };
    let repo = if builtin_demo::is_builtin_repository_url(&url) {
        load_builtin_demo_repository()?
    } else if is_file_repository_url(&url) {
        load_repository_schema_from_file_url(&url)?.0
    } else {
        let allow_dev_http = cfg!(debug_assertions);
        fetch_repository_schema(&url, allow_dev_http).await?
    };
    let mut store = lock_store(&state)?;
    let summary = store.store_repository(&url, &repo)?;
    logging::log_event(
        &state.data_dir,
        "repository_refreshed",
        &[
            ("url", url.as_str()),
            ("repository_id", summary.id.as_str()),
        ],
    );
    Ok(summary)
}

#[tauri::command]
pub fn list_repositories(state: State<'_, AppState>) -> Result<Vec<RepositorySummary>, String> {
    lock_store(&state)?.list_repositories()
}

#[tauri::command]
pub fn get_onboarding_state(state: State<'_, AppState>) -> Result<OnboardingState, String> {
    let store = lock_store(&state)?;
    let repositories = store.list_repositories()?;
    let catalog = store.get_catalog()?;
    let catalog_count = catalog.len();
    let valid_emulator_platforms = store
        .list_emulator_configs()?
        .into_iter()
        .filter(|config| setup_profiles::has_default_setup_profile(&config.platform))
        .filter(|config| config.status == "valid")
        .map(|config| config.platform)
        .collect::<HashSet<_>>();
    let valid_emulator_count = valid_emulator_platforms.len();
    let catalog_platforms = catalog
        .iter()
        .map(|game| game.platform.clone())
        .collect::<HashSet<_>>();
    let repositories_configured = !repositories.is_empty();
    let emulators_configured = if catalog_platforms.is_empty() {
        valid_emulator_count > 0
    } else {
        catalog_platforms
            .iter()
            .any(|platform| valid_emulator_platforms.contains(platform))
    };
    let step = if !repositories_configured {
        "addRepository"
    } else if !emulators_configured {
        "configureEmulator"
    } else {
        "complete"
    };

    Ok(OnboardingState {
        step: step.to_string(),
        repositories_configured,
        emulators_configured,
        catalog_count,
        valid_emulator_count,
    })
}

#[tauri::command]
pub fn disconnect_repository(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    lock_store(&state)?.disconnect_repository(&repository_id)
}

#[tauri::command]
pub fn get_catalog(state: State<'_, AppState>) -> Result<Vec<CatalogGameView>, String> {
    lock_store(&state)?.get_catalog()
}

#[tauri::command]
pub fn get_game(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CatalogGameView>, String> {
    lock_store(&state)?.get_game(&game_id)
}

#[tauri::command]
pub async fn scrape_game(
    game_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::scraper::scrape_game(app, state.inner().clone(), game_id).await
}

#[tauri::command]
pub fn get_scrape_state(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<ScrapeStateView, String> {
    let store = lock_store(&state)?;
    Ok(store
        .get_scrape_state(&game_id)?
        .unwrap_or_else(|| crate::scraper::default_state(&game_id)))
}

#[tauri::command]
pub fn list_scrape_candidates(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScrapeCandidate>, String> {
    let store = lock_store(&state)?;
    Ok(store
        .get_scrape_state(&game_id)?
        .map(|state| state.candidates)
        .unwrap_or_default())
}

#[tauri::command]
pub async fn apply_scrape_override(
    game_id: String,
    provider_game_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::scraper::apply_override(app, state.inner().clone(), game_id, provider_game_id).await
}

#[tauri::command]
pub fn clear_scrape_override(
    game_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<bool, String> {
    crate::scraper::clear_override(&app, state.inner(), &game_id)
}

#[tauri::command]
pub fn save_screenscraper_credentials(
    ssid: String,
    sspassword: String,
    region: Option<String>,
    state: State<'_, AppState>,
) -> Result<ScreenScraperStatus, String> {
    crate::scraper::save_credentials(state.inner(), &ssid, &sspassword, region.as_deref())
}

#[tauri::command]
pub fn get_screenscraper_status(state: State<'_, AppState>) -> Result<ScreenScraperStatus, String> {
    crate::scraper::get_status(state.inner())
}

#[tauri::command]
pub fn save_steamgriddb_key(
    api_key: String,
    state: State<'_, AppState>,
) -> Result<SteamGridDbStatus, String> {
    crate::scraper::save_steamgriddb_key(state.inner(), &api_key)
}

#[tauri::command]
pub fn get_steamgriddb_status(state: State<'_, AppState>) -> Result<SteamGridDbStatus, String> {
    crate::scraper::get_steamgriddb_status(state.inner())
}

#[tauri::command]
pub fn scrape_library(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<LibraryScrapeStatus, String> {
    crate::scraper::scrape_library(app, state.inner().clone())
}

#[tauri::command]
pub fn cancel_library_scrape(state: State<'_, AppState>) -> Result<LibraryScrapeStatus, String> {
    crate::scraper::cancel_library_scrape(state.inner())
}

#[tauri::command]
pub fn check_requirements(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<RequirementsReport, String> {
    let store = lock_store(&state)?;
    let game = store
        .get_game(&game_id)?
        .ok_or_else(|| format!("Unknown game: {game_id}"))?;
    build_requirements_report(&store, &state.data_dir, &game)
}

#[tauri::command]
pub fn get_library_statuses(state: State<'_, AppState>) -> Result<Vec<LibraryGameStatus>, String> {
    let store = lock_store(&state)?;
    store
        .get_catalog()?
        .iter()
        .map(|game| build_library_status(&store, &state.data_dir, game))
        .collect()
}

#[tauri::command]
pub fn list_platform_setup_profiles() -> Result<Vec<PlatformSetupProfile>, String> {
    Ok(setup_profiles::list_platform_setup_profiles())
}

#[tauri::command]
pub fn get_game_setup_state(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<GameSetupState, String> {
    let store = lock_store(&state)?;
    let game = store
        .get_game(&game_id)?
        .ok_or_else(|| format!("Unknown game: {game_id}"))?;
    build_game_setup_state(&store, &state.data_dir, &game)
}

#[tauri::command]
pub async fn install_profile_emulator(
    profile_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProfileEmulatorConfig, String> {
    let profile = setup_profiles::get_platform_setup_profile(profile_id.trim())
        .ok_or_else(|| format!("Unknown setup profile: {profile_id}"))?;
    if profile.emulator.install_mode != "downloadable" {
        return Err(format!(
            "{} requires manual emulator selection.",
            profile.display_name
        ));
    }

    crate::orchestrator::install_emulator_internal(&app, &state, &profile.platform).await?;
    let store = lock_store(&state)?;
    store
        .get_profile_emulator_config(&profile.id)?
        .ok_or_else(|| format!("{} was installed but not persisted.", profile.display_name))
}

#[tauri::command]
pub fn select_profile_emulator(
    profile_id: String,
    executable_path: String,
    state: State<'_, AppState>,
) -> Result<ProfileEmulatorConfig, String> {
    let profile = setup_profiles::get_platform_setup_profile(profile_id.trim())
        .ok_or_else(|| format!("Unknown setup profile: {profile_id}"))?;
    let normalized_path = executable_path.trim();
    if normalized_path.is_empty() {
        return Err("Emulator executable path is required.".to_string());
    }
    let status = validate_emulator_status(Some(normalized_path));
    let store = lock_store(&state)?;
    let config = store.upsert_profile_emulator_config(
        &profile.id,
        &profile.platform,
        Some(normalized_path),
        status,
        None,
        Some(&profile.launch.args_template),
    )?;
    Ok(config)
}

#[tauri::command]
pub fn import_profile_system_file(
    game_id: String,
    requirement_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<ImportAssetFileReport, String> {
    let store = lock_store(&state)?;
    let game = store
        .get_game(&game_id)?
        .ok_or_else(|| format!("Unknown game: {game_id}"))?;
    let profile = resolve_known_profile(&game)
        .ok_or_else(|| format!("{} does not use a known setup profile.", game.title))?;
    let requirement = profile
        .system_files
        .iter()
        .find(|requirement| requirement.id == requirement_id)
        .ok_or_else(|| format!("Unknown profile system file: {requirement_id}"))?;

    import_profile_system_file_into_store(
        &store,
        &state.data_dir,
        &profile,
        requirement,
        Path::new(source_path.trim()),
    )
}

#[tauri::command]
pub fn list_emulator_configs(state: State<'_, AppState>) -> Result<Vec<EmulatorConfig>, String> {
    let store = lock_store(&state)?;
    let configs = store.list_emulator_configs()?;

    configs
        .into_iter()
        .map(|config| {
            let status = validate_emulator_status(config.exe_path.as_deref());
            store.upsert_emulator_config(
                &config.platform,
                config.exe_path.as_deref(),
                status,
                config.version.as_deref(),
                config.launch_args_template.as_deref(),
            )
        })
        .collect()
}

#[tauri::command]
pub fn save_emulator_config(
    platform: String,
    exe_path: String,
    launch_args_template: Option<String>,
    state: State<'_, AppState>,
) -> Result<EmulatorConfig, String> {
    validate_platform(&platform)?;
    let normalized_path = exe_path.trim();
    let status = validate_emulator_status(Some(normalized_path));
    let template = normalize_launch_args_template(launch_args_template)
        .or_else(|| setup_profiles::default_launch_args_for(&platform));

    lock_store(&state)?.upsert_emulator_config(
        &platform,
        Some(normalized_path),
        status,
        None,
        template.as_deref(),
    )
}

#[tauri::command]
pub fn validate_emulator_config(
    platform: String,
    state: State<'_, AppState>,
) -> Result<EmulatorConfig, String> {
    validate_platform(&platform)?;
    let store = lock_store(&state)?;
    let config = store
        .get_emulator_config(&platform)?
        .ok_or_else(|| format!("No emulator config is stored for {platform}"))?;
    let status = validate_emulator_status(config.exe_path.as_deref());

    store.upsert_emulator_config(
        &platform,
        config.exe_path.as_deref(),
        status,
        config.version.as_deref(),
        config.launch_args_template.as_deref(),
    )
}

#[tauri::command]
pub fn delete_emulator_config(
    platform: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    validate_platform(&platform)?;
    lock_store(&state)?.delete_emulator_config(&platform)
}

#[tauri::command]
pub async fn download_asset(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<DownloadRecord, String> {
    let asset = {
        let store = lock_store(&state)?;
        store
            .get_asset(&asset_id)?
            .ok_or_else(|| format!("Unknown asset: {asset_id}"))?
    };

    let source = asset
        .sources
        .first()
        .ok_or_else(|| format!("Asset {} has no sources.", asset.display_name))?;
    if matches!(source, SourceUri::UserProvided { .. }) {
        let destination = {
            let store = lock_store(&state)?;
            resolve_asset_target(&store, &state.data_dir, &asset, source)
                .map_err(|blocked| blocked.message)?
        };
        let target_path = destination.to_string_lossy().to_string();
        let message = format!(
            "{} is user-provided. Place the file at {} or use Import file.",
            asset.display_name, target_path
        );
        let store = lock_store(&state)?;
        let _ = store.record_asset_installation(
            &asset.id,
            Some(&target_path),
            "missing",
            None,
            Some(&message),
        );
        let _ = store.record_download(&asset.id, "asset", None, None, Some(&message));
        return Err(message);
    }
    let destination = {
        let store = lock_store(&state)?;
        match resolve_asset_target(&store, &state.data_dir, &asset, source) {
            Ok(path) => path,
            Err(blocked) => {
                let _ = store.record_asset_installation(
                    &asset.id,
                    blocked.target_path.as_deref(),
                    "blocked",
                    None,
                    Some(&blocked.message),
                );
                let _ =
                    store.record_download(&asset.id, "asset", None, None, Some(&blocked.message));
                return Err(blocked.message);
            }
        }
    };

    match download_source_to_file(source, &destination).await {
        Ok(file) => {
            let local_path = file.path.to_string_lossy().to_string();
            let store = lock_store(&state)?;
            store.record_asset_installation(
                &asset.id,
                Some(&local_path),
                "ready",
                Some(&file.sha256),
                None,
            )?;
            store.record_download(
                &asset.id,
                "asset",
                Some(&local_path),
                Some(&file.sha256),
                None,
            )
        }
        Err(error) => {
            let store = lock_store(&state)?;
            let target_path = destination.to_string_lossy().to_string();
            let _ = store.record_asset_installation(
                &asset.id,
                Some(&target_path),
                "error",
                None,
                Some(&error),
            );
            let _ = store.record_download(&asset.id, "asset", None, None, Some(&error));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn import_asset_file(
    asset_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<ImportAssetFileReport, String> {
    let store = match lock_store(&state) {
        Ok(store) => store,
        Err(_) => {
            return Ok(import_asset_error("", "store_failed"));
        }
    };

    Ok(import_asset_file_into_store(
        &store,
        &state.data_dir,
        &asset_id,
        Path::new(source_path.trim()),
    ))
}

#[tauri::command]
pub fn import_game_file(
    game_id: String,
    source_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ImportGameFileReport, String> {
    let download_root = match download_root(&state) {
        Ok(path) => path,
        Err(_) => return Ok(import_game_error(&game_id, "", "store_failed", None)),
    };
    let store = match lock_store(&state) {
        Ok(store) => store,
        Err(_) => return Ok(import_game_error("", "", "store_failed", None)),
    };

    let report = import_game_file_into_store(
        &store,
        &download_root,
        &game_id,
        Path::new(source_path.trim()),
    );
    if report.error_code.is_none() {
        spawn_metadata_scrape(&app, state.inner(), report.game_id.clone());
    }
    Ok(report)
}

#[tauri::command]
pub async fn download_game(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<DownloadRecord, String> {
    let game = {
        let store = lock_store(&state)?;
        store
            .get_game(&game_id)?
            .ok_or_else(|| format!("Unknown game: {game_id}"))?
    };

    let source = game
        .downloads
        .first()
        .ok_or_else(|| format!("Game {} has no download sources.", game.title))?;
    if matches!(
        game.content_mode.as_deref(),
        Some("user_provided" | "metadata_only")
    ) || matches!(source, SourceUri::UserProvided { .. })
    {
        return Err(format!(
            "{} is user-provided content. Import your local game file instead of starting an automatic download.",
            game.title
        ));
    }
    let destination = destination_for_source(
        &state.data_dir.join("Games"),
        &game.platform,
        &game.id,
        source,
        &game.title,
    );

    match download_source_to_file(source, &destination).await {
        Ok(file) => {
            let local_path = file.path.to_string_lossy().to_string();
            let total_bytes = source_size_bytes(source).unwrap_or_else(|| file_size(&file.path));
            let (record, _) = lock_store(&state)?.record_direct_game_download_completed(
                &game.id,
                direct_source_kind(source),
                &local_path,
                &file.sha256,
                total_bytes,
            )?;
            Ok(record)
        }
        Err(error) => {
            let _ = lock_store(&state)?.record_download(&game.id, "game", None, None, Some(&error));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn start_game_download(
    game_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GameDownloadStartReport, String> {
    start_game_download_internal(&game_id, &state, &app).await
}

pub(crate) async fn start_game_download_internal(
    game_id: &str,
    state: &AppState,
    app: &AppHandle,
) -> Result<GameDownloadStartReport, String> {
    let game = {
        let store = lock_app_store(state)?;
        store
            .get_game(game_id)?
            .ok_or_else(|| format!("Unknown game: {game_id}"))?
    };
    let source = game
        .downloads
        .first()
        .ok_or_else(|| format!("Game {} has no download sources.", game.title))?;
    if matches!(
        game.content_mode.as_deref(),
        Some("user_provided" | "metadata_only")
    ) || matches!(source, SourceUri::UserProvided { .. })
    {
        return Err(format!(
            "{} is user-provided content. Import your local game file instead of starting an automatic download.",
            game.title
        ));
    }
    let download_root = download_root_for_app_state(state)?;

    match source {
        SourceUri::Magnet {
            uri, size_bytes, ..
        } => {
            preflight_disk_space(&download_root, *size_bytes)?;
            let save_dir = download_root
                .join(crate::downloads::safe_segment(&game.platform))
                .join(crate::downloads::safe_segment(&game.id));
            let save_dir_string = save_dir.to_string_lossy().to_string();
            let torrent = state
                .torrents
                .start_magnet_download(game.id.clone(), uri.clone(), save_dir_string.clone())
                .await?;
            logging::log_event(
                &state.data_dir,
                "game_download_started",
                &[("game_id", game.id.as_str()), ("source", "magnet")],
            );
            Ok(GameDownloadStartReport {
                game_id: game.id,
                source_kind: "magnet".to_string(),
                save_dir: torrent.save_dir.clone(),
                record: None,
                torrent: state.torrents.get_game_download(game_id)?,
            })
        }
        SourceUri::Http { size_bytes, .. } | SourceUri::Bundled { size_bytes, .. } => {
            let source_kind = direct_source_kind(source);
            let destination = destination_for_source(
                &download_root,
                &game.platform,
                &game.id,
                source,
                &game.title,
            );
            let target_path = destination.to_string_lossy().to_string();
            let expected_bytes = size_bytes.unwrap_or(0);

            if let Err(error) = preflight_disk_space(&download_root, *size_bytes) {
                if let Ok(store) = lock_app_store(state) {
                    if let Ok(record) = store.record_direct_game_download_failed(
                        &game.id,
                        source_kind,
                        &target_path,
                        expected_bytes,
                        &error,
                    ) {
                        emit_direct_download_record(app, &record);
                    }
                }
                return Err(error);
            }

            lock_app_store(state)?.record_direct_game_download_started(
                &game.id,
                source_kind,
                &target_path,
                expected_bytes,
            )?;
            logging::log_event(
                &state.data_dir,
                "game_download_started",
                &[("game_id", game.id.as_str()), ("source", source_kind)],
            );

            let download_result = {
                let game_id = game.id.clone();
                crate::downloads::download_source_to_file_with_progress(
                    source,
                    &destination,
                    |downloaded, total| {
                        let percent = match total {
                            Some(total) if total > 0 => (downloaded as f64 / total as f64) * 100.0,
                            _ => 0.0,
                        };
                        if let Ok(store) = lock_app_store(state) {
                            if let Ok(record) = store.update_torrent_progress(
                                &game_id,
                                "downloading",
                                percent,
                                downloaded,
                                total.unwrap_or(0),
                                0,
                                0,
                                0,
                            ) {
                                drop(store);
                                emit_direct_download_record(app, &record);
                            }
                        }
                    },
                )
                .await
            };
            let file = match download_result {
                Ok(file) => file,
                Err(error) => {
                    let failed = lock_app_store(state)?.record_direct_game_download_failed(
                        &game.id,
                        source_kind,
                        &target_path,
                        expected_bytes,
                        &error,
                    )?;
                    emit_direct_download_record(app, &failed);
                    logging::log_event(
                        &state.data_dir,
                        "game_download_failed",
                        &[
                            ("game_id", game.id.as_str()),
                            ("source", source_kind),
                            ("error", error.as_str()),
                        ],
                    );
                    return Err(error);
                }
            };
            let local_path = file.path.to_string_lossy().to_string();
            let total_bytes = size_bytes.unwrap_or_else(|| file_size(&file.path));
            let (record, torrent) = lock_app_store(state)?.record_direct_game_download_completed(
                &game.id,
                source_kind,
                &local_path,
                &file.sha256,
                total_bytes,
            )?;
            emit_direct_download_record(app, &torrent);
            logging::log_event(
                &state.data_dir,
                "game_download_completed",
                &[("game_id", game.id.as_str()), ("source", source_kind)],
            );
            spawn_metadata_scrape(app, state, game.id.clone());
            Ok(GameDownloadStartReport {
                game_id: game.id,
                source_kind: source_kind.to_string(),
                save_dir: local_path,
                record: Some(record),
                torrent: Some(torrent),
            })
        }
        SourceUri::UserProvided { .. } => {
            Err("Game downloads cannot be user-provided.".to_string())
        }
    }
}

#[tauri::command]
pub fn trust_executable(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<TrustedExecutable, String> {
    let store = lock_store(&state)?;
    let asset = store
        .get_asset(&asset_id)?
        .ok_or_else(|| format!("Unknown asset: {asset_id}"))?;
    if !asset.executable {
        return Err(format!(
            "Asset {} is not marked executable.",
            asset.display_name
        ));
    }

    let download = store.get_download(&asset.id)?.ok_or_else(|| {
        format!(
            "Executable asset {} has not been downloaded.",
            asset.display_name
        )
    })?;
    if !is_download_ready_status(&download.status) {
        return Err(format!(
            "Executable asset {} is not ready.",
            asset.display_name
        ));
    }

    let local_path = download
        .local_path
        .ok_or_else(|| format!("Executable asset {} has no local path.", asset.display_name))?;
    let sha256 = download.sha256.ok_or_else(|| {
        format!(
            "Executable asset {} has no verified SHA-256.",
            asset.display_name
        )
    })?;
    if !Path::new(&local_path).exists() {
        return Err(format!("Executable file is missing: {local_path}"));
    }

    store.trust_executable(&asset.id, &local_path, &sha256)
}

#[tauri::command]
pub fn get_download_root(state: State<'_, AppState>) -> Result<String, String> {
    Ok(download_root(&state)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_download_root(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Download folder cannot be empty.".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Download folder must be an absolute path.".to_string());
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create download folder: {error}"))?;
    let value = path.to_string_lossy().to_string();
    lock_store(&state)?.set_config("download_root", &value)?;
    logging::log_event(
        &state.data_dir,
        "download_root_changed",
        &[("path", value.as_str())],
    );
    Ok(value)
}

#[tauri::command]
pub async fn remove_game(
    game_id: String,
    delete_files: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let download = {
        let store = lock_store(&state)?;
        (
            store.get_download(&game_id)?,
            store.get_torrent_download(&game_id)?,
        )
    };

    if let Some(torrent) = download.1.as_ref() {
        if !matches!(torrent.status.as_str(), "completed" | "cancelled") {
            let _ = state.torrents.cancel_download(game_id.clone()).await;
        }
    }

    if delete_files {
        let mut candidates = Vec::new();
        if let Some(record) = download.0.as_ref() {
            if let Some(path) = record.local_path.as_ref() {
                candidates.push(PathBuf::from(path));
            }
        }
        if let Some(torrent) = download.1.as_ref() {
            candidates.push(PathBuf::from(&torrent.save_dir));
        }
        for candidate in candidates {
            remove_path_if_allowed(&state.data_dir, &download_root(&state)?, &candidate)?;
        }
    }

    let store = lock_store(&state)?;
    let mut changed = store.delete_download(&game_id)?;
    changed = store.delete_torrent_download(&game_id)? || changed;
    changed = store.delete_scrape_artifacts(&game_id)? || changed;
    logging::log_event(
        &state.data_dir,
        "game_removed",
        &[("game_id", game_id.as_str())],
    );
    Ok(changed)
}

#[tauri::command]
pub async fn redownload_asset(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<DownloadRecord, String> {
    let current = {
        let store = lock_store(&state)?;
        store.get_download(&asset_id)?
    };
    if let Some(path) = current.and_then(|record| record.local_path) {
        let candidate = PathBuf::from(path);
        let _ = remove_path_if_allowed(&state.data_dir, &download_root(&state)?, &candidate);
    }
    download_asset(asset_id, state).await
}

#[tauri::command]
pub fn open_game_folder(game_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_download(&game_id)?
            .and_then(|download| download.local_path)
            .or_else(|| {
                store
                    .get_torrent_download(&game_id)
                    .ok()
                    .flatten()
                    .map(|record| record.save_dir)
            })
            .ok_or_else(|| format!("Game is not downloaded: {game_id}"))?
    };
    open_path(&folder_path_for_open(Path::new(&path))?)
}

#[tauri::command]
pub fn open_emulator_folder(platform: String, state: State<'_, AppState>) -> Result<(), String> {
    validate_platform(&platform)?;
    let exe_path = lock_store(&state)?
        .get_emulator_config(&platform)?
        .and_then(|config| config.exe_path)
        .ok_or_else(|| format!("No emulator configured for {platform}"))?;
    let parent = Path::new(&exe_path)
        .parent()
        .ok_or_else(|| format!("Emulator path has no parent directory: {exe_path}"))?;
    open_path(parent)
}

#[tauri::command]
pub fn open_logs_folder(state: State<'_, AppState>) -> Result<(), String> {
    open_path(&logging::log_dir(&state.data_dir))
}

#[tauri::command]
pub async fn run_health_check(state: State<'_, AppState>) -> Result<HealthReport, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_health_report(&state))
        .await
        .map_err(|error| format!("Health check task failed: {error}"))?
}

#[tauri::command]
pub fn get_diagnostics_paths(state: State<'_, AppState>) -> DiagnosticsPaths {
    DiagnosticsPaths {
        data_dir: state.data_dir.to_string_lossy().to_string(),
        log_path: logging::log_file_path(&state.data_dir)
            .to_string_lossy()
            .to_string(),
    }
}

#[tauri::command]
pub async fn get_diagnostics_bundle(
    state: State<'_, AppState>,
) -> Result<DiagnosticsBundle, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_diagnostics_bundle(&state))
        .await
        .map_err(|error| format!("Diagnostics task failed: {error}"))?
}

fn build_diagnostics_bundle(state: &AppState) -> Result<DiagnosticsBundle, String> {
    let health = build_health_report(state)?;
    let downloads = state.torrents.list_downloads()?;
    let log_path = logging::log_file_path(&state.data_dir);
    Ok(DiagnosticsBundle {
        generated_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
        health,
        downloads,
        logs: logging::tail_log(&state.data_dir, 500),
    })
}

pub(crate) fn build_requirements_report(
    store: &RepositoryStore,
    data_dir: &Path,
    game: &CatalogGameView,
) -> Result<RequirementsReport, String> {
    let game_downloaded = inspect_game_download(store, game)?.0;
    let assets = store.get_assets(&game.required_system_file_ids)?;
    let mut requirements = Vec::new();

    for asset in assets {
        let download = store.get_download(&asset.id)?;
        let trusted = store.get_trusted_executable(&asset.id)?;
        let installation = inspect_asset_installation(store, data_dir, &asset, download.as_ref())?;
        let downloaded = installation.status == "ready";
        let checksum = expected_asset_sha256(&asset).map(ToString::to_string);
        let trusted_ok = if asset.executable {
            trusted.is_some()
        } else {
            true
        };
        requirements.push(RequirementItem {
            asset,
            status: installation.status,
            downloaded,
            trusted: trusted_ok,
            local_path: download.and_then(|record| record.local_path),
            target_path: installation.target_path,
            checksum,
            sha256: installation.sha256,
            message: installation.message,
        });
    }

    let ready = game_downloaded
        && requirements
            .iter()
            .all(|item| item.downloaded && item.trusted);
    Ok(RequirementsReport {
        game_id: game.id.clone(),
        ready,
        game_downloaded,
        requirements,
    })
}

pub(crate) fn build_game_setup_state(
    store: &RepositoryStore,
    data_dir: &Path,
    game: &CatalogGameView,
) -> Result<GameSetupState, String> {
    let profile = resolve_known_profile(game);
    let unsupported_profile_id = match game.setup_profile_id.as_deref() {
        Some(profile_id) if profile.is_none() => Some(profile_id.to_string()),
        _ => None,
    };

    let repository_requirements = build_requirements_report(store, data_dir, game)?.requirements;
    let expected_extensions = resolved_expected_extensions(game, profile.as_ref());
    let preferred_file = game
        .launch
        .as_ref()
        .and_then(|launch| launch.preferred_file.as_deref())
        .or_else(|| {
            profile
                .as_ref()
                .and_then(|profile| profile.launch.preferred_file.as_deref())
        });
    let game_file = inspect_game_setup_file(store, game, &expected_extensions, preferred_file)?;
    let emulator = build_setup_emulator_state(store, game, profile.as_ref())?;
    let system_files = if let Some(profile) = profile.as_ref() {
        profile
            .system_files
            .iter()
            .map(|requirement| inspect_profile_system_file(store, data_dir, profile, requirement))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };

    let mut blockers = Vec::new();
    if let Some(profile_id) = unsupported_profile_id.as_ref() {
        blockers.push(format!("Unsupported setup profile: {profile_id}"));
    }
    if emulator.status != "ready" {
        blockers.push(
            emulator
                .message
                .clone()
                .unwrap_or_else(|| format!("Configure {}", emulator.emulator_name)),
        );
    }
    for item in &system_files {
        if item.required && item.status != "ready" {
            blockers.push(format!("Import {}", item.label));
        }
    }
    for item in &repository_requirements {
        if item.status != "ready" || !item.trusted {
            blockers.push(format!("Install {}", item.asset.display_name));
        }
    }
    if game_file.status != "ready" {
        blockers.push(
            game_file
                .message
                .clone()
                .unwrap_or_else(|| "Game file is missing.".to_string()),
        );
    }

    let launch = GameSetupLaunchState {
        status: if blockers.is_empty() {
            "ready".to_string()
        } else {
            "blocked".to_string()
        },
        blockers,
    };
    let primary_action =
        derive_primary_setup_action(game, &emulator, &system_files, &game_file, &launch);

    Ok(GameSetupState {
        game_id: game.id.clone(),
        profile_id: profile
            .as_ref()
            .map(|profile| profile.id.clone())
            .or_else(|| game.setup_profile_id.clone()),
        profile_display_name: profile.as_ref().map(|profile| profile.display_name.clone()),
        unsupported_profile_id,
        emulator,
        system_files,
        repository_requirements,
        game_file,
        launch,
        primary_action,
    })
}

pub(crate) fn resolved_expected_extensions(
    game: &CatalogGameView,
    profile: Option<&PlatformSetupProfile>,
) -> Vec<String> {
    profile
        .map(|profile| profile.game_files.expected_extensions.clone())
        .filter(|extensions| !extensions.is_empty())
        .unwrap_or_else(|| game.expected_extensions.clone())
}

pub(crate) fn resolve_known_profile(game: &CatalogGameView) -> Option<PlatformSetupProfile> {
    game.setup_profile_id
        .as_deref()
        .and_then(setup_profiles::get_platform_setup_profile)
        .or_else(|| setup_profiles::get_default_platform_setup_profile(&game.platform))
}

fn build_setup_emulator_state(
    store: &RepositoryStore,
    game: &CatalogGameView,
    profile: Option<&PlatformSetupProfile>,
) -> Result<GameSetupEmulatorState, String> {
    if let Some(profile) = profile {
        let profile_config = store.get_profile_emulator_config(&profile.id)?;
        let exe_path = profile_config
            .as_ref()
            .and_then(|config| config.exe_path.clone());
        let status = validate_emulator_status(exe_path.as_deref());
        let ready = status == "valid";
        return Ok(GameSetupEmulatorState {
            status: if ready {
                "ready".to_string()
            } else if profile.emulator.install_mode == "manual" {
                "manual_required".to_string()
            } else {
                "missing".to_string()
            },
            profile_id: Some(profile.id.clone()),
            platform: profile.platform.clone(),
            emulator_name: profile.emulator.emulator_name.clone(),
            install_mode: profile.emulator.install_mode.clone(),
            executable_path: exe_path,
            message: if ready {
                None
            } else if profile.emulator.install_mode == "downloadable" {
                Some(format!("Install {}", profile.emulator.emulator_name))
            } else {
                Some(format!("Select {}", profile.emulator.emulator_name))
            },
        });
    }

    let config = store.get_emulator_config(&game.platform)?;
    let exe_path = config.as_ref().and_then(|config| config.exe_path.clone());
    let status = validate_emulator_status(exe_path.as_deref());
    Ok(GameSetupEmulatorState {
        status: if status == "valid" {
            "ready".to_string()
        } else {
            "manual_required".to_string()
        },
        profile_id: None,
        platform: game.platform.clone(),
        emulator_name: setup_profiles::platform_emulator_name(&game.platform)
            .unwrap_or_else(|| format!("{} emulator", game.platform.to_uppercase())),
        install_mode: "manual".to_string(),
        executable_path: exe_path,
        message: if status == "valid" {
            None
        } else {
            Some(format!(
                "Configure {} emulator",
                game.platform.to_uppercase()
            ))
        },
    })
}

fn inspect_game_setup_file(
    store: &RepositoryStore,
    game: &CatalogGameView,
    expected_extensions: &[String],
    preferred_file: Option<&str>,
) -> Result<GameSetupGameFileState, String> {
    let local_path = store
        .get_download(&game.id)?
        .filter(|download| matches!(download.status.as_str(), "ready" | "completed"))
        .and_then(|download| download.local_path)
        .or_else(|| {
            store
                .get_torrent_download(&game.id)
                .ok()
                .flatten()
                .filter(|record| record.status == "completed")
                .map(|record| record.save_dir)
        });
    let Some(local_path) = local_path else {
        return Ok(GameSetupGameFileState {
            status: "missing".to_string(),
            installed_path: None,
            expected_extensions: expected_extensions.to_vec(),
            allow_directory: true,
            message: Some("Game file is missing.".to_string()),
        });
    };

    let (status, message) =
        game_files::inspect_game_path(Path::new(&local_path), expected_extensions, preferred_file);
    Ok(GameSetupGameFileState {
        status: if status == "ready" {
            "ready".to_string()
        } else {
            "invalid".to_string()
        },
        installed_path: Some(local_path),
        expected_extensions: expected_extensions.to_vec(),
        allow_directory: true,
        message,
    })
}

fn inspect_profile_system_file(
    store: &RepositoryStore,
    data_dir: &Path,
    profile: &PlatformSetupProfile,
    requirement: &ProfileSystemFileRequirement,
) -> Result<GameSetupSystemFileState, String> {
    let import = store.get_profile_system_file_import(&profile.id, &requirement.id)?;
    let target = import
        .as_ref()
        .and_then(|import| import.target_path.clone())
        .unwrap_or_else(|| {
            profile_system_file_target(data_dir, profile, requirement)
                .to_string_lossy()
                .to_string()
        });
    let path = Path::new(&target);
    let mut status = "missing".to_string();
    let mut message = requirement.notes.clone();

    if path.exists() && path.is_file() {
        if !profile_system_file_matches_extension(path, requirement) {
            status = "corrupt".to_string();
            message = Some(format!(
                "{} has an unsupported extension. Expected: {}",
                requirement.label,
                requirement.extensions.join(", ")
            ));
        } else {
            let actual = hash_file(path)?;
            if let Some(expected) = requirement.checksum.as_deref() {
                if !actual.eq_ignore_ascii_case(expected) {
                    status = "corrupt".to_string();
                    message = Some(format!(
                        "SHA-256 mismatch: expected {expected}, got {actual}"
                    ));
                } else {
                    status = "ready".to_string();
                    message = Some(target.clone());
                }
            } else {
                status = "ready".to_string();
                message = Some(target.clone());
            }
        }
    }

    Ok(GameSetupSystemFileState {
        id: requirement.id.clone(),
        label: requirement.label.clone(),
        asset_kind: requirement.asset_kind.clone(),
        required: requirement.required,
        status,
        installed_path: if path.exists() { Some(target) } else { None },
        expected_extensions: requirement.extensions.clone(),
        checksum: requirement.checksum.clone(),
        message,
    })
}

fn derive_primary_setup_action(
    game: &CatalogGameView,
    emulator: &GameSetupEmulatorState,
    system_files: &[GameSetupSystemFileState],
    game_file: &GameSetupGameFileState,
    launch: &GameSetupLaunchState,
) -> String {
    if launch.status == "ready" {
        return "play".to_string();
    }
    if game_file.status != "ready" && is_user_provided_game(game) {
        return "import_game".to_string();
    }
    if game_file.status != "ready" && is_downloadable_game(game) {
        return "download".to_string();
    }
    if emulator.status != "ready"
        || system_files
            .iter()
            .any(|item| item.required && item.status != "ready")
    {
        return "setup".to_string();
    }
    "details".to_string()
}

fn import_profile_system_file_into_store(
    store: &RepositoryStore,
    data_dir: &Path,
    profile: &PlatformSetupProfile,
    requirement: &ProfileSystemFileRequirement,
    source_path: &Path,
) -> Result<ImportAssetFileReport, String> {
    if requirement.source_mode != "user_provided" {
        return Ok(import_asset_error("", "unsupported_target"));
    }
    if let Err(error) = validate_import_source(source_path) {
        return Ok(import_asset_error("", error.code));
    }
    if !profile_system_file_matches_extension(source_path, requirement) {
        return Ok(import_asset_error("", "wrong_extension"));
    }

    let target = profile_system_file_target(data_dir, profile, requirement);
    let installed_path = target.to_string_lossy().to_string();
    match copy_user_file_to_target(source_path, &target, requirement.checksum.as_deref()) {
        Ok(imported) => {
            store.record_profile_system_file_import(
                &profile.id,
                &requirement.id,
                Some(&imported.installed_path),
                "ready",
                Some(&imported.sha256),
                None,
            )?;
            Ok(ImportAssetFileReport {
                status: imported.status.to_string(),
                installed_path: imported.installed_path,
                error_code: None,
            })
        }
        Err(error) => {
            let _ = store.record_profile_system_file_import(
                &profile.id,
                &requirement.id,
                Some(&installed_path),
                "error",
                error.sha256.as_deref(),
                Some(error.code),
            );
            Ok(import_asset_error(installed_path, error.code))
        }
    }
}

fn profile_system_file_target(
    data_dir: &Path,
    profile: &PlatformSetupProfile,
    requirement: &ProfileSystemFileRequirement,
) -> PathBuf {
    let target = requirement
        .target_name
        .as_deref()
        .and_then(|target_name| safe_relative_path_or_default(Some(target_name), &requirement.id))
        .unwrap_or_else(|| {
            PathBuf::from(format!(
                "{}{}",
                crate::downloads::safe_segment(&requirement.id),
                requirement
                    .extensions
                    .first()
                    .cloned()
                    .unwrap_or_else(|| ".bin".to_string())
            ))
        });
    data_dir
        .join("System")
        .join(crate::downloads::safe_segment(&profile.platform))
        .join(target)
}

fn profile_system_file_matches_extension(
    source_path: &Path,
    requirement: &ProfileSystemFileRequirement,
) -> bool {
    if requirement.extensions.is_empty() {
        return true;
    }
    source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{}", extension.to_lowercase()))
        .map(|extension| {
            requirement
                .extensions
                .iter()
                .any(|expected| expected.eq_ignore_ascii_case(&extension))
        })
        .unwrap_or(false)
}

fn is_user_provided_game(game: &CatalogGameView) -> bool {
    game.content_mode.as_deref() == Some("user_provided")
        || game
            .downloads
            .iter()
            .any(|source| matches!(source, SourceUri::UserProvided { .. }))
}

fn is_downloadable_game(game: &CatalogGameView) -> bool {
    !matches!(
        game.content_mode.as_deref(),
        Some("user_provided" | "metadata_only")
    ) && game.downloads.iter().any(|source| {
        matches!(
            source,
            SourceUri::Http { .. } | SourceUri::Bundled { .. } | SourceUri::Magnet { .. }
        )
    })
}

fn inspect_game_download(
    store: &RepositoryStore,
    game: &CatalogGameView,
) -> Result<(bool, Option<String>, Option<String>), String> {
    let local_path = store
        .get_download(&game.id)?
        .and_then(|download| download.local_path);
    let local_path = match local_path {
        Some(local_path) => Some(local_path),
        None => store
            .get_torrent_download(&game.id)?
            .filter(|record| record.status == "completed")
            .map(|record| record.save_dir),
    };
    let Some(local_path) = local_path else {
        return Ok((false, None, None));
    };

    let profile = resolve_known_profile(game);
    let preferred_file = game
        .launch
        .as_ref()
        .and_then(|launch| launch.preferred_file.as_deref())
        .or_else(|| {
            profile
                .as_ref()
                .and_then(|profile| profile.launch.preferred_file.as_deref())
        });
    let expected_extensions = resolved_expected_extensions(game, profile.as_ref());
    let (status, message) =
        game_files::inspect_game_path(Path::new(&local_path), &expected_extensions, preferred_file);

    Ok((status == "ready", Some(status), message))
}

fn build_library_status(
    store: &RepositoryStore,
    data_dir: &Path,
    game: &CatalogGameView,
) -> Result<LibraryGameStatus, String> {
    let requirements = build_requirements_report(store, data_dir, game)?;
    let download = store.get_torrent_download(&game.id)?;
    let game_file = inspect_game_download(store, game)?;
    let installed = game_file.1.is_some()
        || download
            .as_ref()
            .map(|record| record.status == "completed")
            .unwrap_or(false);
    let mut missing_requirements = Vec::new();

    for item in requirements.requirements {
        match item.status.as_str() {
            "ready" => {
                if !item.trusted {
                    missing_requirements
                        .push(format!("{} is not trusted", item.asset.display_name));
                }
            }
            "corrupt" => {
                missing_requirements.push(format!("{} is corrupt", item.asset.display_name));
            }
            "blocked" => {
                missing_requirements.push(item.message.unwrap_or_else(|| {
                    format!("{} cannot be installed yet", item.asset.display_name)
                }));
            }
            "error" => {
                missing_requirements.push(
                    item.message.unwrap_or_else(|| {
                        format!("{} installation failed", item.asset.display_name)
                    }),
                );
            }
            _ => {
                missing_requirements.push(format!("{} is not installed", item.asset.display_name));
            }
        }
    }
    if let (Some("missing" | "corrupt" | "error"), Some(message)) =
        (game_file.1.as_deref(), game_file.2)
    {
        missing_requirements.push(format!("Game file: {message}"));
    }

    Ok(LibraryGameStatus {
        game_id: game.id.clone(),
        installed,
        system_requirements_ready: missing_requirements.is_empty(),
        missing_requirements,
        download,
    })
}

struct BlockedAssetTarget {
    target_path: Option<String>,
    message: String,
}

struct ImportedUserFile {
    status: &'static str,
    installed_path: String,
    sha256: String,
}

struct ImportFileError {
    code: &'static str,
    sha256: Option<String>,
}

fn import_file_error(code: &'static str) -> ImportFileError {
    ImportFileError { code, sha256: None }
}

fn validate_import_source(source_path: &Path) -> Result<(), ImportFileError> {
    if source_path.as_os_str().is_empty() || !source_path.exists() {
        return Err(import_file_error("source_missing"));
    }
    if !source_path.is_file() {
        return Err(import_file_error("source_not_file"));
    }
    Ok(())
}

fn copy_user_file_to_target(
    source_path: &Path,
    target: &Path,
    expected_sha256: Option<&str>,
) -> Result<ImportedUserFile, ImportFileError> {
    let installed_path = target.to_string_lossy().to_string();

    if target.exists() && target.is_file() {
        match hash_file(target) {
            Ok(actual_sha256)
                if expected_sha256
                    .map(|expected| actual_sha256.eq_ignore_ascii_case(expected))
                    .unwrap_or(true) =>
            {
                return Ok(ImportedUserFile {
                    status: "already_installed",
                    installed_path,
                    sha256: actual_sha256,
                });
            }
            Ok(_) => {}
            Err(_) => return Err(import_file_error("copy_failed")),
        }
    }

    validate_import_source(source_path)?;
    let source_sha256 = hash_file(source_path).map_err(|_| import_file_error("copy_failed"))?;
    if let Some(expected_sha256) = expected_sha256 {
        if !source_sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(ImportFileError {
                code: "checksum_mismatch",
                sha256: Some(source_sha256),
            });
        }
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| import_file_error("copy_failed"))?;
    }
    fs::copy(source_path, target).map_err(|_| import_file_error("copy_failed"))?;

    let installed_sha256 = hash_file(target).map_err(|_| import_file_error("copy_failed"))?;
    if let Some(expected_sha256) = expected_sha256 {
        if !installed_sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(ImportFileError {
                code: "checksum_mismatch",
                sha256: Some(installed_sha256),
            });
        }
    }

    Ok(ImportedUserFile {
        status: "installed",
        installed_path,
        sha256: installed_sha256,
    })
}

fn resolve_asset_target(
    store: &RepositoryStore,
    data_dir: &Path,
    asset: &AssetView,
    source: &SourceUri,
) -> Result<PathBuf, BlockedAssetTarget> {
    let Some(hint) = asset.install_hint.as_ref() else {
        return Ok(destination_for_source(
            &data_dir.join("System"),
            &asset.platform,
            &asset.id,
            source,
            &asset.display_name,
        ));
    };

    match &hint.target {
        InstallTarget::AppSystem => {
            let Some(relative_path) = safe_relative_path_or_default(
                hint.relative_path.as_deref(),
                &file_name_for_source(source, &asset.display_name),
            ) else {
                return Err(blocked_asset(None, "System file install path is invalid."));
            };
            Ok(data_dir
                .join("System")
                .join(&asset.platform)
                .join(relative_path))
        }
        InstallTarget::EmulatorDir => {
            let config = store
                .get_emulator_config(&asset.platform)
                .map_err(|message| blocked_asset(None, message))?
                .ok_or_else(|| {
                    blocked_asset(
                        None,
                        format!(
                            "Configure the emulator for {} before installing {}.",
                            asset.platform, asset.display_name
                        ),
                    )
                })?;
            let exe_path = config.exe_path.as_deref().ok_or_else(|| {
                blocked_asset(
                    None,
                    format!(
                        "Configure the emulator for {} before installing {}.",
                        asset.platform, asset.display_name
                    ),
                )
            })?;
            let emulator_path = Path::new(exe_path);
            if validate_emulator_status(Some(exe_path)) != "valid" {
                return Err(blocked_asset(
                    Some(exe_path.to_string()),
                    format!(
                        "Emulator path for {} is not valid: {}",
                        asset.platform, exe_path
                    ),
                ));
            }
            let parent = emulator_path.parent().ok_or_else(|| {
                blocked_asset(
                    Some(exe_path.to_string()),
                    format!("Emulator path has no parent directory: {exe_path}"),
                )
            })?;
            let Some(relative_path) = safe_relative_path_or_default(
                hint.relative_path.as_deref(),
                &file_name_for_source(source, &asset.display_name),
            ) else {
                return Err(blocked_asset(None, "System file install path is invalid."));
            };
            Ok(parent.join(relative_path))
        }
        InstallTarget::UserSelected => Err(blocked_asset(
            None,
            format!(
                "{} requires a user-selected install path, which is not supported in v1.",
                asset.display_name
            ),
        )),
    }
}

fn inspect_asset_installation(
    store: &RepositoryStore,
    data_dir: &Path,
    asset: &AssetView,
    download: Option<&DownloadRecord>,
) -> Result<crate::schema::AssetInstallation, String> {
    let source = asset.sources.first();
    let expected_sha256 = expected_asset_sha256(asset);
    let target = match download
        .filter(|record| is_download_ready_status(&record.status))
        .and_then(|record| record.local_path.as_ref())
        .map(PathBuf::from)
    {
        Some(path) => Ok(path),
        None => {
            if let Some(source) = source {
                resolve_asset_target(store, data_dir, asset, source)
            } else {
                Err(blocked_asset(
                    None,
                    format!("{} has no sources.", asset.display_name),
                ))
            }
        }
    };

    let target = match target {
        Ok(path) => path,
        Err(blocked) => {
            return store.record_asset_installation(
                &asset.id,
                blocked.target_path.as_deref(),
                "blocked",
                None,
                Some(&blocked.message),
            );
        }
    };
    let target_path = target.to_string_lossy().to_string();

    if !target.exists() {
        return store.record_asset_installation(
            &asset.id,
            Some(&target_path),
            "missing",
            None,
            None,
        );
    }

    if !target.is_file() {
        return store.record_asset_installation(
            &asset.id,
            Some(&target_path),
            "error",
            None,
            Some("System file target is not a file."),
        );
    }

    if let Some(expected_sha256) = expected_sha256 {
        let actual_sha256 = hash_file(&target)?;
        if actual_sha256.eq_ignore_ascii_case(expected_sha256) {
            store.record_asset_installation(
                &asset.id,
                Some(&target_path),
                "ready",
                Some(&actual_sha256),
                None,
            )
        } else {
            store.record_asset_installation(
                &asset.id,
                Some(&target_path),
                "corrupt",
                Some(&actual_sha256),
                Some(&format!(
                    "SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}"
                )),
            )
        }
    } else {
        store.record_asset_installation(&asset.id, Some(&target_path), "ready", None, None)
    }
}

fn import_asset_file_into_store(
    store: &RepositoryStore,
    data_dir: &Path,
    asset_id: &str,
    source_path: &Path,
) -> ImportAssetFileReport {
    let asset = match store.get_asset(asset_id) {
        Ok(Some(asset)) => asset,
        Ok(None) => return import_asset_error("", "unknown_asset"),
        Err(_) => return import_asset_error("", "store_failed"),
    };

    let Some(source) = asset.sources.first() else {
        return import_asset_error("", "unsupported_target");
    };
    if !matches!(source, SourceUri::UserProvided { .. }) {
        return import_asset_error("", "unsupported_target");
    }

    let target = match resolve_asset_target(store, data_dir, &asset, source) {
        Ok(target) => target,
        Err(blocked) => {
            return import_asset_error(
                blocked.target_path.unwrap_or_default(),
                "unsupported_target",
            )
        }
    };
    let installed_path = target.to_string_lossy().to_string();
    let checksum = expected_asset_sha256(&asset);

    match copy_user_file_to_target(source_path, &target, checksum) {
        Ok(imported) => {
            if record_imported_asset(
                store,
                &asset.id,
                &imported.installed_path,
                Some(&imported.sha256),
            )
            .is_err()
            {
                return import_asset_error(imported.installed_path, "store_failed");
            }
            ImportAssetFileReport {
                status: imported.status.to_string(),
                installed_path: imported.installed_path,
                error_code: None,
            }
        }
        Err(error) => {
            if error.code == "checksum_mismatch" {
                let expected_sha256 = checksum.unwrap_or("");
                let actual_sha256 = error.sha256.as_deref().unwrap_or("");
                let _ = store.record_asset_installation(
                    &asset.id,
                    Some(&installed_path),
                    "error",
                    error.sha256.as_deref(),
                    Some(&format!(
                        "SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}"
                    )),
                );
            }
            import_asset_error(installed_path, error.code)
        }
    }
}

fn import_game_file_into_store(
    store: &RepositoryStore,
    download_root: &Path,
    game_id: &str,
    source_path: &Path,
) -> ImportGameFileReport {
    let game = match store.get_game(game_id) {
        Ok(Some(game)) => game,
        Ok(None) => return import_game_error(game_id, "", "unknown_game", None),
        Err(_) => return import_game_error(game_id, "", "store_failed", None),
    };

    if game.content_mode.as_deref() == Some("metadata_only") {
        return import_game_error(&game.id, "", "unsupported_target", None);
    }
    let user_source = game
        .downloads
        .iter()
        .find(|source| matches!(source, SourceUri::UserProvided { .. }));
    if game.content_mode.as_deref() != Some("user_provided") && user_source.is_none() {
        return import_game_error(&game.id, "", "unsupported_target", None);
    }
    let expected_sha256 = user_source.and_then(|source| match source {
        SourceUri::UserProvided { sha256, .. } => sha256.as_deref(),
        _ => None,
    });

    if let Err(error) = validate_import_source(source_path) {
        return import_game_error(&game.id, "", error.code, None);
    }
    let profile = resolve_known_profile(&game);
    let expected_extensions = resolved_expected_extensions(&game, profile.as_ref());
    if !source_matches_expected_extension(source_path, &expected_extensions) {
        return import_game_error(&game.id, "", "wrong_extension", None);
    }

    let target = imported_game_target(download_root, &game, source_path);
    let installed_path = target.to_string_lossy().to_string();
    match copy_user_file_to_target(source_path, &target, expected_sha256) {
        Ok(imported) => {
            let total_bytes = file_size(Path::new(&imported.installed_path));
            if store
                .record_direct_game_download_completed(
                    &game.id,
                    "user_import",
                    &imported.installed_path,
                    &imported.sha256,
                    total_bytes,
                )
                .is_err()
            {
                return import_game_error(
                    &game.id,
                    &imported.installed_path,
                    "store_failed",
                    Some(imported.sha256),
                );
            }
            if store
                .upsert_rom_hash_sha256(&game.id, &imported.sha256, total_bytes)
                .is_err()
            {
                return import_game_error(
                    &game.id,
                    &imported.installed_path,
                    "store_failed",
                    Some(imported.sha256),
                );
            }
            ImportGameFileReport {
                status: imported.status.to_string(),
                game_id: game.id,
                installed_path: imported.installed_path,
                sha256: Some(imported.sha256),
                error_code: None,
            }
        }
        Err(error) => import_game_error(&game.id, &installed_path, error.code, error.sha256),
    }
}

fn imported_game_target(
    download_root: &Path,
    game: &CatalogGameView,
    source_path: &Path,
) -> PathBuf {
    let file_name = source_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(crate::downloads::safe_segment)
        .filter(|file_name| !file_name.is_empty())
        .unwrap_or_else(|| crate::downloads::safe_segment(&game.title));
    download_root
        .join(crate::downloads::safe_segment(&game.platform))
        .join(crate::downloads::safe_segment(&game.id))
        .join(file_name)
}

fn source_matches_expected_extension(source_path: &Path, expected_extensions: &[String]) -> bool {
    let Some(extension) = source_path
        .extension()
        .and_then(|extension| extension.to_str())
    else {
        return false;
    };
    let extension = format!(".{}", extension.to_ascii_lowercase());
    expected_extensions
        .iter()
        .any(|expected| expected.eq_ignore_ascii_case(&extension))
}

fn import_game_error(
    game_id: impl Into<String>,
    installed_path: impl Into<String>,
    error_code: impl Into<String>,
    sha256: Option<String>,
) -> ImportGameFileReport {
    ImportGameFileReport {
        status: "error".to_string(),
        game_id: game_id.into(),
        installed_path: installed_path.into(),
        sha256,
        error_code: Some(error_code.into()),
    }
}

fn record_imported_asset(
    store: &RepositoryStore,
    asset_id: &str,
    installed_path: &str,
    sha256: Option<&str>,
) -> Result<(), String> {
    store.record_asset_installation(asset_id, Some(installed_path), "ready", sha256, None)?;
    store.record_imported_asset_download(asset_id, installed_path, sha256)?;
    Ok(())
}

fn import_asset_error(
    installed_path: impl Into<String>,
    error_code: impl Into<String>,
) -> ImportAssetFileReport {
    ImportAssetFileReport {
        status: "error".to_string(),
        installed_path: installed_path.into(),
        error_code: Some(error_code.into()),
    }
}

fn expected_asset_sha256(asset: &AssetView) -> Option<&str> {
    asset.sources.iter().find_map(|source| match source {
        SourceUri::Http { sha256, .. } => Some(sha256.as_str()),
        SourceUri::Bundled { sha256, .. } => Some(sha256.as_str()),
        SourceUri::Magnet { .. } => None,
        SourceUri::UserProvided { sha256, .. } => sha256.as_deref(),
    })
}

fn is_download_ready_status(status: &str) -> bool {
    matches!(status, "ready" | "completed")
}

fn source_size_bytes(source: &SourceUri) -> Option<u64> {
    match source {
        SourceUri::Http { size_bytes, .. }
        | SourceUri::Bundled { size_bytes, .. }
        | SourceUri::Magnet { size_bytes, .. }
        | SourceUri::UserProvided { size_bytes, .. } => *size_bytes,
    }
}

fn direct_source_kind(source: &SourceUri) -> &'static str {
    match source {
        SourceUri::Bundled { .. } => "bundled",
        SourceUri::Http { .. } => "http",
        SourceUri::Magnet { .. } => "magnet",
        SourceUri::UserProvided { .. } => "user_provided",
    }
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn blocked_asset(target_path: Option<String>, message: impl Into<String>) -> BlockedAssetTarget {
    BlockedAssetTarget {
        target_path,
        message: message.into(),
    }
}

fn safe_relative_path_or_default(input: Option<&str>, fallback_file_name: &str) -> Option<PathBuf> {
    let raw = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_file_name);
    let path = Path::new(raw);
    if path.is_absolute() {
        return None;
    }

    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => sanitized.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if sanitized.as_os_str().is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn validate_emulator_status(exe_path: Option<&str>) -> &'static str {
    let Some(exe_path) = exe_path.map(str::trim).filter(|value| !value.is_empty()) else {
        return "invalid";
    };
    let path = Path::new(exe_path);
    if !path.exists() {
        return "missing";
    }
    if !path.is_file() {
        return "invalid";
    }
    if cfg!(windows)
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| !extension.eq_ignore_ascii_case("exe"))
            .unwrap_or(true)
    {
        return "invalid";
    }

    "valid"
}

fn normalize_launch_args_template(value: Option<String>) -> Option<String> {
    value
        .map(|template| template.trim().to_string())
        .filter(|template| !template.is_empty())
}

async fn fetch_repository_schema(
    url: &str,
    allow_dev_http: bool,
) -> Result<RepositorySchema, String> {
    let parsed = validate_repository_url(url, allow_dev_http)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Failed to initialize repository client: {error}"))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch repository: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Repository returned an error: {error}"))?;
    let repo = response
        .json::<RepositorySchema>()
        .await
        .map_err(|error| format!("Repository JSON is invalid: {error}"))?;
    validate_repository_schema(&repo, allow_dev_http)?;
    Ok(repo)
}

fn load_repository_schema_from_file(path: &str) -> Result<(RepositorySchema, String), String> {
    let path = normalize_repository_file_path(path)?;
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read repository JSON file: {error}"))?;
    let repo = serde_json::from_str::<RepositorySchema>(&raw)
        .map_err(|error| format!("Repository JSON is invalid: {error}"))?;
    validate_repository_schema(&repo, cfg!(debug_assertions))?;
    Ok((repo, file_url_for_path(&path)?))
}

fn load_repository_schema_from_file_url(url: &str) -> Result<(RepositorySchema, String), String> {
    let parsed =
        Url::parse(url).map_err(|error| format!("Invalid file repository URL: {error}"))?;
    if parsed.scheme() != "file" {
        return Err(format!(
            "Unsupported repository URL scheme: {}",
            parsed.scheme()
        ));
    }
    let path = parsed
        .to_file_path()
        .map_err(|_| "Invalid file repository URL path.".to_string())?;
    load_repository_schema_from_file(&path.to_string_lossy())
}

fn normalize_repository_file_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Repository file path cannot be empty.".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!(
            "Repository file does not exist: {}",
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!("Repository path is not a file: {}", path.display()));
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("json"))
        .unwrap_or(true)
    {
        return Err("Repository file must be a .json file.".to_string());
    }
    fs::canonicalize(&path).map_err(|error| format!("Failed to inspect repository file: {error}"))
}

fn file_url_for_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| format!("Failed to convert path to file URL: {}", path.display()))
}

fn is_file_repository_url(url: &str) -> bool {
    Url::parse(url)
        .map(|parsed| parsed.scheme() == "file")
        .unwrap_or(false)
}

fn load_builtin_demo_repository() -> Result<RepositorySchema, String> {
    let repo = builtin_demo::repository_schema()?;
    builtin_demo::verify_embedded_assets(&repo)?;
    Ok(repo)
}

pub(crate) fn repair_library_state(
    store: &mut RepositoryStore,
    data_dir: &Path,
) -> Result<RepairLibraryReport, String> {
    const LEGACY_DEMO_URL: &str = "http://localhost:3000/demo-repository.json";
    const LEGACY_DEMO_GAME_IDS: &[&str] = &[
        "retrohydra-demo::nes_http_smoke",
        "retrohydra-demo::ps1_magnet_transport_smoke",
    ];
    const LEGACY_DEMO_ASSET_IDS: &[&str] = &[
        "retrohydra-demo::ps1_bios_scph1001",
        "retrohydra-demo::switch_prod_keys",
    ];

    let Some(url) = store.get_repository_url("retrohydra-demo")? else {
        return Ok(RepairLibraryReport {
            repaired: false,
            repository_id: None,
            removed_paths: Vec::new(),
        });
    };
    if url.trim() != LEGACY_DEMO_URL {
        return Ok(RepairLibraryReport {
            repaired: false,
            repository_id: Some("retrohydra-demo".to_string()),
            removed_paths: Vec::new(),
        });
    }

    let mut stale_paths = Vec::new();
    for game_id in LEGACY_DEMO_GAME_IDS {
        if let Some(path) = store
            .get_download(game_id)?
            .and_then(|record| record.local_path)
        {
            stale_paths.push(path);
        }
        if let Some(path) = store
            .get_torrent_download(game_id)?
            .map(|record| record.save_dir)
        {
            stale_paths.push(path);
        }
    }

    let repo = load_builtin_demo_repository()?;
    store.store_repository(builtin_demo::BUILTIN_DEMO_REPOSITORY_URL, &repo)?;
    for game_id in LEGACY_DEMO_GAME_IDS {
        store.delete_game_download_state(game_id)?;
    }
    for asset_id in LEGACY_DEMO_ASSET_IDS {
        store.delete_asset_state(asset_id)?;
    }

    let download_root = store
        .get_config("download_root")?
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("Games"));
    let mut removed_paths = Vec::new();
    for stale_path in stale_paths {
        let path = PathBuf::from(&stale_path);
        if path.exists() {
            remove_path_if_allowed(data_dir, &download_root, &path)?;
            removed_paths.push(stale_path);
        }
    }

    Ok(RepairLibraryReport {
        repaired: true,
        repository_id: Some("retrohydra-demo".to_string()),
        removed_paths,
    })
}

fn build_repository_preview(url: &str, repo: &RepositorySchema) -> RepositoryPreview {
    let raw_json = serde_json::to_vec(repo).unwrap_or_default();
    let content_hash = repo
        .metadata
        .content_hash
        .clone()
        .unwrap_or_else(|| hex::encode(Sha256::digest(&raw_json)));
    RepositoryPreview {
        url: url.to_string(),
        id: repo.metadata.id.clone(),
        name: repo.metadata.name.clone(),
        version: repo.metadata.version.clone(),
        maintainer: repo.metadata.maintainer.clone(),
        homepage_url: repo.metadata.homepage_url.clone(),
        license: repo.metadata.license.clone(),
        trust_level: repo
            .metadata
            .trust_level
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        catalog_count: repo.catalog.len(),
        system_file_count: repo.system_files.len(),
        has_executable_assets: repo.system_files.iter().any(|asset| asset.executable),
        content_hash,
    }
}

fn download_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    download_root_for_app_state(state)
}

fn download_root_for_app_state(state: &AppState) -> Result<PathBuf, String> {
    let configured = lock_app_store(state)?.get_config("download_root")?;
    Ok(configured
        .map(PathBuf::from)
        .unwrap_or_else(|| state.data_dir.join("Games")))
}

fn preflight_disk_space(root: &Path, needed_bytes: Option<u64>) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create download folder: {error}"))?;
    let Some(needed_bytes) = needed_bytes else {
        return Ok(());
    };
    let free = fs2::available_space(root)
        .map_err(|error| format!("Failed to inspect free disk space: {error}"))?;
    let buffer = 1024_u64 * 1024 * 1024;
    if free < needed_bytes.saturating_add(buffer) {
        return Err(format!(
            "Insufficient disk space: need {:.2} GB plus 1 GB buffer, but only {:.2} GB is free.",
            needed_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
            free as f64 / 1024.0 / 1024.0 / 1024.0
        ));
    }
    Ok(())
}

fn emit_direct_download_record(app: &AppHandle, record: &TorrentDownloadRecord) {
    let _ = app.emit(
        "download:progress",
        crate::torrent::DownloadProgressEvent {
            game_id: record.game_id.clone(),
            status: record.status.clone(),
            progress: record.progress_percent / 100.0,
            progress_percent: record.progress_percent,
            downloaded_bytes: record.downloaded_bytes,
            total_bytes: record.total_bytes,
            download_speed_bytes_per_sec: record.download_speed_bytes_per_sec,
            upload_speed_bytes_per_sec: record.upload_speed_bytes_per_sec,
            peers_count: record.peers_count,
            finished: record.status == "completed",
            save_dir: record.save_dir.clone(),
            error: record.error_message.clone(),
        },
    );
}

fn spawn_metadata_scrape(app: &AppHandle, state: &AppState, game_id: String) {
    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::scraper::scrape_game(app, state, game_id).await;
    });
}

fn build_health_report(state: &AppState) -> Result<HealthReport, String> {
    let store = lock_app_store(state)?;
    let repositories = store.list_repositories()?;
    let catalog = store.get_catalog()?;
    let configs = store.list_emulator_configs()?;
    let downloads = store.list_download_records()?;
    let torrent_downloads = store.list_torrent_downloads()?;
    let mut system_file_ids = HashSet::new();
    let mut system_files = Vec::new();
    let mut game_files = Vec::new();
    let platform_setup = setup_profiles::list_platform_setup_profiles()
        .into_iter()
        .map(|profile| {
            let emulator = build_setup_emulator_state(
                &store,
                &CatalogGameView {
                    id: String::new(),
                    source_id: String::new(),
                    repository_id: String::new(),
                    repository_name: String::new(),
                    platform: profile.platform.clone(),
                    title: profile.display_name.clone(),
                    description: None,
                    cover_image_url: None,
                    trailer_url: None,
                    artwork: None,
                    metadata: None,
                    content_mode: None,
                    setup_profile_id: Some(profile.id.clone()),
                    downloads: Vec::new(),
                    expected_extensions: profile.game_files.expected_extensions.clone(),
                    required_system_file_ids: Vec::new(),
                    launch: None,
                },
                Some(&profile),
            )?;
            let profile_files = profile
                .system_files
                .iter()
                .map(|requirement| {
                    inspect_profile_system_file(&store, &state.data_dir, &profile, requirement)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let required_missing = profile_files
                .iter()
                .filter(|item| item.required && item.status != "ready")
                .count();
            let ready = emulator.status == "ready" && required_missing == 0;
            Ok(HealthCheckItem {
                id: format!("profile:{}", profile.id),
                label: profile.display_name,
                status: if ready { "ready" } else { "missing" }.to_string(),
                message: Some(if ready {
                    "Profile setup is ready.".to_string()
                } else if emulator.status != "ready" {
                    emulator
                        .message
                        .unwrap_or_else(|| "Emulator is missing.".to_string())
                } else {
                    format!("{required_missing} required profile file(s) missing")
                }),
                action: Some(if ready {
                    "openProfileFolder".to_string()
                } else {
                    "configureProfile".to_string()
                }),
                path: emulator.executable_path,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let emulators = setup_profiles::mvp_platforms()
        .map(|profile| {
            let config = configs
                .iter()
                .find(|config| config.platform == profile.platform);
            let path = config.and_then(|config| config.exe_path.clone());
            let status = match path
                .as_deref()
                .map(|path| validate_emulator_status(Some(path)))
            {
                Some("valid") => "ready",
                Some("missing") => "missing",
                _ => "missing",
            };
            let executable_hint = profile
                .emulator
                .executable_name
                .clone()
                .or_else(|| profile.emulator.executable_candidates.first().cloned())
                .unwrap_or_else(|| format!("{} emulator", profile.platform.to_uppercase()));
            let platform_label = setup_profiles::platform_display_label(&profile.platform)
                .unwrap_or_else(|| profile.platform.to_uppercase());
            let emulator_name = setup_profiles::platform_emulator_name(&profile.platform)
                .unwrap_or_else(|| format!("{} emulator", profile.platform.to_uppercase()));
            HealthCheckItem {
                id: format!("emulator:{}", profile.platform),
                label: format!("{emulator_name} ({platform_label})"),
                status: status.to_string(),
                message: if status == "ready" {
                    Some(executable_hint.clone())
                } else {
                    Some(format!("Expected executable: {executable_hint}"))
                },
                action: Some(if status == "ready" {
                    "openEmulatorFolder".to_string()
                } else {
                    "reconfigureEmulator".to_string()
                }),
                path,
            }
        })
        .collect::<Vec<_>>();

    for game in &catalog {
        if let Some(download) = downloads
            .iter()
            .find(|download| download.subject_id == game.id)
        {
            let path = download.local_path.clone().unwrap_or_default();
            let game_status = check_game_file_health(&path, game);
            game_files.push(HealthCheckItem {
                id: format!("game:{}", game.id),
                label: game.title.clone(),
                status: game_status.0,
                message: game_status.1,
                action: Some("openGameFolder".to_string()),
                path: Some(path),
            });
        } else if let Some(torrent) = torrent_downloads
            .iter()
            .find(|download| download.game_id == game.id && download.status == "completed")
        {
            let game_status = check_game_file_health(&torrent.save_dir, game);
            game_files.push(HealthCheckItem {
                id: format!("game:{}", game.id),
                label: game.title.clone(),
                status: game_status.0,
                message: game_status.1,
                action: Some("openGameFolder".to_string()),
                path: Some(torrent.save_dir.clone()),
            });
        }

        let requirements = build_requirements_report(&store, &state.data_dir, game)?;
        for item in requirements.requirements {
            if !system_file_ids.insert(item.asset.id.clone()) {
                continue;
            }
            system_files.push(HealthCheckItem {
                id: format!("asset:{}", item.asset.id),
                label: item.asset.display_name,
                status: match item.status.as_str() {
                    "ready" if item.trusted => "ready",
                    "corrupt" => "corrupt",
                    "blocked" => "blocked",
                    "error" => "error",
                    _ => "missing",
                }
                .to_string(),
                message: item.message.or_else(|| item.target_path.clone()),
                action: Some(
                    match item.status.as_str() {
                        "corrupt" | "error" => "redownloadAsset",
                        "ready" if !item.trusted => "trustExecutable",
                        _ => "openTargetFolder",
                    }
                    .to_string(),
                ),
                path: item.target_path,
            });
        }
    }

    let repositories = repositories
        .into_iter()
        .map(|repository| HealthCheckItem {
            id: format!("repository:{}", repository.id),
            label: repository.name,
            status: "ready".to_string(),
            message: Some(format!(
                "{} games / {} system files / {}",
                repository.catalog_count, repository.system_file_count, repository.url
            )),
            action: Some("refreshRepository".to_string()),
            path: Some(repository.url),
        })
        .collect::<Vec<_>>();

    let active_downloads = torrent_downloads
        .iter()
        .filter(|download| matches!(download.status.as_str(), "resolving" | "downloading"))
        .count();
    let downloader = HealthCheckItem {
        id: "downloader:librqbit".to_string(),
        label: "Downloader session".to_string(),
        status: "ready".to_string(),
        message: Some(format!("{active_downloads} active torrent download(s)")),
        action: None,
        path: Some(
            download_root_for_app_state(state)?
                .to_string_lossy()
                .to_string(),
        ),
    };

    Ok(HealthReport {
        generated_at: Utc::now().to_rfc3339(),
        emulators,
        platform_setup,
        system_files,
        game_files,
        repositories,
        downloader,
    })
}

fn check_game_file_health(path: &str, game: &CatalogGameView) -> (String, Option<String>) {
    if path.trim().is_empty() {
        return (
            "missing".to_string(),
            Some("No local path recorded.".to_string()),
        );
    }
    let path = Path::new(path);
    let preferred_file = game
        .launch
        .as_ref()
        .and_then(|launch| launch.preferred_file.as_deref());
    game_files::inspect_game_path(path, &game.expected_extensions, preferred_file)
}

fn remove_path_if_allowed(
    data_dir: &Path,
    download_root: &Path,
    candidate: &Path,
) -> Result<(), String> {
    if !candidate.exists() {
        return Ok(());
    }
    let canonical_candidate = fs::canonicalize(candidate)
        .map_err(|error| format!("Failed to inspect {}: {error}", candidate.display()))?;
    let canonical_data_dir = fs::canonicalize(data_dir)
        .map_err(|error| format!("Failed to inspect app data directory: {error}"))?;
    let canonical_download_root = fs::canonicalize(download_root)
        .map_err(|error| format!("Failed to inspect download folder: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_data_dir)
        && !canonical_candidate.starts_with(&canonical_download_root)
    {
        return Err(format!(
            "Refusing to delete files outside RetroHydra folders: {}",
            canonical_candidate.display()
        ));
    }
    if canonical_candidate.is_dir() {
        fs::remove_dir_all(&canonical_candidate)
    } else {
        fs::remove_file(&canonical_candidate)
    }
    .map_err(|error| {
        format!(
            "Failed to remove {}: {error}",
            canonical_candidate.display()
        )
    })
}

fn open_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    }
    Ok(())
}

fn folder_path_for_open(path: &Path) -> Result<PathBuf, String> {
    if path.is_dir() {
        return Ok(path.to_path_buf());
    }
    if path.is_file() {
        return path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Game file has no parent directory: {}", path.display()));
    }
    Err(format!("Game path does not exist: {}", path.display()))
}

pub(crate) fn run_package_smoke(data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir)
        .map_err(|error| format!("Failed to create package smoke data dir: {error}"))?;
    let db_path = data_dir.join("retrohydra.db");
    let mut store = RepositoryStore::open(&db_path)?;

    let demo_repo = builtin_demo::repository_schema()?;
    builtin_demo::verify_embedded_assets(&demo_repo)?;
    store.store_repository(builtin_demo::BUILTIN_DEMO_REPOSITORY_URL, &demo_repo)?;
    let demo_game = store
        .get_game("retrohydra-demo::retrohydra_nes_smoke")?
        .ok_or_else(|| "Built-in demo game was not stored.".to_string())?;
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
    let current_exe_string = current_exe.to_string_lossy().to_string();
    store.upsert_profile_emulator_config(
        "nes-mesen",
        "nes",
        Some(&current_exe_string),
        "valid",
        Some("package-smoke"),
        Some("{game_path}"),
    )?;

    let Some(SourceUri::Bundled { path, sha256, .. }) = demo_repo.catalog[0].downloads.first()
    else {
        return Err("Built-in demo game must use a bundled source.".to_string());
    };
    let bytes = builtin_demo::asset_bytes(path)
        .ok_or_else(|| format!("Built-in demo asset is missing: {path}"))?;
    let demo_target = data_dir
        .join("Games")
        .join("nes")
        .join("retrohydra-demo__retrohydra_nes_smoke")
        .join("retrohydra-smoke.nes");
    if let Some(parent) = demo_target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create demo game folder: {error}"))?;
    }
    fs::write(&demo_target, bytes)
        .map_err(|error| format!("Failed to write bundled demo asset: {error}"))?;
    store.record_direct_game_download_completed(
        &demo_game.id,
        "bundled",
        &demo_target.to_string_lossy(),
        sha256,
        bytes.len() as u64,
    )?;
    let demo_state = build_game_setup_state(&store, data_dir, &demo_game)?;
    if demo_state.launch.status != "ready" {
        return Err(format!(
            "Built-in demo setup did not become ready: {:?}",
            demo_state.launch.blockers
        ));
    }

    let switch_repo = package_smoke_switch_repo();
    store.store_repository("package-smoke://switch", &switch_repo)?;
    let switch_profile = setup_profiles::get_platform_setup_profile("switch-manual")
        .ok_or_else(|| "switch-manual profile is missing.".to_string())?;
    store.upsert_profile_emulator_config(
        "switch-manual",
        "switch",
        Some(&current_exe_string),
        "valid",
        Some("package-smoke"),
        Some("{game_path}"),
    )?;
    let keys_source = data_dir.join("fixtures").join("prod.keys");
    let xci_source = data_dir.join("fixtures").join("star-orbit.xci");
    fs::create_dir_all(keys_source.parent().unwrap())
        .map_err(|error| format!("Failed to create package smoke fixtures: {error}"))?;
    fs::write(&keys_source, b"package-smoke-keys")
        .map_err(|error| format!("Failed to write fake keys fixture: {error}"))?;
    fs::write(&xci_source, b"package-smoke-xci")
        .map_err(|error| format!("Failed to write fake game fixture: {error}"))?;
    let keys_requirement = switch_profile
        .system_files
        .iter()
        .find(|requirement| requirement.id == "switch-prod-keys")
        .ok_or_else(|| "switch-manual keys requirement is missing.".to_string())?;
    let key_import = import_profile_system_file_into_store(
        &store,
        data_dir,
        &switch_profile,
        keys_requirement,
        &keys_source,
    )?;
    if key_import.status == "error" {
        return Err(format!(
            "Profile system file import failed: {:?}",
            key_import.error_code
        ));
    }

    let switch_game = store
        .get_game("package-smoke::star-orbit")
        .map_err(|error| format!("Failed to read package smoke game: {error}"))?
        .ok_or_else(|| "Package smoke switch game was not stored.".to_string())?;
    let game_import = import_game_file_into_store(
        &store,
        &data_dir.join("Games"),
        &switch_game.id,
        &xci_source,
    );
    if game_import.status == "error" {
        return Err(format!(
            "Profile game file import failed: {:?}",
            game_import.error_code
        ));
    }
    let switch_state = build_game_setup_state(&store, data_dir, &switch_game)?;
    if switch_state.launch.status != "ready" {
        return Err(format!(
            "Switch manual setup did not become ready: {:?}",
            switch_state.launch.blockers
        ));
    }

    drop(store);
    let store = RepositoryStore::open(&db_path)?;
    let persisted_game = store
        .get_game("package-smoke::star-orbit")?
        .ok_or_else(|| "Package smoke switch game was not persisted.".to_string())?;
    let persisted_state = build_game_setup_state(&store, data_dir, &persisted_game)?;
    if persisted_state.launch.status != "ready" {
        return Err(format!(
            "Package smoke state was not persisted: {:?}",
            persisted_state.launch.blockers
        ));
    }

    Ok(())
}

fn package_smoke_switch_repo() -> RepositorySchema {
    RepositorySchema {
        metadata: RepositoryMetadata {
            id: "package-smoke".to_string(),
            name: "Package Smoke Repository".to_string(),
            version: "1".to_string(),
            schema_version: 3,
            maintainer: Some("RetroHydra".to_string()),
            homepage_url: None,
            license: Some("Synthetic smoke metadata only".to_string()),
            trust_level: Some("official".to_string()),
            content_hash: None,
            updated_at: None,
        },
        system_files: vec![],
        catalog: vec![RepositoryGame {
            id: "star-orbit".to_string(),
            platform: "switch".to_string(),
            title: "Star Orbit Package Smoke".to_string(),
            description: Some("Synthetic user-provided package smoke entry.".to_string()),
            cover_image_url: None,
            trailer_url: None,
            artwork: None,
            metadata: None,
            content_mode: Some("user_provided".to_string()),
            setup_profile_id: Some("switch-manual".to_string()),
            downloads: vec![SourceUri::UserProvided {
                instructions: Some("Import a local package smoke fixture.".to_string()),
                sha256: None,
                size_bytes: None,
            }],
            expected_extensions: vec![],
            required_system_file_ids: vec![],
            launch: None,
        }],
    }
}

fn lock_store<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, RepositoryStore>, String> {
    lock_app_store(state)
}

fn lock_app_store(state: &AppState) -> Result<std::sync::MutexGuard<'_, RepositoryStore>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Repository store lock is poisoned.".to_string())
}

#[allow(dead_code)]
fn source_has_http(sources: &[SourceUri]) -> bool {
    sources
        .iter()
        .any(|source| matches!(source, SourceUri::Http { .. }))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::tempdir;

    use super::{
        build_library_status, build_requirements_report, folder_path_for_open,
        import_asset_file_into_store, import_game_file_into_store,
        load_repository_schema_from_file, repair_library_state,
    };
    use crate::schema::{
        AssetKind, InstallHint, InstallTarget, RepositoryAsset, RepositoryGame, RepositoryMetadata,
        RepositorySchema, SourceUri,
    };
    use crate::storage::RepositoryStore;
    use sha2::{Digest, Sha256};

    fn sha256_hex(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    fn valid_nes_bytes() -> Vec<u8> {
        let mut bytes = b"NES\x1A".to_vec();
        bytes.extend([0_u8; 32]);
        bytes
    }

    #[test]
    fn open_game_folder_uses_parent_for_game_file() {
        let temp = tempdir().unwrap();
        let game_file = temp.path().join("game.nes");
        std::fs::write(&game_file, valid_nes_bytes()).unwrap();

        assert_eq!(folder_path_for_open(&game_file).unwrap(), temp.path());
    }

    #[test]
    fn open_game_folder_keeps_download_directory() {
        let temp = tempdir().unwrap();
        let game_directory = temp.path().join("game");
        std::fs::create_dir(&game_directory).unwrap();

        assert_eq!(
            folder_path_for_open(&game_directory).unwrap(),
            game_directory
        );
    }

    fn test_repo(required_asset_ids: Vec<String>) -> RepositorySchema {
        RepositorySchema {
            metadata: RepositoryMetadata {
                id: "repo".to_string(),
                name: "Repo".to_string(),
                version: "1".to_string(),
                schema_version: 2,
                maintainer: None,
                homepage_url: None,
                license: None,
                trust_level: None,
                content_hash: None,
                updated_at: None,
            },
            system_files: vec![RepositoryAsset {
                id: "emu".to_string(),
                platform: "nes".to_string(),
                asset_kind: AssetKind::Emulator,
                display_name: "Demo Emulator".to_string(),
                sources: vec![SourceUri::Http {
                    url: "https://example.com/emulator.zip".to_string(),
                    sha256: sha256_hex(b"asset"),
                    size_bytes: None,
                }],
                install_hint: None,
                executable: true,
            }],
            catalog: vec![RepositoryGame {
                id: "game".to_string(),
                platform: "nes".to_string(),
                title: "Game".to_string(),
                description: None,
                cover_image_url: None,
                trailer_url: None,
                artwork: None,
                metadata: None,
                content_mode: None,
                setup_profile_id: None,
                downloads: vec![SourceUri::Magnet {
                    uri: "magnet:?xt=urn:btih:abc".to_string(),
                    info_hash: None,
                    size_bytes: None,
                }],
                expected_extensions: vec![".nes".to_string()],
                required_system_file_ids: required_asset_ids,
                launch: None,
            }],
        }
    }

    fn user_file_repo(
        sha256: Option<String>,
        install_hint: Option<InstallHint>,
    ) -> RepositorySchema {
        RepositorySchema {
            metadata: RepositoryMetadata {
                id: "repo".to_string(),
                name: "Repo".to_string(),
                version: "1".to_string(),
                schema_version: 2,
                maintainer: None,
                homepage_url: None,
                license: None,
                trust_level: None,
                content_hash: None,
                updated_at: None,
            },
            system_files: vec![RepositoryAsset {
                id: "bios".to_string(),
                platform: "nes".to_string(),
                asset_kind: AssetKind::Bios,
                display_name: "Demo BIOS".to_string(),
                sources: vec![SourceUri::UserProvided {
                    instructions: Some("Import your dumped BIOS.".to_string()),
                    sha256,
                    size_bytes: None,
                }],
                install_hint,
                executable: false,
            }],
            catalog: vec![RepositoryGame {
                id: "game".to_string(),
                platform: "nes".to_string(),
                title: "Game".to_string(),
                description: None,
                cover_image_url: None,
                trailer_url: None,
                artwork: None,
                metadata: None,
                content_mode: None,
                setup_profile_id: None,
                downloads: vec![SourceUri::Magnet {
                    uri: "magnet:?xt=urn:btih:abc".to_string(),
                    info_hash: None,
                    size_bytes: None,
                }],
                expected_extensions: vec![".nes".to_string()],
                required_system_file_ids: vec!["bios".to_string()],
                launch: None,
            }],
        }
    }

    fn user_game_repo() -> RepositorySchema {
        RepositorySchema {
            metadata: RepositoryMetadata {
                id: "repo".to_string(),
                name: "Repo".to_string(),
                version: "1".to_string(),
                schema_version: 3,
                maintainer: None,
                homepage_url: None,
                license: None,
                trust_level: None,
                content_hash: None,
                updated_at: None,
            },
            system_files: vec![],
            catalog: vec![RepositoryGame {
                id: "game".to_string(),
                platform: "nes".to_string(),
                title: "Game".to_string(),
                description: None,
                cover_image_url: None,
                trailer_url: None,
                artwork: None,
                metadata: None,
                content_mode: Some("user_provided".to_string()),
                setup_profile_id: Some("future-profile".to_string()),
                downloads: vec![SourceUri::UserProvided {
                    instructions: Some("Import your local game file.".to_string()),
                    sha256: None,
                    size_bytes: None,
                }],
                expected_extensions: vec![".nes".to_string()],
                required_system_file_ids: vec![],
                launch: None,
            }],
        }
    }

    fn legacy_demo_repo() -> RepositorySchema {
        RepositorySchema {
            metadata: RepositoryMetadata {
                id: "retrohydra-demo".to_string(),
                name: "RetroHydra Official Demo Repository".to_string(),
                version: "1.0.0".to_string(),
                schema_version: 2,
                maintainer: Some("RetroHydra Team".to_string()),
                homepage_url: Some("https://retrohydra.app".to_string()),
                license: None,
                trust_level: Some("official".to_string()),
                content_hash: None,
                updated_at: None,
            },
            system_files: vec![RepositoryAsset {
                id: "ps1_bios_scph1001".to_string(),
                platform: "ps1".to_string(),
                asset_kind: AssetKind::Bios,
                display_name: "PlayStation BIOS".to_string(),
                sources: vec![SourceUri::UserProvided {
                    instructions: None,
                    sha256: Some("a".repeat(64)),
                    size_bytes: None,
                }],
                install_hint: None,
                executable: false,
            }],
            catalog: vec![RepositoryGame {
                id: "nes_http_smoke".to_string(),
                platform: "nes".to_string(),
                title: "RetroHydra NES HTTP Smoke Demo".to_string(),
                description: None,
                cover_image_url: None,
                trailer_url: None,
                artwork: None,
                metadata: None,
                content_mode: None,
                setup_profile_id: None,
                downloads: vec![SourceUri::Http {
                    url: "http://localhost:3000/demo-content/retrohydra-demo.nes".to_string(),
                    sha256: "b".repeat(64),
                    size_bytes: Some(168),
                }],
                expected_extensions: vec![".nes".to_string()],
                required_system_file_ids: vec![],
                launch: None,
            }],
        }
    }

    fn open_store(required_asset_ids: Vec<String>) -> (tempfile::TempDir, RepositoryStore) {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "https://example.com/index.json",
                &test_repo(required_asset_ids),
            )
            .unwrap();
        (dir, store)
    }

    #[test]
    fn library_status_marks_installed_game_with_missing_system_file() {
        let (dir, store) = open_store(vec!["emu".to_string()]);
        let game = store.get_game("repo::game").unwrap().unwrap();
        let game_path = dir.path().join("game.nes");
        std::fs::write(&game_path, valid_nes_bytes()).unwrap();
        let game_path_string = game_path.to_string_lossy().to_string();
        store
            .record_download("repo::game", "game", Some(&game_path_string), None, None)
            .unwrap();

        let status = build_library_status(&store, dir.path(), &game).unwrap();

        assert!(status.installed);
        assert!(!status.system_requirements_ready);
        assert_eq!(
            status.missing_requirements,
            vec!["Demo Emulator is not installed".to_string()]
        );
    }

    #[test]
    fn library_status_marks_trusted_downloaded_requirements_ready() {
        let (dir, store) = open_store(vec!["emu".to_string()]);
        let game = store.get_game("repo::game").unwrap().unwrap();
        let game_path = dir.path().join("game.nes");
        let asset_path = dir.path().join("System").join("emu.exe");
        std::fs::create_dir_all(asset_path.parent().unwrap()).unwrap();
        std::fs::write(&game_path, valid_nes_bytes()).unwrap();
        std::fs::write(&asset_path, b"asset").unwrap();
        let game_path_string = game_path.to_string_lossy().to_string();
        let asset_path_string = asset_path.to_string_lossy().to_string();
        let asset_sha = sha256_hex(b"asset");
        store
            .record_download("repo::game", "game", Some(&game_path_string), None, None)
            .unwrap();
        store
            .record_download(
                "repo::emu",
                "asset",
                Some(&asset_path_string),
                Some(&asset_sha),
                None,
            )
            .unwrap();
        store
            .trust_executable("repo::emu", &asset_path_string, &asset_sha)
            .unwrap();

        let status = build_library_status(&store, dir.path(), &game).unwrap();

        assert!(status.installed);
        assert!(status.system_requirements_ready);
        assert!(status.missing_requirements.is_empty());
    }

    #[test]
    fn imports_user_file_and_records_completed_download() {
        let dir = tempdir().unwrap();
        let asset_sha = sha256_hex(b"bios");
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "https://example.com/index.json",
                &user_file_repo(
                    Some(asset_sha.clone()),
                    Some(InstallHint {
                        target: InstallTarget::AppSystem,
                        relative_path: Some("bios/demo.bin".to_string()),
                    }),
                ),
            )
            .unwrap();
        let source_path = dir.path().join("source.bin");
        std::fs::write(&source_path, b"bios").unwrap();

        let report = import_asset_file_into_store(&store, dir.path(), "repo::bios", &source_path);

        assert_eq!(report.status, "installed");
        assert!(report.error_code.is_none());
        assert_eq!(
            std::fs::read(&report.installed_path).unwrap(),
            b"bios".to_vec()
        );
        let download = store.get_download("repo::bios").unwrap().unwrap();
        assert_eq!(download.status, "completed");
        assert_eq!(download.source, "user_import");
        assert_eq!(download.magnet_uri, "");
        assert_eq!(download.sha256.as_deref(), Some(asset_sha.as_str()));

        let game = store.get_game("repo::game").unwrap().unwrap();
        let requirements = build_requirements_report(&store, dir.path(), &game).unwrap();
        assert_eq!(
            requirements.requirements[0].checksum.as_deref(),
            Some(asset_sha.as_str())
        );
        assert!(requirements.requirements[0].downloaded);
    }

    #[test]
    fn imports_user_game_file_and_records_completed_download() {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository("https://example.com/index.json", &user_game_repo())
            .unwrap();
        let source_path = dir.path().join("source.nes");
        let bytes = valid_nes_bytes();
        std::fs::write(&source_path, &bytes).unwrap();

        let report = import_game_file_into_store(
            &store,
            &dir.path().join("Games"),
            "repo::game",
            &source_path,
        );

        assert_eq!(report.status, "installed");
        assert!(report.error_code.is_none());
        assert_eq!(report.sha256.as_deref(), Some(sha256_hex(&bytes).as_str()));
        let download = store.get_download("repo::game").unwrap().unwrap();
        assert_eq!(download.status, "ready");
        assert_eq!(download.source, "legacy");
        let torrent = store.get_torrent_download("repo::game").unwrap().unwrap();
        assert_eq!(torrent.status, "completed");
        assert_eq!(torrent.magnet_uri, "direct:user_import");

        let game = store.get_game("repo::game").unwrap().unwrap();
        let status = build_library_status(&store, dir.path(), &game).unwrap();
        assert!(status.installed);
        assert!(status.system_requirements_ready);
    }

    #[test]
    fn user_game_import_rejects_wrong_extension() {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository("https://example.com/index.json", &user_game_repo())
            .unwrap();
        let source_path = dir.path().join("source.txt");
        std::fs::write(&source_path, b"not a rom").unwrap();

        let report = import_game_file_into_store(
            &store,
            &dir.path().join("Games"),
            "repo::game",
            &source_path,
        );

        assert_eq!(report.status, "error");
        assert_eq!(report.error_code.as_deref(), Some("wrong_extension"));
        assert!(store.get_download("repo::game").unwrap().is_none());
    }

    #[test]
    fn existing_matching_user_file_returns_already_installed_without_copy() {
        let dir = tempdir().unwrap();
        let asset_sha = sha256_hex(b"bios");
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "https://example.com/index.json",
                &user_file_repo(
                    Some(asset_sha.clone()),
                    Some(InstallHint {
                        target: InstallTarget::AppSystem,
                        relative_path: Some("bios/demo.bin".to_string()),
                    }),
                ),
            )
            .unwrap();
        let target = dir
            .path()
            .join("System")
            .join("nes")
            .join("bios")
            .join("demo.bin");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"bios").unwrap();
        let missing_source = dir.path().join("missing.bin");

        let report =
            import_asset_file_into_store(&store, dir.path(), "repo::bios", &missing_source);

        assert_eq!(report.status, "already_installed");
        assert_eq!(std::fs::read(&target).unwrap(), b"bios".to_vec());
        let download = store.get_download("repo::bios").unwrap().unwrap();
        assert_eq!(download.status, "completed");
        assert_eq!(download.source, "user_import");
    }

    #[test]
    fn user_file_checksum_mismatch_returns_error_without_copy() {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "https://example.com/index.json",
                &user_file_repo(
                    Some(sha256_hex(b"expected")),
                    Some(InstallHint {
                        target: InstallTarget::AppSystem,
                        relative_path: Some("bios/demo.bin".to_string()),
                    }),
                ),
            )
            .unwrap();
        let source_path = dir.path().join("bad-source.bin");
        std::fs::write(&source_path, b"wrong").unwrap();

        let report = import_asset_file_into_store(&store, dir.path(), "repo::bios", &source_path);

        assert_eq!(report.status, "error");
        assert_eq!(report.error_code.as_deref(), Some("checksum_mismatch"));
        assert!(!Path::new(&report.installed_path).exists());
        assert!(store.get_download("repo::bios").unwrap().is_none());
    }

    #[test]
    fn user_file_import_reports_stable_error_codes() {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "https://example.com/index.json",
                &user_file_repo(
                    None,
                    Some(InstallHint {
                        target: InstallTarget::AppSystem,
                        relative_path: Some("bios/demo.bin".to_string()),
                    }),
                ),
            )
            .unwrap();

        let unknown = import_asset_file_into_store(
            &store,
            dir.path(),
            "repo::missing",
            &dir.path().join("source.bin"),
        );
        assert_eq!(unknown.error_code.as_deref(), Some("unknown_asset"));

        let missing = import_asset_file_into_store(
            &store,
            dir.path(),
            "repo::bios",
            &dir.path().join("source.bin"),
        );
        assert_eq!(missing.error_code.as_deref(), Some("source_missing"));

        let source_dir = dir.path().join("source-dir");
        std::fs::create_dir(&source_dir).unwrap();
        let directory = import_asset_file_into_store(&store, dir.path(), "repo::bios", &source_dir);
        assert_eq!(directory.error_code.as_deref(), Some("source_not_file"));

        let mut unsupported_store =
            RepositoryStore::open(&dir.path().join("unsupported.db")).unwrap();
        unsupported_store
            .store_repository(
                "https://example.com/unsupported.json",
                &user_file_repo(
                    None,
                    Some(InstallHint {
                        target: InstallTarget::UserSelected,
                        relative_path: None,
                    }),
                ),
            )
            .unwrap();
        let source_path = dir.path().join("source.bin");
        std::fs::write(&source_path, b"bios").unwrap();
        let unsupported = import_asset_file_into_store(
            &unsupported_store,
            dir.path(),
            "repo::bios",
            &source_path,
        );
        assert_eq!(
            unsupported.error_code.as_deref(),
            Some("unsupported_target")
        );
    }

    #[test]
    fn completed_torrent_download_counts_as_installed_through_legacy_record() {
        let (dir, store) = open_store(Vec::new());
        let game = store.get_game("repo::game").unwrap().unwrap();
        let game_dir = dir.path().join("downloaded-game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.nes"), valid_nes_bytes()).unwrap();
        let game_dir_string = game_dir.to_string_lossy().to_string();
        store
            .upsert_torrent_download_start(
                "repo::game",
                "magnet:?xt=urn:btih:abc",
                &game_dir_string,
            )
            .unwrap();
        store
            .mark_torrent_completed("repo::game", &game_dir_string, 100, 100)
            .unwrap();

        let status = build_library_status(&store, dir.path(), &game).unwrap();

        assert!(status.installed);
        assert!(status.system_requirements_ready);
        assert_eq!(
            status
                .download
                .as_ref()
                .map(|download| download.status.as_str()),
            Some("completed")
        );
    }

    #[test]
    fn corrupt_game_file_blocks_ready_status() {
        let (dir, store) = open_store(Vec::new());
        let game = store.get_game("repo::game").unwrap().unwrap();
        let game_path = dir.path().join("bad.nes");
        std::fs::write(&game_path, b"not an ines file").unwrap();
        let game_path_string = game_path.to_string_lossy().to_string();
        store
            .record_download("repo::game", "game", Some(&game_path_string), None, None)
            .unwrap();

        let status = build_library_status(&store, dir.path(), &game).unwrap();

        assert!(status.installed);
        assert!(!status.system_requirements_ready);
        assert!(status
            .missing_requirements
            .iter()
            .any(|message| message.starts_with("Game file:")));
    }

    #[test]
    fn repairs_legacy_localhost_demo_repository() {
        let dir = tempdir().unwrap();
        let mut store = RepositoryStore::open(&dir.path().join("retrohydra.db")).unwrap();
        store
            .store_repository(
                "http://localhost:3000/demo-repository.json",
                &legacy_demo_repo(),
            )
            .unwrap();
        let stale_path = dir
            .path()
            .join("Games")
            .join("nes")
            .join("retrohydra-demo--nes_http_smoke")
            .join("retrohydra-demo.nes");
        std::fs::create_dir_all(stale_path.parent().unwrap()).unwrap();
        std::fs::write(&stale_path, b"not an ines file").unwrap();
        let stale_path_string = stale_path.to_string_lossy().to_string();
        store
            .record_download(
                "retrohydra-demo::nes_http_smoke",
                "game",
                Some(&stale_path_string),
                None,
                None,
            )
            .unwrap();

        let report = repair_library_state(&mut store, dir.path()).unwrap();

        assert!(report.repaired);
        assert!(!stale_path.exists());
        assert!(store
            .get_game("retrohydra-demo::nes_http_smoke")
            .unwrap()
            .is_none());
        assert!(store
            .get_game("retrohydra-demo::retrohydra_nes_smoke")
            .unwrap()
            .is_some());
        assert_eq!(
            store
                .get_repository_url("retrohydra-demo")
                .unwrap()
                .as_deref(),
            Some(crate::builtin_demo::BUILTIN_DEMO_REPOSITORY_URL)
        );
        assert!(store
            .get_download("retrohydra-demo::nes_http_smoke")
            .unwrap()
            .is_none());
    }

    #[test]
    fn loads_repository_from_local_json_file() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repository.json");
        std::fs::write(
            &repo_path,
            serde_json::to_string(&test_repo(Vec::new())).unwrap(),
        )
        .unwrap();

        let (repo, url) = load_repository_schema_from_file(&repo_path.to_string_lossy()).unwrap();

        assert_eq!(repo.metadata.id, "repo");
        assert!(url.starts_with("file:"));
    }
}
