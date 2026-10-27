//! Print `path<TAB>size<TAB>blake3` for each file argument.
//!
//! Used to regenerate `src/base_build_reference.json` from a verified
//! supported install (install plan §3). It uses the same `blake3` crate the
//! launcher verifies with, so the hashes can't drift from the runtime.
//!
//! ```text
//! cargo run --example fingerprint -- "C:\ZEmu\H1Z1.exe"
//! ```
//!
//! Paths are printed as given; the JSON generator rewrites them to
//! install-relative form.

use std::io::Read;

fn main() {
    for path in std::env::args().skip(1) {
        match hash_file(&path) {
            Ok((size, hash)) => println!("{path}\t{size}\t{hash}"),
            Err(err) => {
                eprintln!("{path}: {err}");
                std::process::exit(1);
            }
        }
    }
}

fn hash_file(path: &str) -> std::io::Result<(u64, String)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 4 * 1024 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok((size, hasher.finalize().to_hex().to_string()))
}
