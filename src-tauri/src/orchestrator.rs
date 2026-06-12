use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::archive;
use crate::commands;
use crate::emulator_profiles::{
    load_emulator_profile, EmulatorInstallResult, EmulatorProfile, EmulatorStatus,
    InstallProgressEvent, InstallResult, VersionStrategy,
};
use crate::github_resolver::{resolve_github_latest, ResolvedAsset};
use crate::schema::SourceUri;
use crate::storage::RepositoryStore;
use crate::AppState;

const RESOLVED_ASSET_CACHE_HOURS: i64 = 24;
const MAX_EMULATOR_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
struct CachedResolvedAsset {
    resolved_at: DateTime<Utc>,
    asset: ResolvedAsset,
}

#[tauri::command]
pub async fn install_game(
    app: AppHandle,
    state: State<'_, AppState>,
    game_id: String,
) -> Result<InstallResult, String> {
    match install_game_inner(&app, &state, &game_id).await {
        Ok(result) => Ok(result),
        Err(error) => Ok(InstallResult {
            game_id,
            status: "error".to_string(),
            error_code: Some(error_code(&error)),
            message: Some(error),
        }),
    }
}

#[tauri::command]
pub async fn install_emulator(
    app: AppHandle,
    state: State<'_, AppState>,
    platform: String,
) -> Result<EmulatorInstallResult, String> {
    install_emulator_internal(&app, &state, platform.trim()).await
}

#[tauri::command]
pub fn get_emulator_status(
    state: State<'_, AppState>,
    platform: String,
) -> Result<EmulatorStatus, String> {
    get_emulator_status_internal(&state, platform.trim())
}

#[tauri::command]
pub fn get_emulator_install_status(
    state: State<'_, AppState>,
    platform: String,
) -> Result<EmulatorStatus, String> {
    get_emulator_status_internal(&state, platform.trim())
}

pub(crate) async fn install_emulator_internal(
    app: &AppHandle,
    state: &AppState,
    platform: &str,
) -> Result<EmulatorInstallResult, String> {
    if platform == "switch" {
        return Err("switch_emulator_not_configured: Select a Switch emulator executable.".into());
    }
    let profile =
        load_emulator_profile(platform)?.ok_or_else(|| format!("no_profile_for:{platform}"))?;

    if let Some((exe_path, version)) = existing_emulator(state, &profile)? {
        return Ok(EmulatorInstallResult {
            profile_id: profile.id,
            exe_path,
            version,
            from_cache: true,
        });
    }

    let resolved = resolve_profile_asset(state, &profile).await?;
    if resolved.size > MAX_EMULATOR_ARCHIVE_BYTES {
        return Err(format!(
            "emulator_archive_too_large:{} is {} bytes",
            resolved.filename, resolved.size
        ));
    }

    emit_progress(
        app,
        "",
        "emulator",
        &format!("Downloading {}...", profile.display_name),
        10,
    );
    let archive_path = download_emulator_archive(state, &profile, &resolved).await?;
    let install_root = state.data_dir.join("Emulators");
    let install_dir = install_root.join(&profile.platform);
    let staging_dir = install_root.join(format!(".installing-{}", profile.platform));
    archive::reset_staging_dir(&install_root, &staging_dir)?;
    {
        // Archive extraction is synchronous and CPU/IO heavy; keep it off the
        // async runtime worker so concurrent commands stay responsive.
        let archive_path = archive_path.clone();
        let staging_dir = staging_dir.clone();
        tokio::task::spawn_blocking(move || {
            archive::extract_archive_safely(&archive_path, &staging_dir)
        })
        .await
        .map_err(|error| format!("Emulator extraction task failed: {error}"))??;
    }
    let staged_exe = archive::resolve_executable(
        &staging_dir,
        &profile.exe_relative_path,
        &profile.display_name,
    )?;
    let relative_exe = staged_exe
        .strip_prefix(&staging_dir)
        .map_err(|_| "Installed emulator executable escaped the staging folder.".to_string())?
        .to_path_buf();
    archive::replace_directory(&install_root, &install_dir, &staging_dir)?;
    let exe_path = install_dir.join(relative_exe);
    persist_emulator(state, &profile, &resolved.version, &exe_path)?;
    let _ = fs::remove_file(archive_path);

    Ok(EmulatorInstallResult {
        profile_id: profile.id,
        exe_path: exe_path.to_string_lossy().to_string(),
        version: resolved.version,
        from_cache: false,
    })
}

