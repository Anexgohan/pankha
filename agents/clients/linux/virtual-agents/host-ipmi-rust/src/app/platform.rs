//! Compile-time platform identity constants.

/// Maps Rust's `std::env::consts::ARCH` to project vocabulary.
/// Single source of truth for architecture naming within this agent.
pub fn project_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        "arm" => "arm32",
        other => other,
    }
}
