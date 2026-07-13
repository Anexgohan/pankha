# IPMI Agent

The Pankha IPMI Agent is for enterprise servers whose fans are owned by the **BMC** (Baseboard Management Controller - Dell's iDRAC, Supermicro's onboard BMC, and similar) rather than by the operating system. On these machines the regular [Linux Agent](Agents-Linux) can often see temperatures but not touch the fans - the BMC is in charge. The IPMI agent talks to the BMC directly, using `ipmitool` and vendor-specific commands.

Like every Pankha agent, it is a single Rust binary and a pure relay: it reads sensors, executes fan commands from your server, and connects to nothing else ([Agent Philosophy](Agent-Philosophy)).

> **Alpha - built by the community**: IPMI support is the newest part of Pankha Fan Control and is in an alpha state. A set of verified vendor profiles ships built-in, and this feature only grows through people running it on real hardware - see [Help Grow Vendor Support](#help-grow-vendor-support) below.

## Which Agent Do I Need?

*   Fans respond to the OS (a desktop, workstation, NAS, or any machine where `lm-sensors`/hwmon sees PWM fans): use the **[Linux Agent](Agents-Linux)**.
*   Rack server where the BMC controls the fans (iDRAC, Supermicro, ASRock Rack, Tyan, Lenovo): use the **IPMI agent** - typically running on that server itself, or pointed at the BMC over the network.

## Requirements

*   A supported BMC vendor (matrix below).
*   The agent reaches the BMC one of two ways:
    *   **Local** (default): running on the server itself (x86_64 Linux), through `/dev/ipmi0`. If that device is missing, load the kernel modules: `modprobe ipmi_devintf ipmi_si`.
    *   **Over the network** (IPMI over LAN): running on any Linux machine, driving a remote BMC with its network address and credentials - set `PANKHA_IPMI_HOST` (plus `PANKHA_IPMI_PORT`, `PANKHA_IPMI_USER`, `PANKHA_IPMI_PASS`) in the agent's environment.
*   **`ipmitool` must be installed** (`apt install ipmitool` / `dnf install ipmitool`). The install script does not install it for you.
*   Root privileges, as with the other agents.

## Vendor Support

Fan control over IPMI is vendor-specific - each BMC understands different commands. **Built-in profiles** currently ship for Dell PowerEdge (11th-14th generation racks and the T130/T630 towers) and Supermicro (X9 and X10 series), plus a monitor-only profile for the HP ProLiant DL360 Gen9. For everything else, the **[Profile Builder](#the-profile-builder)** lets you create a custom profile and test its commands against the live server before saving.

Where fan control is not available, the agent still works as a **monitor-only** agent (temperatures and RPM, no control).

| Vendor | Fan control | Notes |
| :--- | :--- | :--- |
| Dell (iDRAC 7/8) | Yes, per-zone percentage | Built-in profiles |
| Dell (iDRAC 9, older firmware) | Yes, per-zone percentage | Firmware below 3.34.34; built-in profiles |
| Dell (iDRAC 9, firmware 3.34.34+) | Not yet | Dell locked IPMI fan writes in this firmware; control through Redfish is in the works - monitor-only until then |
| Supermicro (X9, X10) | Yes, per-zone percentage | Built-in profiles |
| Supermicro (X11/X12/X13) | Unverified | Reported to use the same commands as X10 - build a profile and tell us how it goes |
| ASRock Rack | Unverified | IPMI fan control reported working in the community; no built-in profile yet |
| Tyan | Unverified | IPMI fan control reported working in the community; no built-in profile yet |
| Lenovo (IMM2, XCC) | Unverified | IPMI fan control reported working in the community; no built-in profile yet |
| HP/HPE (iLO 4/5/6) | Unverified | No known IPMI fan-write path - expect monitor-only (DL360 Gen9 monitor profile built in) |
| Fujitsu (iRMC) | Unverified | Expect monitor-only |
| Gigabyte server boards | Unverified | Expect monitor-only |
| ASUS server boards | Unverified | Expect monitor-only |

> **What about Redfish?** No major vendor currently accepts arbitrary "set fan to N%" writes over Redfish either - where Redfish fan settings exist, they are preset modes (Low/High/Optimal), not percentages. Granular control is an IPMI capability on the vendors that offer it. Pankha's Redfish support is in the works, which will bring mode-level control to vendors that only expose it that way (such as iDRAC 9 on locked firmware).

## Help Grow Vendor Support

This feature lives or dies on community reports. BMC fan control is undocumented territory - vendors publish nothing, behavior changes between firmware versions, and no one person owns every server. The matrix above only turns "Unverified" into "Yes" when someone runs Pankha on the real hardware and says what happened.

If you have server hardware, you can move this forward in under an hour:

*   **Verify a built-in profile**: run it on your model and [open an issue](https://github.com/Anexgohan/pankha/issues) with your model, firmware version, and the result.
*   **Author a profile for your hardware**: the [Profile Builder](#the-profile-builder) tests commands against your live server, and `--dry-run` lets the agent log what it *would* send before anything touches the BMC. Share the working JSON and it ships built-in for the next person with your board.
*   **Report failures too**: "this command returns an error on this firmware" is exactly as valuable as a success - it saves the next person the same hour.

Every report makes this page more honest and the catalog more useful. This is how the supported list gets from eight profiles to eighty.

> **There is a reward.** Verified profile submissions earn a **free yearly Pro license** (once confirmed by at least two other contributors), as part of the alpha/beta tester program - details in [Testers Required - Alpha & Beta Program](https://github.com/Anexgohan/pankha/discussions/11).

## How Profiles Work

Everything vendor-specific lives in a **BMC profile** - a JSON document describing what your BMC understands: how to parse its sensor output, which fan zones exist, how a percentage translates into command bytes, and the initialization and reset commands. The agent binary itself contains **zero hardcoded vendor commands** - the profile is the driver.

*   You pick the profile (vendor + model family) when deploying, or later from the **BMC** section on the server's dashboard card.
*   The agent fetches its assigned profile **from your Pankha server** - never from the internet - and saves it locally as `profile.json`. If the server is unreachable at startup, the local copy is used.
*   Changing the assignment later takes effect without touching the machine: the server tells the agent to re-fetch and hot-reload the profile.

Every profile must include working "hand control back to the BMC" commands - the agent **refuses to load** a profile without them. That guarantees there is always a safe way out (see Safety, below).

## The Profile Builder

The Profile Builder, in the [Deployment Center](Deployment-Center), is where new vendor support is born. It lets you create a profile for hardware that has no built-in one - and **prove every command against your real BMC** as you go, no hand-editing JSON, no guesswork. Profiles authored here are the primary way new hardware makes it into the built-in catalog, so if you get one working, share it.

How it works:

1.  **Deploy a bare IPMI agent first** (skip the profile - it runs monitor-only). The builder needs a live, online agent on the target server as its test bench.
2.  **Pick your vendor.** The builder pre-fills typical command shapes for known vendors, and warns you up front if you pick one with no known IPMI fan-write path.
3.  **Define the fan zones**: an ID and name per zone, its member fans (the exact names from `ipmitool sdr list full` - the field's tooltip reminds you), and the **speed translation** - how a percentage becomes command bytes (`decimal_hex` for most modern boards, `byte_scale` for older ones like Supermicro X9).
4.  **Enter and live-test each command.** The set-speed command uses a `{{SPEED_HEX}}` placeholder where the speed value goes; a **Test** button runs it on your server at a percentage you choose and shows the BMC's actual response, or its exact error. The same goes for the optional read-speed command, the initialization commands (take over from the BMC's automatic control), and the reset-to-factory commands (hand control back).
5.  **Save it**: **Download JSON** for your records, or **Assign to Agent** - the profile is stored on your Pankha server and the agent loads it on the spot.

> Tests send real commands - your fans genuinely respond during a set-speed test. Always finish by testing your **reset-to-factory** command so you have proven the way back to automatic control.

When your profile works, [open an issue](https://github.com/Anexgohan/pankha/issues) with the JSON and your model + firmware - it becomes a built-in profile for the next person with your hardware, and a verified submission earns you a **free yearly Pro license** ([Help Grow Vendor Support](#help-grow-vendor-support)).

## Installation

### Option A: Deployment Center (Recommended)

In the [Deployment Center](Deployment-Center), pick the **IPMI** platform in Step 1 - an extra **BMC Profile** step appears where you select your vendor and model (or build a custom profile). Copy the generated command and run it on the server as root.

The script downloads the IPMI agent from your Hub, writes the configuration, installs the systemd service, and registers your selected profile with the server; the agent then fetches the profile and starts. The server appears on your dashboard within seconds.

### Option B: Manual

1.  Download `pankha-agent-ipmi-linux_x64` from the [Releases Page](https://github.com/Anexgohan/pankha/releases):

```bash
mkdir -p /opt/pankha-agent && cd /opt/pankha-agent
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-ipmi-linux_x64
chmod +x pankha-agent
```

2.  Run the setup wizard and install the service, as with the Linux agent:

```bash
sudo ./pankha-agent --setup
```

3.  Assign a profile: either place a `profile.json` next to the binary (or point at one with `--profile <path>`), or assign one from the dashboard card's **BMC** section once the agent connects - it will fetch and load it.

The file layout matches the [Linux Agent](Agents-Linux) (`config.json`, logs in `/var/log/pankha-agent/`), plus `profile.json` alongside the binary.

## Fan Zones on the Dashboard

BMCs control fans in **zones**: one output drives a whole group of fans (for example, all four CPU fans). Individual fans in a zone cannot be set to different speeds - the zone is the smallest controllable unit, and Pankha presents it honestly:

*   The card's fan section is titled **Fan Zones**, with fans grouped under their zone.
*   Each fan row shows its live RPM and status, read-only.
*   The **Sensor** and **Profile** dropdowns sit at the zone level - one assignment drives every fan in the zone ([Dashboard](Dashboard), [Fan Profiles & Logic](Fan-Profiles)).

An IPMI agent **without an assigned profile** runs in monitor-only mode and its card shows a **read only** badge - assign a profile from the card's BMC section to enable control.

> **A note on speed percentages**: IPMI reports fan RPM, but most BMCs have no standard way to read back the current duty-cycle percentage. The agent uses the best source your hardware offers - a BMC percent sensor, a vendor read-back command from the profile, or, as a last resort, the last speed it commanded.

## Safety Model

The IPMI agent's exit strategy is stronger than software-controlled fans: the BMC has its own automatic thermal control, and the agent can always hand fan management back to it.

| Scenario | What happens |
| :--- | :--- |
| Agent stopped or server shut down | Runs the profile's reset commands - **BMC automatic control restored** |
| Emergency Stop from the dashboard | Same reset - BMC takes over at full automatic control |
| Connection to your server lost | Failsafe: zones hold your failsafe speed; local emergency-temperature watch stays active ([Advanced Settings](Agents-Advanced-Settings)) |
| Profile has no reset commands | Agent refuses to load it |

For testing a new or custom profile, `--dry-run` runs the agent while only **logging** the fan commands it would send, without executing them.

## CLI Commands

The command line is the same as the [Linux Agent](Agents-Linux) (`--setup`, `--start`, `--status`, `--log-show`, and the rest - run `--help` for the list), with two IPMI-specific additions:

| Command | Description |
| :--- | :--- |
| `--profile <PATH>` | Path to the BMC profile JSON (default: `./profile.json`) |
| `--dry-run` | Log `ipmitool` commands without executing them |

## When Something Is Off

The most common issue is a **profile mismatch**: commands for the wrong vendor make the BMC answer `Invalid command`, and the card shows an **Error badge** with the reason in its tooltip. The fix never requires touching the server - assign the correct profile from the card's BMC section and the agent reloads it on the spot. More in [Troubleshooting](Troubleshooting).

---

## Next Steps

*   [Deployment Center](Deployment-Center): deploy the IPMI agent and build custom profiles.
*   [Dashboard](Dashboard): how zones, badges, and the BMC section appear.
*   [Advanced Settings](Agents-Advanced-Settings): failsafe speed, emergency temperature, update rate.
*   [Agent Philosophy](Agent-Philosophy): why the agent is a relay and never touches the internet.
