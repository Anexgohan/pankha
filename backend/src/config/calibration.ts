// Fan calibration protocol version.
//
// Bump this on ANY change to the calibration procedure (sweep steps, settle or
// hygiene logic, measured fields): assigned fans whose stored version is older
// recalibrate automatically on the next control-loop pass, and their history
// from older protocol versions is purged (not comparable across protocols).
//
// v1: initial protocol (coast-artifact bug in min_start measurement)
// v2: true-stop confirmation + rotor rest before the from-rest start search
export const CALIBRATION_VERSION = 2;
