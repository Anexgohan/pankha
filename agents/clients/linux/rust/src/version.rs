//! Agent version, embedded at build time from the PANKHA_VERSION env var.
//! See build.rs for the resolution logic.

pub const VERSION: &str = env!("PANKHA_VERSION");
