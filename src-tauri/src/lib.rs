use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::Manager;

mod app_update;
mod archive;
mod builtin_demo;
mod commands;
mod downloads;
mod emulator_profiles;
mod game_files;
mod github_resolver;
mod launcher;
mod logging;
mod orchestrator;
mod rom_hasher;
mod schema;
mod scraper;
mod scrapers;
mod security;
mod setup_profiles;
mod storage;
mod torrent;

use storage::RepositoryStore;
use torrent::TorrentManager;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Mutex<RepositoryStore>>,
    pub data_dir: PathBuf,
    pub torrents: TorrentManager,
    pub running_games: Arc<Mutex<HashMap<String, u32>>>,
    pub library_scrape: scraper::LibraryScrapeRuntime,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| setup_error(error.to_string()))?;
            std::fs::create_dir_all(&data_dir).map_err(|error| setup_error(error.to_string()))?;
            logging::initialize(&data_dir);
            let mut repository_store =
                RepositoryStore::open(&data_dir.join("retrohydra.db")).map_err(setup_error)?;
            match commands::repair_library_state(&mut repository_store, &data_dir) {
                Ok(report) if report.repaired => {
                    logging::log_event(
                        &data_dir,
                        "library_repaired",
                        &[(
                            "repository_id",
                            report.repository_id.as_deref().unwrap_or(""),
                        )],
                    );
                }
                Ok(_) => {}
                Err(message) => {
                    logging::log_event(
                        &data_dir,
                        "library_repair_failed",
                        &[("message", message.as_str())],
                    );
                }
            }
            let store = Arc::new(Mutex::new(repository_store));
            let torrents = tauri::async_runtime::block_on(TorrentManager::new(
                data_dir.join("Torrents"),
                data_dir.join("torrent-session"),
                data_dir.clone(),
                Arc::clone(&store),
                app.handle().clone(),
            ))
            .map_err(setup_error)?;

            app.manage(AppState {
                store,
                data_dir,
                torrents,
                running_games: Arc::new(Mutex::new(HashMap::new())),
                library_scrape: scraper::LibraryScrapeRuntime::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::preview_repository,
            commands::preview_repository_file,
            commands::preview_builtin_demo_repository,
            commands::connect_repository,
            commands::connect_repository_file,
            commands::connect_builtin_demo_repository,
            commands::repair_library,
            commands::refresh_repository,
            commands::get_onboarding_state,
            commands::list_repositories,
            commands::disconnect_repository,
            commands::get_catalog,
            commands::get_game,
            commands::scrape_game,
            commands::get_scrape_state,
            commands::list_scrape_candidates,
            commands::apply_scrape_override,
            commands::clear_scrape_override,
            commands::save_screenscraper_credentials,
            commands::get_screenscraper_status,
            commands::save_steamgriddb_key,
            commands::get_steamgriddb_status,
            commands::scrape_library,
            commands::cancel_library_scrape,
            commands::check_requirements,
            commands::get_library_statuses,
            commands::list_platform_setup_profiles,
            commands::get_game_setup_state,
            commands::install_profile_emulator,
            commands::select_profile_emulator,
            commands::import_profile_system_file,
            commands::list_emulator_configs,
            commands::save_emulator_config,
            commands::validate_emulator_config,
            commands::delete_emulator_config,
            commands::download_asset,
            commands::import_asset_file,
            commands::import_game_file,
            commands::download_game,
            commands::start_game_download,
            commands::trust_executable,
            commands::get_download_root,
            commands::set_download_root,
            commands::remove_game,
            commands::redownload_asset,
            commands::open_game_folder,
            commands::open_emulator_folder,
            commands::open_logs_folder,
            commands::run_health_check,
            commands::get_diagnostics_paths,
            commands::get_diagnostics_bundle,
            launcher::launch_game,
            orchestrator::install_game,
            orchestrator::install_emulator,
            orchestrator::get_emulator_status,
            orchestrator::get_emulator_install_status,
            torrent::start_magnet_download,
            torrent::get_torrent_status,
            torrent::get_game_download,
            torrent::list_torrent_downloads,
            torrent::pause_download,
            torrent::resume_download,
            torrent::cancel_download,
            app_update::check_app_update,
            app_update::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run RetroHydra");
}

pub fn run_package_smoke() -> Result<(), String> {
    let data_dir = std::env::var_os("RETROHYDRA_PACKAGE_SMOKE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("retrohydra-package-smoke"));
    commands::run_package_smoke(&data_dir)
}

fn setup_error(message: String) -> std::io::Error {
    std::io::Error::other(message)
}
