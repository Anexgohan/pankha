# Fan Profiles & Control Logic

Pankha provides a sophisticated control engine designed to keep your system quiet when idle and cool when under load. This page explains how the control logic works.

## Fan Profiles

A **Fan Profile** defines the relationship between a temperature source and a fan's speed.

| Profile Type | Description |
| :--- | :--- |
| **Silent** | Prioritizes silence. Fans stay off or at minimum speed (e.g., 30%) until temperatures reach ~60°C. Ramps up aggressively only near critical temps. |
| **Balanced** | The default for most systems. Provides a linear ramp-up that balances noise and cooling performance. |
| **Performance** | Aggressive cooling. Fans run at higher baseline speeds to maintain lower idle temperatures. |
| **Custom** | User-defined curve with unlimited control points. You define the exact behavior. |

### Control Logic

How does Pankha decide what speed to run a fan at?

1.  **Sensor Reading**: Reads the Assigned Control Sensor (e.g., "CPU Package").
2.  **Curve Lookup**: Finds the target speed for that temperature on the active profile curve.
3.  **Hysteresis Check**: Ignores small, rapid temperature fluctuations (see below).
4.  **Smoothing**: Gradually adjusts the current speed to the new target (see "Fan Step").

