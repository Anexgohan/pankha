//! Tracing subscriber setup, custom formatters, dynamic log level reload.

use tracing_subscriber::{reload, EnvFilter};

// Global reload handle for dynamic log level changes
pub type ReloadHandle = reload::Handle<EnvFilter, tracing_subscriber::Registry>;
pub static RELOAD_HANDLE: std::sync::OnceLock<ReloadHandle> = std::sync::OnceLock::new();

// Custom time formatter for logs: "YYYY-MM-DD HH:MM:SS" (local time)
pub struct LocalTimeFormatter;

impl tracing_subscriber::fmt::time::FormatTime for LocalTimeFormatter {
    fn format_time(&self, w: &mut tracing_subscriber::fmt::format::Writer<'_>) -> std::fmt::Result {
        // Use libc's localtime to get local time components
        #[cfg(unix)]
        unsafe {
            let now = libc::time(std::ptr::null_mut());
            let mut tm: libc::tm = std::mem::zeroed();
            libc::localtime_r(&now, &mut tm);

            write!(w, "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                tm.tm_year + 1900,
                tm.tm_mon + 1,
                tm.tm_mday,
                tm.tm_hour,
                tm.tm_min,
                tm.tm_sec)
        }

        #[cfg(not(unix))]
        {
            // Fallback for non-Unix systems
            write!(w, "{}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))
        }
    }
}

// Custom event formatter for logs: "YYYY-MM-DD HH:MM:SS [LEVEL] message"
pub struct CustomEventFormat;

impl<S, N> tracing_subscriber::fmt::FormatEvent<S, N> for CustomEventFormat
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    N: for<'a> tracing_subscriber::fmt::FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &tracing_subscriber::fmt::FmtContext<'_, S, N>,
        mut writer: tracing_subscriber::fmt::format::Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        use tracing_subscriber::fmt::time::FormatTime;

        // Write timestamp
        LocalTimeFormatter.format_time(&mut writer)?;
        write!(writer, " ")?;

        // Write level in brackets with color
        let level = event.metadata().level();
        let level_color = match *level {
            tracing::Level::TRACE => "\x1b[2m",  // Dim/gray
            tracing::Level::DEBUG => "\x1b[34m", // Blue
            tracing::Level::INFO => "\x1b[32m",  // Green
            tracing::Level::WARN => "\x1b[33m",  // Yellow
            tracing::Level::ERROR => "\x1b[31m", // Red
        };
        write!(writer, "{}[{}]\x1b[0m ", level_color, level)?;

        // Write the message and fields
        ctx.field_format().format_fields(writer.by_ref(), event)?;

        writeln!(writer)
    }
}

/// Initialize the tracing subscriber with reload capability.
/// Returns the filter string used, so main can log it.
pub fn init_tracing(filter: &str) {
    use tracing_subscriber::prelude::*;

    let env_filter = EnvFilter::new(filter);
    let (filter_layer, reload_handle) = reload::Layer::new(env_filter);

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(
            tracing_subscriber::fmt::layer()
                .with_timer(LocalTimeFormatter)
                .with_target(false) // Hide the target (crate name)
                .with_level(true)   // Show level
                .fmt_fields(tracing_subscriber::fmt::format::DefaultFields::new())
                .event_format(CustomEventFormat)
        )
        .init();

    // Store reload handle in the global static for signal handler access
    let _ = RELOAD_HANDLE.set(reload_handle);
}
