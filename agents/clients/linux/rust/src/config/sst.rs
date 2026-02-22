//! Single Source of Truth validation arrays (compile-time generated from ui-options.json).

// Include SST (Single Source of Truth) validation arrays generated at compile time
// from frontend/src/config/ui-options.json
mod sst_validation {
    include!(concat!(env!("OUT_DIR"), "/sst_validation.rs"));
}

pub use sst_validation::*;
