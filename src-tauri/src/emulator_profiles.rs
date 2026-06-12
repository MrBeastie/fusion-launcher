use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const EMULATOR_PROFILES_JSON: &str = include_str!("../profiles/emulators.json");

/// SPDX licenses under which we are willing to *automatically download and
/// redistribute* an emulator binary to users. Non-commercial / no-derivatives
/// licenses (e.g. DuckStation's CC BY-NC-ND, Snes9x's bespoke non-commercial
/// terms) are intentionally excluded: those emulators must stay manual-select.
/// This is a hard gate so a future contributor cannot silently add a
/// non-redistributable emulator to the auto-install set.
const AUTO_INSTALL_LICENSE_ALLOWLIST: &[&str] = &[
    "GPL-2.0",
    "GPL-2.0-or-later",
    "GPL-3.0",
    "GPL-3.0-or-later",
    "LGPL-2.1",
    "LGPL-3.0",
    "MPL-2.0",
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmulatorProfile {
    pub id: String,
    pub platform: String,
    pub display_name: String,
    pub version_strategy: VersionStrategy,
    pub exe_relative_path: String,
    pub launch_args: Vec<String>,
    pub requires_system_files: bool,
    pub license: String,
    pub portable: bool,
}

impl EmulatorProfile {
    pub fn launch_args_template(&self) -> String {
        self.launch_args
            .iter()
            .map(|argument| argument.replace("{game}", "{game_path}"))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum VersionStrategy {
    GithubLatest { repo: String, asset_pattern: String },
    Fixed { url: String, sha256: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInstallResult {
    pub profile_id: String,
    pub exe_path: String,
    pub version: String,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorStatus {
    pub platform: String,
    pub installed: bool,
    pub exe_path: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub game_id: String,
    pub stage: String,
    pub message: String,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub game_id: String,
    pub status: String,
    pub error_code: Option<String>,
    pub message: Option<String>,
}

pub fn load_emulator_profiles() -> Result<Vec<EmulatorProfile>, String> {
    let profiles: Vec<EmulatorProfile> =
        serde_json::from_str(EMULATOR_PROFILES_JSON).map_err(|error| error.to_string())?;
    validate_profiles(&profiles)?;
    Ok(profiles)
}

pub fn load_emulator_profile(platform: &str) -> Result<Option<EmulatorProfile>, String> {
    Ok(load_emulator_profiles()?
        .into_iter()
        .find(|profile| profile.platform == platform))
}

fn validate_profiles(profiles: &[EmulatorProfile]) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut platforms = HashSet::new();
    for profile in profiles {
        if profile.id.trim().is_empty()
            || profile.platform.trim().is_empty()
            || profile.exe_relative_path.trim().is_empty()
        {
            return Err(
                "Emulator profile identifiers and executable paths cannot be empty.".into(),
            );
        }
        if !profile.portable {
            return Err(format!(
                "Automatic emulator profile {} must be portable.",
                profile.id
            ));
        }
        if !AUTO_INSTALL_LICENSE_ALLOWLIST.contains(&profile.license.trim()) {
            return Err(format!(
                "Automatic emulator profile {} has license '{}', which is not approved for \
                 automatic download/redistribution. Such emulators must be manual-select.",
                profile.id, profile.license
            ));
        }
        if !ids.insert(profile.id.clone()) {
            return Err(format!("Duplicate emulator profile id: {}", profile.id));
        }
        if !platforms.insert(profile.platform.clone()) {
            return Err(format!(
                "Duplicate automatic emulator platform: {}",
                profile.platform
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_all_six_automatic_profiles() {
        let profiles = load_emulator_profiles().unwrap();

        assert_eq!(profiles.len(), 6);
        for platform in ["nes", "snes", "n64", "gba", "ps2", "psp"] {
            assert!(load_emulator_profile(platform).unwrap().is_some());
        }
        assert!(load_emulator_profile("switch").unwrap().is_none());
    }

    #[test]
    fn bundled_auto_profiles_all_use_redistributable_licenses() {
        // Every shipped auto-install profile must pass the license gate.
        load_emulator_profiles().expect("bundled emulator profiles must validate");
    }

    #[test]
    fn non_commercial_license_is_rejected_for_auto_install() {
        let profiles = vec![EmulatorProfile {
            id: "ps1-duckstation".to_string(),
            platform: "ps1".to_string(),
            display_name: "DuckStation".to_string(),
            version_strategy: VersionStrategy::GithubLatest {
                repo: "stenzek/duckstation".to_string(),
                asset_pattern: "*.zip".to_string(),
            },
            exe_relative_path: "duckstation.exe".to_string(),
            launch_args: vec!["{game}".to_string()],
            requires_system_files: true,
            license: "CC-BY-NC-ND-4.0".to_string(),
            portable: true,
        }];

        let error = validate_profiles(&profiles).unwrap_err();
        assert!(error.contains("not approved"));
    }

    #[test]
    fn launch_arguments_use_launcher_placeholder() {
        let profile = load_emulator_profile("ps2").unwrap().unwrap();

        assert_eq!(profile.launch_args_template(), "-fullscreen -- {game_path}");
    }
}