fn get_emulator_status_internal(
    state: &AppState,
    platform: &str,
) -> Result<EmulatorStatus, String> {
    if platform == "switch" {
        let exe_path = lock_store(state)?.get_emulator_exe_path("switch", Some("switch-manual"))?;
        return Ok(EmulatorStatus {
            platform: platform.to_string(),
            installed: exe_path.is_some(),
            exe_path: exe_path.map(|path| path.to_string_lossy().to_string()),
            profile_id: Some("switch-manual".to_string()),
        });
    }

    let profile = load_emulator_profile(platform)?;
    let exe_path = match profile.as_ref() {
        Some(profile) => lock_store(state)?.get_emulator_exe_path(platform, Some(&profile.id))?,
        None => None,
    };
    Ok(EmulatorStatus {
        platform: platform.to_string(),
        installed: exe_path.is_some(),
        exe_path: exe_path.map(|path| path.to_string_lossy().to_string()),
        profile_id: profile.map(|profile| profile.id),
    })
}

async fn install_game_inner(
    app: &AppHandle,
    state: &AppState,
    game_id: &str,
) -> Result<InstallResult, String> {
    let game = lock_store(state)?
        .get_game(game_id)?
        .ok_or_else(|| format!("unknown_game:{game_id}"))?;

    emit_progress(app, game_id, "emulator", "Checking emulator...", 5);
    if game.platform == "switch" {
        if !get_emulator_status_internal(state, "switch")?.installed {
            return Ok(InstallResult {
                game_id: game_id.to_string(),
                status: "error".to_string(),
                error_code: Some("switch_emulator_not_configured".to_string()),
                message: Some(
                    "Select a Switch emulator executable before installing this game.".to_string(),
                ),
            });
        }
    } else {
        install_emulator_internal(app, state, &game.platform)
            .await
            .map_err(|error| format!("emulator_install_failed:{error}"))?;
    }
    emit_progress(app, game_id, "emulator", "Emulator ready", 25);

    emit_progress(app, game_id, "system_files", "Checking system files...", 30);
    let setup = {
        let store = lock_store(state)?;
        commands::build_game_setup_state(&store, &state.data_dir, &game)?
    };
    let missing = missing_system_files(&setup);
    if !missing.is_empty() {
        return Ok(InstallResult {
            game_id: game_id.to_string(),
            status: "needs_system_files".to_string(),
            error_code: Some(format!("missing:{}", missing.join(","))),
            message: Some(format!("Import once to continue: {}", missing.join(", "))),
        });
    }
    emit_progress(app, game_id, "system_files", "System files ready", 40);

    if setup.game_file.status != "ready" {
        if matches!(
            game.content_mode.as_deref(),
            Some("user_provided" | "metadata_only")
        ) || game
            .downloads
            .iter()
            .any(|source| matches!(source, SourceUri::UserProvided { .. }))
        {
            return Ok(InstallResult {
                game_id: game_id.to_string(),
                status: "error".to_string(),
                error_code: Some("game_requires_import".to_string()),
                message: Some("Import your local game file to continue.".to_string()),
            });
        }

        emit_progress(app, game_id, "game", "Downloading game...", 45);
        commands::start_game_download_internal(game_id, state, app).await?;
        wait_for_game_download(app, state, game_id).await?;
    }
    emit_progress(app, game_id, "game", "Game downloaded", 90);

    emit_progress(app, game_id, "verify", "Verifying launch readiness...", 95);
    let final_setup = {
        let store = lock_store(state)?;
        commands::build_game_setup_state(&store, &state.data_dir, &game)?
    };
    if final_setup.launch.status != "ready" {
        return Err(format!(
            "launch_not_ready:{}",
            final_setup.launch.blockers.join("; ")
        ));
    }
    emit_progress(app, game_id, "done", "Ready to play", 100);

    Ok(InstallResult {
        game_id: game_id.to_string(),
        status: "ready".to_string(),
        error_code: None,
        message: None,
    })
}

