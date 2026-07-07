// Fan calibration protocol version.
//
// Bump this on ANY change to the calibration procedure (sweep steps, settle or
// hygiene logic, measured fields): assigned fans whose stored version is older
// recalibrate automatically on the next control-loop pass, and their history
// from older protocol versions is purged (not comparable across protocols).
//
// v1: initial protocol (coast-artifact bug in min_start measurement)
// v2: true-stop confirmation + rotor rest before the from-rest start search
// v3: command-aware settling (dead window + 3-sample confirm), 100% ramp
//     dwell, monotonicity re-measure - v2 recorded pre-ramp speeds as max_rpm
// v4: monotonicity guard generalized to the whole sweep (re-measure + replace
//     every inverted point once; v3 only fixed 100% and kept the max)
// v5: sustained-start confirmation - a start transient can blip the tach at
//     duties that cannot sustain rotation (recorded min_start below min_stop);
//     a genuine start must still be spinning after a hold at the same duty
// v6: command-echo guard - samples only count while the register readback
//     still echoes our commanded duty (FPC re-assert rule ported into
//     measurement); external writers (e.g. RPi5 kernel cooling ladder) moved
//     the register mid-settle and their speeds were recorded under our duty
export const CALIBRATION_VERSION = 6;
