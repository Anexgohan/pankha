# Settings

The **Settings** tab configures the Pankha Fan Control server and dashboard - as opposed to the per-agent settings, which live on each system card ([Advanced Settings](Agents-Advanced-Settings)). It has four sub-tabs: **General**, **Subscription**, **Diagnostics**, and **About**.

## General

### GUI Settings

*   **Graph Scale**: the time window for all dashboard sparklines - presets from 1 hour to 1 week, or a custom value (1 to 720 hours). Purely visual; it does not change what data is stored.

### Backend Settings

Server-side behavior, applied immediately:

| Setting | Options | What it does |
| :--- | :--- | :--- |
| **Data Retention** | 1 day to 365 days, or custom | How much sensor/fan history the database keeps. The maximum depends on your subscription tier; presets above your tier are grayed out. |
| **Hardware Pruning** | 1 day, 7 days, 30 days, Never | How long a fan can stay undetected before its record is cleaned up. Records are preserved and reactivate if the hardware returns. |
| **Fan Recalibration** | Manual only, or every 1 day to 1 year (default: 7 days) | How often each fan is automatically re-measured to keep its speed curve accurate. See [Fan Calibration & Health](Fan-Calibration). |
| **Log Level** | Error, Warn, Info, Debug, Trace | Verbosity of the **server's** logs. Each agent has its own log level on its system card. |

### Appearance

*   **Accent Color** and **Hover Tint**: the dashboard's primary color and the highlight color on mouse-over - pick a preset or any custom color.
*   **Primary Font** and **Secondary Font**: the interface font and the monospace font used for numbers (temperatures, RPM).
*   **Font Size**: scales all interface text; click the percentage to reset to 100%.
*   **Temperature Thresholds**: where readings flip from normal to caution, warning, and critical - both the boundary temperatures and the colors used everywhere on the dashboard. Set them globally, or per hardware type (CPU, GPU, storage, and so on) with a one-click way to copy the global values into a type as a starting point.

## Subscription

Shows your current plan and the available tiers with their limits (number of systems, data retention) and pricing. When a discount is running, an **Offers** section appears above the plans.

To activate a license: paste the key into **Enter License Key** and click **Activate**. A license is active on **one server at a time** - activating it on a second server prompts you to move it, which reverts the first server to the Free tier. Removing the license reverts the current server to Free; your data is untouched, only the tier limits change.

## Diagnostics

Support tooling for when something misbehaves:

*   **Export** a hardware diagnostic report from any online agent (or **Export All**) - a snapshot of the sensors and fans the agent sees, ideal to attach to a bug report.
*   **Report Bug** and **Feature Request** open a pre-filled GitHub issue; **Report + Diagnostics** copies all diagnostics along the way.
*   **Documentation** links back to this wiki.

## About

Version information and project links.

---

## Next Steps

*   [Advanced Settings](Agents-Advanced-Settings): the per-agent counterparts to these server settings.
*   [Dashboard](Dashboard): where the appearance and threshold choices show up.
*   [Troubleshooting](Troubleshooting): when to reach for the Diagnostics tab.
