use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum UpdateCheckError {
    EndpointUnreachable,
    ParseError(String),
    SignatureInvalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckReport {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_app_update<R: Runtime>(
    app: AppHandle<R>,
) -> Result<UpdateCheckReport, UpdateCheckError> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(classify_update_error)?
        .check()
        .await
        .map_err(classify_update_error)?;

    Ok(match update {
        Some(update) => UpdateCheckReport {
            available: true,
            current_version: update.current_version,
            version: Some(update.version),
            date: update.date.map(|date| date.to_string()),
            body: update.body,
        },
        None => UpdateCheckReport {
            available: false,
            current_version,
            version: None,
            date: None,
            body: None,
        },
    })
}

#[tauri::command]
pub async fn install_app_update<R: Runtime>(app: AppHandle<R>) -> Result<(), UpdateCheckError> {
    let update = app
        .updater()
        .map_err(classify_update_error)?
        .check()
        .await
        .map_err(classify_update_error)?;

    if let Some(update) = update {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(classify_update_error)?;
    }

    Ok(())
}

fn classify_update_error(error: UpdaterError) -> UpdateCheckError {
    match error {
        UpdaterError::Reqwest(error) if error.is_decode() => {
            UpdateCheckError::ParseError(error.to_string())
        }
        UpdaterError::ReleaseNotFound | UpdaterError::Network(_) | UpdaterError::Reqwest(_) => {
            UpdateCheckError::EndpointUnreachable
        }
        UpdaterError::Minisign(_)
        | UpdaterError::Base64(_)
        | UpdaterError::SignatureUtf8(_)
        | UpdaterError::AuthenticationFailed => UpdateCheckError::SignatureInvalid,
        UpdaterError::Serialization(error) => UpdateCheckError::ParseError(error.to_string()),
        other => UpdateCheckError::ParseError(other.to_string()),
    }
}
