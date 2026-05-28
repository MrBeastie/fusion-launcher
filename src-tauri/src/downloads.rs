use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use url::Url;

use crate::builtin_demo;
use crate::schema::SourceUri;

pub struct DownloadedFile {
    pub path: PathBuf,
    pub sha256: String,
}

pub async fn download_source_to_file(
    source: &SourceUri,
    destination: &Path,
) -> Result<DownloadedFile, String> {
    match source {
        SourceUri::Http { url, sha256, .. } => {
            download_http_to_file(url, sha256, destination).await
        }
        SourceUri::Bundled { path, sha256, .. } => {
            copy_bundled_to_file(path, sha256, destination).await
        }
        SourceUri::Magnet { uri, .. } => handle_torrent(uri).await,
        SourceUri::UserProvided { .. } => {
            Err("This source is user-provided and cannot be downloaded automatically.".to_string())
        }
    }
}

pub fn destination_for_source(
    root: &Path,
    platform: &str,
    subject_id: &str,
    source: &SourceUri,
    fallback_name: &str,
) -> PathBuf {
    let file_name = match source {
        SourceUri::Http { .. } => file_name_for_source(source, fallback_name),
        SourceUri::Bundled { .. } => file_name_for_source(source, fallback_name),
        SourceUri::Magnet { .. } => file_name_for_source(source, fallback_name),
        SourceUri::UserProvided { .. } => file_name_for_source(source, fallback_name),
    };
    root.join(safe_segment(platform))
        .join(safe_segment(subject_id))
        .join(file_name)
}

pub fn file_name_for_source(source: &SourceUri, fallback_name: &str) -> String {
    match source {
        SourceUri::Http { url, .. } => {
            file_name_from_url(url).unwrap_or_else(|| safe_segment(fallback_name))
        }
        SourceUri::Bundled { path, .. } => {
            file_name_from_path(path).unwrap_or_else(|| safe_segment(fallback_name))
        }
        SourceUri::Magnet { .. } => safe_segment(fallback_name),
        SourceUri::UserProvided { .. } => safe_segment(fallback_name),
    }
}

pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

async fn download_http_to_file(
    url: &str,
    expected_sha256: &str,
    destination: &Path,
) -> Result<DownloadedFile, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|error| format!("Failed to fetch source: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Source returned an error: {error}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read source body: {error}"))?;

    let actual_sha256 = hex::encode(Sha256::digest(&bytes));
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
        ));
    }

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::write(destination, &bytes)
        .await
        .map_err(|error| error.to_string())?;

    Ok(DownloadedFile {
        path: destination.to_path_buf(),
        sha256: actual_sha256,
    })
}

async fn copy_bundled_to_file(
    path: &str,
    expected_sha256: &str,
    destination: &Path,
) -> Result<DownloadedFile, String> {
    let bytes =
        builtin_demo::asset_bytes(path).ok_or_else(|| format!("Unknown bundled asset: {path}"))?;
    let actual_sha256 = hex::encode(Sha256::digest(bytes));
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
        ));
    }

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::write(destination, bytes)
        .await
        .map_err(|error| error.to_string())?;

    Ok(DownloadedFile {
        path: destination.to_path_buf(),
        sha256: actual_sha256,
    })
}

async fn handle_torrent(_magnet: &str) -> Result<DownloadedFile, String> {
    Err("Torrent handler is not implemented in v1.".to_string())
}

fn file_name_from_url(input: &str) -> Option<String> {
    let parsed = Url::parse(input).ok()?;
    let segment = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .last()?;
    Some(safe_segment(segment))
}

fn file_name_from_path(input: &str) -> Option<String> {
    let segment = input
        .split('/')
        .filter(|segment| !segment.is_empty())
        .last()?;
    Some(safe_segment(segment))
}

pub fn safe_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(|ch| ch == '.' || ch == '-')
        .chars()
        .take(120)
        .collect::<String>();

    if sanitized.is_empty() {
        "item".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_safe_path_segments() {
        assert_eq!(safe_segment("../bad:name.exe"), "bad-name.exe");
        assert_eq!(safe_segment(""), "item");
    }

    #[test]
    fn hashes_files_in_chunks() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file.bin");
        std::fs::write(&path, b"retrohydra").unwrap();

        assert_eq!(
            hash_file(&path).unwrap(),
            "21ac79b8aad84822f3677ad82121e77ca1dc1a2869e927e630fa4d6de807b5d7"
        );
    }

    #[tokio::test]
    async fn copies_bundled_assets_with_hash_verification() {
        let repo = crate::builtin_demo::repository_schema().unwrap();
        crate::builtin_demo::verify_embedded_assets(&repo).unwrap();
        let source = repo.catalog[0].downloads[0].clone();
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("retrohydra-smoke.nes");

        let file = download_source_to_file(&source, &destination)
            .await
            .unwrap();

        assert!(file.path.exists());
        assert_eq!(
            file.sha256,
            "904918a63180b96e6ffd7f98ef775e2b59fa92faf6802b7df450623ba07891df"
        );
    }
}
