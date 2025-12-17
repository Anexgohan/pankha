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

---

## Advanced Settings

Each agent has specific settings to fine-tune this behavior. You can edit these in the **Configuration** section of any system card.

### Hysteresis (Start/Stop Delay)
*   **Purpose**: Prevents fans from "revving" up and down constantly due to micro-fluctuations in temperature (e.g., CPU jumping from 40°C to 45°C for 1 second).
*   **How it works**: If `Hysteresis` is set to **4°C**, the fan speed will NOT change until the temperature changes by at least 4°C from the last update point.
*   **Example**:
    *   Temp: 50°C -> Fan: 40%
    *   Temp rises to 53°C (Change < 4°C) -> **Ignored** (Fan stays at 40%)
    *   Temp rises to 55°C (Change > 4°C) -> **Update** (Fan increases to new target)

### Fan Step % (Smoothing)
*   **Purpose**: Makes speed transitions smooth and pleasing to the ear, avoiding sudden "jet engine" spin-ups.
*   **How it works**: Limits how much the fan speed can change per update cycle (approx. every 2 seconds).
*   **Example**:
    *   Current Speed: 30%
    *   Target Speed: 100%
    *   Fan Step: **5%**
    *   **Result**: The fan will go 30% -> 35% -> 40% ... taking several seconds to reach 100%.

### Emergency Temperature
*   **Purpose**: Failsafe protection.
*   **How it works**: If any sensor reaches this threshold (default **90°C**), the agent **ignores all profiles, hysteresis, and smoothing**.
*   **Action**: All fans are immediately forced to **100% speed** to protect hardware.

### Update Interval (Agent Rate)
*   **Default**: 3000ms (3 seconds).
*   **Description**: How often the agent reads sensors and updates fan speeds. Lower values = more responsive but higher CPU usage. Higher values = very stable, low overhead.
