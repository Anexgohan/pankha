//! Linux hardware monitor submodule re-exports.

#[cfg(target_os = "linux")]
pub mod monitor;
#[cfg(target_os = "linux")]
pub mod sensors;
#[cfg(target_os = "linux")]
pub mod fans;
#[cfg(target_os = "linux")]
pub mod diagnostics;
