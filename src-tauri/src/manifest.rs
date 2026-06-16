//! Fetch and parse a remote game manifest into strongly-typed Rust structs.
//!
//! This module exposes the [`fetch_manifest`] Tauri command. It reuses the
//! project's URL security checks (`security::validate_repository_url`) so the
//! command honours the same HTTPS-only posture as the repository loader, and it
//! surfaces a structured [`AppError`] to the frontend so `.catch()` handlers can
//! branch on the error kind instead of string-matching.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::schema::{
    GameArtwork, GameLaunchConfig, RepositoryGame, RepositoryMetadata, RepositorySchema, SourceUri,
};
use crate::security::validate_repository_url;

/// Network requests give up after this long. Mirrors the repository loader so a
/// hung mirror cannot wedge the UI indefinitely.
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(12);
const MANIFEST_USER_AGENT: &str = concat!("FusionLauncher/", env!("CARGO_PKG_VERSION"));

// ──────────────────────────────────────────────────────────────────────────
//  Strongly-typed manifest model (mirrors the reference JSON)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Manifest {
    pub manifest_version: String,
    pub repository_name: String,
    pub last_updated: String,
    pub games: Vec<Game>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Game {
    pub title_id: String,
    pub title: String,
    pub platform: String,
    pub game_version: String,
    pub visuals: Visuals,
    pub assets: Assets,
    pub launch_config: LaunchConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Visuals {
    pub cover_url: String,
    pub background_url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Assets {
    pub heavy_rom_magnet: String,
    pub core_bundle_p2p_hash: String,
    pub shader_cache_url: String,
    /// Optional direct HTTPS link to the emulator (core) archive. When present,
    /// it overrides the bundled platform profile's download source so the
    /// emulator is fetched from the manifest instead. Optional for backward
    /// compatibility with manifests that omit it.
    #[serde(default)]
    pub core_bundle_url: Option<String>,
    /// Optional SHA-256 of the emulator archive for integrity verification.
    #[serde(default)]
    pub core_bundle_sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LaunchConfig {
    pub engine: String,
    pub executable: String,
    pub args: Vec<String>,
    pub inject_mods: Vec<String>,
}

// ──────────────────────────────────────────────────────────────────────────
//  Structured error type, serialized to the frontend as { kind, message }
// ──────────────────────────────────────────────────────────────────────────

/// Errors returned by [`fetch_manifest`]. Serializes to a tagged object such as
/// `{ "kind": "network", "message": "..." }`, so a TypeScript `.catch()` can
/// discriminate on `err.kind` without parsing free-form strings.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum AppError {
    /// The URL is malformed or violates the HTTPS-only policy.
    InvalidUrl(String),
    /// DNS/connection/timeout failure, or the server returned a non-2xx status.
    Network(String),
    /// The body was not valid JSON or is missing required fields.
    Parse(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::InvalidUrl(message) => write!(f, "invalid url: {message}"),
            AppError::Network(message) => write!(f, "network error: {message}"),
            AppError::Parse(message) => write!(f, "parse error: {message}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        // A decode failure means the body arrived but did not match `Manifest`;
        // everything else (connect, timeout, status) is a transport problem.
        if error.is_decode() {
            AppError::Parse(error.to_string())
        } else {
            AppError::Network(error.to_string())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
//  Command
// ──────────────────────────────────────────────────────────────────────────

/// Download a manifest JSON from `url` and deserialize it into [`Manifest`].
///
/// Fails with [`AppError::InvalidUrl`] for unsafe URLs, [`AppError::Network`]
/// for transport/status errors, and [`AppError::Parse`] for malformed JSON.
#[tauri::command]
pub async fn fetch_manifest(url: String) -> Result<Manifest, AppError> {
    fetch_manifest_inner(&url).await
}

/// Shared implementation behind the [`fetch_manifest`] command. Other modules
/// (e.g. the orchestrator's manifest-driven install) call this directly so they
/// can map [`AppError`] into their own error channel.
pub(crate) async fn fetch_manifest_inner(url: &str) -> Result<Manifest, AppError> {
    // Enforce the project's HTTPS-only policy before touching the network.
    let endpoint = validate_repository_url(url, false).map_err(AppError::InvalidUrl)?;

    let client = reqwest::Client::builder()
        .timeout(MANIFEST_TIMEOUT)
        .user_agent(MANIFEST_USER_AGENT)
        .build()?; // reqwest::Error -> AppError (Network)

    let response = client
        .get(endpoint)
        .send()
        .await? // connection / timeout -> AppError::Network
        .error_for_status()
        .map_err(|error| AppError::Network(format!("manifest host returned an error: {error}")))?;

    // Invalid JSON or missing required fields -> AppError::Parse.
    let manifest = response.json::<Manifest>().await?;

    Ok(manifest)
}

// ──────────────────────────────────────────────────────────────────────────
//  Adapter: Manifest -> the launcher's native RepositorySchema model
// ──────────────────────────────────────────────────────────────────────────
//
// The install/download/launch pipeline is driven entirely by `RepositorySchema`
// stored in SQLite. Rather than fork that pipeline, a manifest is mapped onto a
// synthetic repository so the existing orchestrator, torrent engine, and
// launcher run unchanged:
//   * `heavy_rom_magnet`  -> SourceUri::Magnet (the game's download source)
//   * `launch_config.args`-> GameLaunchConfig.args_template (with {rom_path})
//   * `visuals.*`         -> cover/hero artwork
//
// Note: the reference manifest carries no emulator download URL — only
// `core_bundle_p2p_hash` (a hash) and `shader_cache_url` (shaders). Emulators
// are therefore still installed over HTTP via the app's bundled platform
// profiles, keyed by platform; `core_bundle_p2p_hash` is currently unused.

impl Manifest {
    /// Stable synthetic repository id derived from the manifest name, e.g.
    /// `manifest-underground-retro-archive`.
    pub fn repository_id(&self) -> String {
        let slug: String = self
            .repository_name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        let slug = slug
            .split('-')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        if slug.is_empty() {
            "manifest".to_string()
        } else {
            format!("manifest-{slug}")
        }
    }

    /// Convert the manifest into a `RepositorySchema` that the rest of the app
    /// can store and install from. Magnet ROMs become the games' download
    /// sources; launch args carry over verbatim.
    pub fn to_repository_schema(&self) -> RepositorySchema {
        let repository_id = self.repository_id();
        let catalog = self
            .games
            .iter()
            .map(|game| game.to_repository_game())
            .collect();

        RepositorySchema {
            metadata: RepositoryMetadata {
                id: repository_id,
                name: self.repository_name.clone(),
                version: self.manifest_version.clone(),
                schema_version: 1,
                maintainer: None,
                homepage_url: None,
                license: None,
                trust_level: Some("unknown".to_string()),
                content_hash: None,
                updated_at: Some(self.last_updated.clone()),
            },
            // Manifests do not describe BIOS/keys/firmware; those stay manual.
            system_files: Vec::new(),
            catalog,
        }
    }
}

impl Game {
    fn to_repository_game(&self) -> RepositoryGame {
        let cover = non_empty(&self.visuals.cover_url);
        let hero = non_empty(&self.visuals.background_url);

        // The magnet uri is the ROM download. `core_bundle_p2p_hash` is not a
        // BitTorrent info-hash for the ROM, so it is intentionally not used as
        // info_hash here.
        let downloads = vec![SourceUri::Magnet {
            uri: self.assets.heavy_rom_magnet.clone(),
            info_hash: None,
            size_bytes: None,
        }];

        // Re-join the pre-split args into a shell-safe template that
        // launcher::parse_launch_args can split back identically. {rom_path}
        // survives untouched and is aliased to {game_path} in the launcher.
        let args_template = if self.launch_config.args.is_empty() {
            None
        } else {
            shlex::try_join(self.launch_config.args.iter().map(String::as_str)).ok()
        };

        RepositoryGame {
            id: self.title_id.clone(),
            platform: self.platform.clone(),
            title: self.title.clone(),
            description: None,
            cover_image_url: cover.clone(),
            trailer_url: None,
            artwork: Some(GameArtwork {
                cover,
                hero,
                logo: None,
                screenshots: Vec::new(),
            }),
            metadata: None,
            content_mode: None,
            setup_profile_id: None,
            downloads,
            expected_extensions: expected_extensions_for(&self.platform),
            required_system_file_ids: Vec::new(),
            launch: Some(GameLaunchConfig {
                args_template,
                preferred_file: None,
            }),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Default game-file extensions per platform, so file resolution and launch
/// readiness work even though manifests omit them.
fn expected_extensions_for(platform: &str) -> Vec<String> {
    let extensions: &[&str] = match platform {
        "switch" => &["nsp", "xci"],
        "nes" => &["nes"],
        "snes" => &["sfc", "smc"],
        "n64" => &["z64", "n64", "v64"],
        "gba" => &["gba"],
        "nds" => &["nds"],
        "gamecube" => &["iso", "rvz", "gcm"],
        "wii" => &["iso", "rvz", "wbfs"],
        "ps1" => &["bin", "cue", "chd", "pbp"],
        "ps2" => &["iso", "chd"],
        "ps3" => &["iso"],
        "psp" => &["iso", "cso"],
        "genesis" => &["md", "gen", "bin"],
        "saturn" => &["cue", "chd", "iso"],
        "dreamcast" => &["cdi", "gdi", "chd"],
        _ => &[],
    };
    extensions.iter().map(|ext| ext.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "manifest_version": "1.0",
        "repository_name": "Underground Retro Archive",
        "last_updated": "2026-06-16",
        "games": [
            {
                "title_id": "0100F2C0115B6000",
                "title": "The Legend of Zelda: Tears of the Kingdom",
                "platform": "switch",
                "game_version": "1.2.1",
                "visuals": {
                    "cover_url": "https://images.igdb.com/cover.png",
                    "background_url": "https://images.igdb.com/bg.jpg"
                },
                "assets": {
                    "heavy_rom_magnet": "magnet:?xt=urn:btih:abc",
                    "core_bundle_p2p_hash": "hash123",
                    "shader_cache_url": "https://example.com/shaders.zip"
                },
                "launch_config": {
                    "engine": "suyu",
                    "executable": "suyu-cmd.exe",
                    "args": ["-f", "-g", "{rom_path}"],
                    "inject_mods": ["60fps_v3", "dynamic_fps"]
                }
            }
        ]
    }"#;

    #[test]
    fn parses_reference_manifest() {
        let manifest: Manifest =
            serde_json::from_str(SAMPLE).expect("reference manifest should deserialize");
        assert_eq!(manifest.repository_name, "Underground Retro Archive");
        assert_eq!(manifest.games.len(), 1);

        let game = &manifest.games[0];
        assert_eq!(game.platform, "switch");
        assert_eq!(game.launch_config.engine, "suyu");
        assert_eq!(game.launch_config.args, ["-f", "-g", "{rom_path}"]);
        assert_eq!(game.assets.heavy_rom_magnet, "magnet:?xt=urn:btih:abc");
    }

    #[test]
    fn missing_required_field_is_a_parse_error() {
        // `games` omitted entirely -> serde_json must reject it.
        let broken = r#"{
            "manifest_version": "1.0",
            "repository_name": "Broken",
            "last_updated": "2026-06-16"
        }"#;
        assert!(serde_json::from_str::<Manifest>(broken).is_err());
    }

    #[test]
    fn app_error_serializes_with_kind_and_message() {
        let value = serde_json::to_value(AppError::Network("boom".into())).unwrap();
        assert_eq!(value["kind"], "network");
        assert_eq!(value["message"], "boom");
    }

    #[test]
    fn converts_manifest_to_repository_schema() {
        let manifest: Manifest = serde_json::from_str(SAMPLE).unwrap();
        let schema = manifest.to_repository_schema();

        assert_eq!(schema.metadata.id, "manifest-underground-retro-archive");
        assert_eq!(schema.metadata.name, "Underground Retro Archive");
        assert_eq!(schema.metadata.version, "1.0");
        assert_eq!(schema.metadata.updated_at.as_deref(), Some("2026-06-16"));
        assert!(schema.system_files.is_empty());
        assert_eq!(schema.catalog.len(), 1);

        let game = &schema.catalog[0];
        assert_eq!(game.id, "0100F2C0115B6000");
        assert_eq!(game.platform, "switch");
        assert_eq!(game.expected_extensions, vec!["nsp", "xci"]);

        // The ROM magnet becomes the single download source.
        match &game.downloads[..] {
            [SourceUri::Magnet { uri, .. }] => {
                assert_eq!(uri, "magnet:?xt=urn:btih:abc");
            }
            other => panic!("expected one magnet source, got {other:?}"),
        }
    }

    #[test]
    fn emulator_url_is_optional_and_parses_when_present() {
        // Absent in the reference sample -> defaults to None.
        let manifest: Manifest = serde_json::from_str(SAMPLE).unwrap();
        assert!(manifest.games[0].assets.core_bundle_url.is_none());
        assert!(manifest.games[0].assets.core_bundle_sha256.is_none());

        // Present -> captured verbatim.
        let with_url = SAMPLE.replace(
            "\"shader_cache_url\": \"https://example.com/shaders.zip\"",
            "\"shader_cache_url\": \"https://example.com/shaders.zip\",\n\
             \"core_bundle_url\": \"https://example.com/suyu.zip\",\n\
             \"core_bundle_sha256\": \"deadbeef\"",
        );
        let manifest: Manifest = serde_json::from_str(&with_url).unwrap();
        assert_eq!(
            manifest.games[0].assets.core_bundle_url.as_deref(),
            Some("https://example.com/suyu.zip")
        );
        assert_eq!(
            manifest.games[0].assets.core_bundle_sha256.as_deref(),
            Some("deadbeef")
        );
    }

    #[test]
    fn manifest_launch_args_round_trip_through_template() {
        let manifest: Manifest = serde_json::from_str(SAMPLE).unwrap();
        let schema = manifest.to_repository_schema();
        let template = schema.catalog[0]
            .launch
            .as_ref()
            .and_then(|launch| launch.args_template.clone())
            .expect("args template should be set");

        // shlex split must reproduce the original argv, {rom_path} intact.
        let split = shlex::split(&template).expect("template splits cleanly");
        assert_eq!(split, vec!["-f", "-g", "{rom_path}"]);
    }
}
