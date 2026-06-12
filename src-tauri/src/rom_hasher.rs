use std::io::Read;
use std::path::Path;

use crc32fast::Hasher as Crc32Hasher;
use md5::Md5;
use serde::Serialize;
use sha1::Sha1;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RomHashes {
    pub crc32: String,
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
    pub size: u64,
}

pub fn hash_rom(path: &Path, mut progress: impl FnMut(u64, u64)) -> Result<RomHashes, String> {
    if !path.is_file() {
        return Err(format!("ROM path is not a file: {}", path.display()));
    }

    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Failed to open ROM: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("Failed to inspect ROM: {error}"))?
        .len();

    let mut crc32 = Crc32Hasher::new();
    let mut md5 = Md5::new();
    let mut sha1 = Sha1::new();
    let mut sha256 = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    let mut read_total = 0_u64;

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read ROM: {error}"))?;
        if read == 0 {
            break;
        }

        let chunk = &buffer[..read];
        crc32.update(chunk);
        md5.update(chunk);
        sha1.update(chunk);
        sha256.update(chunk);
        read_total = read_total.saturating_add(read as u64);
        progress(read_total, size);
    }

    Ok(RomHashes {
        crc32: format!("{:08x}", crc32.finalize()),
        md5: hex::encode(md5.finalize()),
        sha1: hex::encode(sha1.finalize()),
        sha256: hex::encode(sha256.finalize()),
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::hash_rom;

    #[test]
    fn hashes_rom_in_one_pass_against_known_vectors() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("abc.rom");
        std::fs::write(&path, b"abc").unwrap();
        let mut progress_events = Vec::new();

        let hashes = hash_rom(&path, |read, total| progress_events.push((read, total))).unwrap();

        assert_eq!(hashes.size, 3);
        assert_eq!(hashes.crc32, "352441c2");
        assert_eq!(hashes.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hashes.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hashes.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(progress_events.last(), Some(&(3, 3)));
    }

    #[test]
    fn rejects_directories() {
        let temp = tempfile::tempdir().unwrap();
        let error = hash_rom(temp.path(), |_, _| {}).unwrap_err();
        assert!(error.contains("not a file"));
    }
}