async fn wait_for_game_download(
    app: &AppHandle,
    state: &AppState,
    game_id: &str,
) -> Result<(), String> {
    loop {
        let Some(download) = state.torrents.get_game_download(game_id)? else {
            return Err(
                "download_state_missing: Download did not create a persisted record.".into(),
            );
        };
        match download.status.as_str() {
            "completed" => return Ok(()),
            "error" | "cancelled" => {
                return Err(format!(
                    "download_failed:{}",
                    download
                        .error_message
                        .unwrap_or_else(|| download.status.clone())
                ));
            }
            "paused" | "interrupted" => {
                return Err(format!("download_paused:{}", download.status));
            }
            _ => {
                let percent = 45 + ((download.progress_percent.clamp(0.0, 100.0) * 0.45) as u8);
                emit_progress(app, game_id, "game", "Downloading game...", percent);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

fn missing_system_files(setup: &crate::schema::GameSetupState) -> Vec<String> {
    let mut missing = setup
        .system_files
        .iter()
        .filter(|item| item.required && item.status != "ready")
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    missing.extend(
        setup
            .repository_requirements
            .iter()
            .filter(|item| item.status != "ready" || !item.trusted)
            .map(|item| item.asset.id.clone()),
    );
    missing
}

fn existing_emulator(
    state: &AppState,
    profile: &EmulatorProfile,
) -> Result<Option<(String, String)>, String> {
    let store = lock_store(state)?;
    if !store.is_emulator_installed(&profile.platform, Some(&profile.id))? {
        return Ok(None);
    }
    let path = store.get_emulator_exe_path(&profile.platform, Some(&profile.id))?;
    let version = store
        .get_profile_emulator_config(&profile.id)?
        .and_then(|config| config.version)
        .unwrap_or_else(|| "installed".to_string());
    Ok(path.map(|path| (path.to_string_lossy().to_string(), version)))
}

async fn resolve_profile_asset(
    state: &AppState,
    profile: &EmulatorProfile,
) -> Result<ResolvedAsset, String> {
    match &profile.version_strategy {
        VersionStrategy::GithubLatest {
            repo,
            asset_pattern,
        } => {
            let cache_key = format!("emulator_release:{}", profile.id);
            if let Some(cached) = lock_store(state)?
                .get_config(&cache_key)?
                .and_then(|value| serde_json::from_str::<CachedResolvedAsset>(&value).ok())
                .filter(|cached| {
                    Utc::now()
                        .signed_duration_since(cached.resolved_at)
                        .num_hours()
                        < RESOLVED_ASSET_CACHE_HOURS
                })
            {
                return Ok(cached.asset);
            }

            let asset = resolve_github_latest(repo, asset_pattern).await?;
            let cached = CachedResolvedAsset {
                resolved_at: Utc::now(),
                asset: asset.clone(),
            };
            lock_store(state)?.set_config(
                &cache_key,
                &serde_json::to_string(&cached).map_err(|error| error.to_string())?,
            )?;
            Ok(asset)
        }
        VersionStrategy::Fixed { url, .. } => Ok(ResolvedAsset {
            url: url.clone(),
            filename: file_name_from_url(url).unwrap_or_else(|| format!("{}.zip", profile.id)),
            size: 0,
            version: "fixed".to_string(),
        }),
    }
}

async fn download_emulator_archive(
    state: &AppState,
    profile: &EmulatorProfile,
    asset: &ResolvedAsset,
) -> Result<PathBuf, String> {
    let temp_dir = state.data_dir.join("Temp").join("emulators");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|error| format!("Failed to create emulator temp folder: {error}"))?;
    let archive_path = temp_dir.join(crate::downloads::safe_segment(&asset.filename));

    // Pinned (Fixed) profiles verify against a known hash; GithubLatest assets
    // have no pinned hash, but we still verify the GitHub-reported size and cap
    // the transfer so a hostile redirect can't stream an unbounded archive.
    let expected_sha256 = match &profile.version_strategy {
        VersionStrategy::Fixed { sha256, .. } => Some(sha256.as_str()),
        VersionStrategy::GithubLatest { .. } => None,
    };
    let expected_size_bytes = (asset.size > 0).then_some(asset.size);

    crate::downloads::download_http_streaming(
        &asset.url,
        &archive_path,
        crate::downloads::StreamOptions {
            expected_sha256,
            expected_size_bytes,
            max_bytes: Some(MAX_EMULATOR_ARCHIVE_BYTES),
            resume: true,
        },
        |_, _| {},
    )
    .await
    .map_err(|error| format!("Failed to download {}: {error}", profile.display_name))?;

    Ok(archive_path)
}

fn persist_emulator(
    state: &AppState,
    profile: &EmulatorProfile,
    version: &str,
    exe_path: &Path,
) -> Result<(), String> {
    let exe = exe_path.to_string_lossy().to_string();
    let launch_args = profile.launch_args_template();
    let store = lock_store(state)?;
    store.upsert_profile_emulator_config(
        &profile.id,
        &profile.platform,
        Some(&exe),
        "valid",
        Some(version),
        Some(&launch_args),
    )?;
    Ok(())
}

fn file_name_from_url(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()?
        .path_segments()?
        .rfind(|segment| !segment.is_empty())
        .map(ToString::to_string)
}

fn emit_progress(app: &AppHandle, game_id: &str, stage: &str, message: &str, percent: u8) {
    let _ = app.emit(
        "install:progress",
        InstallProgressEvent {
            game_id: game_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            percent: percent.min(100),
        },
    );
}

fn error_code(error: &str) -> String {
    error
        .split_once(':')
        .map(|(code, _)| code)
        .unwrap_or("install_failed")
        .to_string()
}

fn lock_store(state: &AppState) -> Result<std::sync::MutexGuard<'_, RepositoryStore>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Repository store lock is poisoned.".to_string())
}
