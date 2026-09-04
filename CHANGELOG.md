# Changelog

## 0.12.6 (devel)
- Simplified legacy updater recovery according to the shared `UPGRADE.md` standard: the temporary authoritative `upgrade.ps1` no longer probes whether `upgrade.ps1` exists in the old local `HEAD` before repository synchronization.
- Removed the failing `git cat-file -e HEAD:upgrade.ps1` migration probe that Windows PowerShell 5.1 could promote to a terminating error under `$ErrorActionPreference = 'Stop'`.
- A locally dirty `upgrade.cmd` is now accepted only when Git semantics confirm that its working-tree content already matches `origin/devel`; arbitrary local launcher edits still abort the upgrade instead of being overwritten.
- The temporary runner then synchronizes `devel`, verifies `HEAD == origin/devel`, installs dependencies, builds, and verifies synchronized SUM versions as before.
- Bumped SUM runtime/package/Companion versions to 0.12.6. No VPP or application manifest changes are part of this release.

## 0.12.5 (devel)
- Fixed the temporary batch launcher so the repository path assigned inside the `--temp-launcher` parenthesized block is read with delayed expansion (`!REPO_DIR!`) instead of stale `%REPO_DIR%` expansion.
- The launcher now enters the actual repository, applies the exact process-scoped `safe.directory` value to that repository, and passes the correct repository path to the temporary `upgrade.ps1` runner.
- This fixes the false `This folder is not a Git working tree` failure seen when the temporary launcher executed from `%TEMP%`.
- Bumped SUM runtime/package/Companion versions to 0.12.5. No VPP, application manifest, or `upgrade.ps1` changes are part of this release.

## 0.12.4 (devel)
- Replaced the fragile self-overwriting batch updater with the shared Windows upgrade architecture proven in the FolderHeatMap upgrade standard: a tiny `upgrade.cmd` launcher executes from `%TEMP%` and runs the authoritative `upgrade.ps1` extracted from `origin/devel`.
- The repository copy of `upgrade.cmd` is no longer overwritten while it is executing, removing the dirty-index/reset failure seen after the previous self-update stage.
- Added exact process-scoped Git `safe.directory` handling for mapped/network repositories, explicit `devel` synchronization and `HEAD == origin/devel` verification.
- Added strict tracked-change protection while allowing the known legacy dirty `upgrade.cmd` artifact to recover once during migration to the new updater.
- Removed broad `git clean -fd`; the updater no longer deletes arbitrary untracked runtime/user files.
- Added `logs/upgrade.log`, named upgrade phases, single-run diagnostics, upgrade locking, dependency/build execution, synchronized-version verification, and stable SUCCESS/WARNING/FAILED markers.
- Bumped SUM runtime/package/Companion versions to 0.12.4. No VPP or application manifest changes are part of this release.

## 0.12.3 (devel)
- Added configurable `Socket Box (cname)` connection field before the API key. Existing VoicePrompter instances default to `bc`, but the local Socket Box is no longer hard-coded in SUM routing or the SUB WebSocket URL.
- Updated the generic SUM transport runtime to the current VPP v1 Socket Box admission contract: after WebSocket authentication SUM sends `registerConnection` with the local host name and does not send normal application traffic until SUB returns `status: "admitted"`.
- Added handling of `replacementNegotiation`, `CONNECTION_NEGOTIATION_IN_PROGRESS`, `replaced`, and `negotiationTimeout`. SUM never automatically disconnects an arbitrary existing connection; when replacement negotiation is required it exposes a warning and logs the human-readable connection roster supplied by SUB.
- Kept heartbeat/server calls available during transport negotiation while blocking manifest application traffic until admission.
- Added compatibility parsing for both `socketBoxes` and legacy `mailboxes` server-ping state containers.
- Preserved the existing VoicePrompter manifest and VPP protocol version 1; no manifest file was modified by this upgrade.

## 0.12.2 (devel)
- Added VoicePrompter `Navigation: Controls` action using VPP `setNavigationControls` with `on`, `off`, and `toggle` states.
- Added synchronized Companion variable `navigation_controls`, updated from setting-changing responses, `settingChanged`, and `getSettingsSnapshot` as `navigationControls`.
- The VoicePrompter manifest declares `on`/`off` as replaceable state updates under replacement key `navigationControls`; `toggle` remains FIFO because repeated toggles are cumulative.
- Updated the VoicePrompter manifest to version 1.1.0 and kept VPP at protocol version 1.
- Updated `PROTOCOL.md` with deterministic `setNavigationControls` semantics and inclusion in synchronized settings/snapshot feedback.

## 0.12.1 (devel)
- Fixed the VoicePrompter manifest navigation action so `offset` is mapped into VPP `args.offset` for `markerBack`, `goBack`, `goCurrent`, `goNext`, and `markerNext`.
- `goStart` and `goFinish` remain argument-free, preserving the existing VPP navigation contract.
- Bumped the VoicePrompter manifest version to 1.0.1.

## 0.12.0 (devel)
- Refactored the Companion implementation from VoicePrompter Module (VPM) into the generic Socket Universe Module (SUM) runtime while preserving the existing Companion module id for compatibility.
- Added the first declarative profile at `manifest/voiceprompter.json`. VoicePrompter-specific action definitions, variable definitions, synchronized settings, runtime-memory declarations, event schemas, replay definitions, presets, manifest-specific configuration fields, and queue policies now live in the manifest rather than being hard-coded as the application contract in `main.js`.
- Added `Manifest` as the first module configuration field. Available choices are `None` and installed manifests; SUM does not connect or start application communication when `None` is selected.
- Preserved all existing VoicePrompter action IDs and the `vp` Companion variable namespace so existing buttons/presets remain compatible after the VoicePrompter manifest is selected.
- Preserved VPP v1 routing compatibility (`bc` to `vp`) and the existing external `source.app` value `VoicePrompterModule` for the VoicePrompter manifest, so current VP/VPB/SUB peers do not need protocol-specific changes for this internal refactor.
- Implemented the latest VPP synchronized-settings feedback contract: `settingChanged`, actual applied values returned in setting-changing responses, and `getSettingsSnapshot` initialization/reconnect synchronization now update Companion variables `microphone`, `voice_commands`, `font_size`, `text_alignment`, `mirror_mode`, `rotate_screen`, `recording_dock_opacity`, and `google_doc_url`.
- Added manifest-declared VPP queue policies. Repeated imperative/relative actions use `fifo`; absolute state actions use `replace`; toggle variants remain `fifo`; indexed Status Bar zone replacement keys are generated per zone.
- Kept Status Bar write-before-delivery runtime memory, bootstrap synchronization, zone replay, dynamic marker variables, heartbeat/ping, API key, reconnect, graceful disconnect, correlation, raw JSON diagnostics, and existing navigation behavior.
- Renamed the visible Companion module surface to `Socket Universe Module` / `Socket Universe`, while retaining repository and module compatibility identifiers needed by the current installation workflow.
- Updated `upgrade.cmd` branding to SUM while retaining exactly one self-update stage before normal devel upgrade work.

## 0.11.2 (devel)
- Updated `statusBarSyncRequest` handling to the current VPP contract: `args` must contain exactly one bootstrap `mode` value (`off`, `top`, or `bottom`).
- If `statusBarMemory.mode` is still unknown (`null`), VPM accepts the bootstrap mode from VP and stores it as the initial runtime mode before evaluating Status Bar availability.
- If VPM already knows `statusBarMemory.mode`, the bootstrap mode is ignored and cannot overwrite the authoritative runtime memory.
- After bootstrap, the existing startup `activeZoneCount` from `Maximum Status Bar zones` makes the Status Bar memory replayable, so VPM can return `available:true` immediately.
- Existing `statusBarModeChanged`, write-before-delivery, zone replay, reconnect/resync behavior, and Companion action IDs remain unchanged.

## 0.11.1 (devel)
- On VPM/Companion start, Status Bar `activeZoneCount` is initialized from the configured `Maximum Status Bar zones` value (default 6).
- `Status Bar: Set Zone Count` remains a runtime override, so the active count can be reduced and later restored up to the configured maximum without an initial zone-count action.
- Status Bar mode still starts unknown; initializing the zone count does not turn an empty/unknown Status Bar state into `off`, `top`, or `bottom`.
- Updated the `Maximum Status Bar zones` configuration tooltip to document its startup-default role.

## 0.11.0 (devel)
- Implemented the current VPP Status Bar authority model: VPM now keeps the latest valid Status Bar state as runtime memory for the lifetime of the running Companion/VPM instance.
- Status Bar runtime memory starts empty/unknown after a Companion/VPM restart; `off` remains a distinct valid state and no default mode/count is invented.
- Removed persistence of the Status Bar snapshot from Companion configuration. Legacy `statusBarSnapshot` configuration is discarded during normalization.
- Status Bar actions now update VPM memory before attempting delivery to VP, so temporary VP/VPBridge unavailability does not lose the latest desired state.
- `Status Bar: Mode` now also follows write-before-delivery semantics and remains remembered while VP is unavailable.
- Added handling of VP `statusBarSyncRequest`; VPM returns `available:false` when runtime memory cannot restore a complete state, or replays the current atomic Status Bar state and returns `available:true`.
- `statusBarModeChanged` updates VPM memory before any zone replay; replay triggered by this event never sends an old mode back to VP.
- Increasing the active zone count now re-sends already remembered zones that newly enter the active range.
- `Clear Status Bar` clears remembered zone data while preserving remembered mode and active zone count.
- Status Bar variables now describe runtime memory rather than a persistent snapshot.
- Added validation of required VPP envelope fields `source` and `timestamp`.
- Peer activity/heartbeat is refreshed only after an incoming VP message passes its applicable protocol validation.
- Updated `upgrade.cmd` with a single self-update stage: it checks the current `devel` copy on GitHub before doing anything else, replaces/restarts itself when different, then continues with the normal upgrade.
- Kept all existing Companion action IDs unchanged.

## 0.10.5 (devel)
- Grouped Companion action names using functional prefixes so related actions stay together in the action picker/search even though Companion does not provide native action categories.
- Added prefixes: `Advanced`, `Audio`, `Display`, `Document`, `Navigation`, `Reading`, and `Status Bar`.
- Moved `Voice Commands` into the `Audio` group together with `Microphone`.
- Kept existing action IDs unchanged, so saved buttons/actions continue to reference the same VPM actions.
- No VPP changes were required; this release changes only VPM action presentation/naming.

## 0.10.4 (devel)
- Renamed the VPM `Alignment` action to `Text Alignment` and changed its default selection to `Left`.
- Clarified `Font Size Adjust`: it accepts an integer relative delta (including values from variables/expressions), and VoicePrompter clamps the resulting font size to the same absolute 20–100 px range used by `Font Size`.
- Added `Recording Dock Opacity Adjust` using VPP `adjustRecordingDockOpacity`; it accepts an integer relative delta in percentage points and VoicePrompter clamps the resulting opacity to the existing 30–100% range.
- Updated `PROTOCOL.md` with the refined `adjustFontSize` semantics and the new `adjustRecordingDockOpacity` method.

## 0.10.3 (devel)
- Added `word` Companion variable, updated from VPP `wordChanged` events. The value keeps the last received word until another `wordChanged` event arrives, so unrelated traffic cannot clear it.
- Added `Alignment` action using VPP `setAlignment` with `left`, `center`, and `right`.
- Added `Mirror Mode` action using VPP `setMirrorMode` with `On`, `Off`, and `Toggle`.
- Added `Recording Dock Opacity` action using VPP `setRecordingDockOpacity`; variables/expressions are resolved and only whole percentages from 30 through 100 are sent.
- Changed the default `Marker argument variables` setting from 5 to 1 for new/default configurations; existing saved values remain unchanged.

## 0.10.2 (devel)
- Added `Font Size Adjust` action using VPP `adjustFontSize` with relative integer `delta` values; Companion variables/expressions are supported.
- VPM accepts adjustments from -80 through +80 px; `0` is a valid no-op. VoicePrompter clamps the effective resulting font size to the existing 20–100 px range.
- Extended `Rotate Screen` with `Toggle`; the VPP `setRotateScreen` state is now `on`, `off`, or `toggle`.
- Extended `PROTOCOL.md` with deterministic semantics for both changes.

## 0.10.1 (devel)
- Added `Font Size` action using VPP `setFontSize`; VPM resolves variables/expressions and only sends integer values from 20 through 100 px.
- Added `Voice Commands` action with `On`, `Off`, and `Toggle`, using VPP `setVoiceCommands`.
- Added `Rotate Screen` action with `On` and `Off`, using VPP `setRotateScreen`.
- All three new control calls use `expectsResponse: true`.
- Extended `PROTOCOL.md` with deterministic schemas and semantics for these controls.

## 0.10.0 (devel)
- Added `Microphone` action with `On`, `Off`, and `Toggle`, using VPP `setMicrophone`.
- Added `Synchronize Google Doc` action using VPP `syncGoogleDoc`.
- Added `Set Google Doc URL` action using VPP `setGoogleDocUrl`; Companion variables/expressions are resolved before sending.
- Google Docs URLs are validated locally as HTTPS `docs.google.com/document/...` URLs.
- All three new control calls use `expectsResponse: true` so VoicePrompter can return correlated success/error results.

## 0.9.9 (devel)
- Fixed marker state being cleared by unrelated VPP traffic such as ping/response messages. `marker_args` and marker `command` now keep the last marker value until another marker event arrives.
- Added configurable direct marker argument variables. `Marker argument variables` in module settings selects how many variables are registered, from 0 through 5; default is 5.
- Direct variables are zero-based: `marker_arg0`, `marker_arg1`, `marker_arg2`, `marker_arg3`, `marker_arg4`.
- On each marker event, registered direct argument variables are updated from the marker args array. Missing positions are cleared so stale arguments cannot leak from the previous marker.
- Changing the configured number of marker argument variables re-registers the Companion variable definitions without requiring a protocol change.

## 0.9.8 (devel)
- Removed the aggregate `Set Status Bar` action completely.
- Added `Maximum Status Bar zones` to VPM configuration: user range 1–10, default 6. This is only a practical VPM UI limit; VPP itself has no maximum zone count.
- `Set Status Bar Zone Count` and `Set Status Bar Zone` now validate against the configured VPM maximum instead of a hard-coded 1–6 protocol limit.
- Added a persistent authoritative Status Bar snapshot in VPM containing active zone count and last resolved text/alignment for known zones.
- Status Bar actions update the snapshot when executed even if VP is temporarily unavailable; the state is replayed when VP reconnects.
- After VP reconnects, VPM first synchronizes `getStatusBarMode`; when mode is `top` or `bottom`, it replays the stored zone count and zone data.
- When `statusBarModeChanged` changes from `off` to `top`/`bottom`, VPM replays the snapshot automatically.
- `Clear Status Bar` now clears stored zone content too, preventing old data from returning after reconnect.
- Reducing the configured maximum clamps the active zone count but retains higher-numbered stored zone data for possible later reuse.
- Added variables `status_bar_zone_count`, `status_bar_max_zones`, and `status_bar_snapshot`.

## 0.9.7 (devel)
- Removed the stale `static-text` diagnostics block from the connection configuration editor.
- Added live diagnostic variables: `diagnostic_level`, `diagnostic_status`, `diagnostic_vpbridge`, `diagnostic_voiceprompter`, and `diagnostic_reason`.
- Unified Companion connection status and diagnostic variables behind the same state-update path, so they cannot intentionally report different health states.
- Preserved color semantics: green = fully connected, yellow = warning/peer unavailable or graceful disconnect, red = bridge/config/auth/heartbeat failure, gray = connecting/unknown.
- Added a `Connection Diagnostics` preset using live variables.

## 0.9.6 (devel)
- Added visible connection diagnostics to the module configuration panel.
- Diagnostics show overall state, VPBridge state, VoicePrompter state, and the current reason for Warning/Error.
- Preserved the established color logic: green = connected, yellow = warning/peer unavailable or graceful server departure, red = connection/configuration failure, gray = connecting/unknown.
- Diagnostics use Companion `static-text` config fields and reflect the current module state when the configuration editor is opened.

## 0.9.0 (devel)
- Added VPP Status Bar actions and automatic mode synchronization.
- Added Companion variables `status_bar_mode` and derived `status_bar_enabled`.
- Extended `PROTOCOL.md` with deterministic Status Bar schemas and reconnect synchronization rules.

## 0.8.0 (devel)
- Implemented explicit VPP `from` / `recipient` routing.
- Navigation calls now use `expectsResponse: true`.
- Added correlated success/error acknowledgement handling.
- Added VPBridge server ping and mailbox-state parsing.
- Added idle heartbeat driven by the interval received from VPBridge, with fixed 5000 ms grace.
- Added three connection states: connected, bridge-only, disconnected.
- Added Companion variables `vp_connected`, `connection_state`, `heartbeat_interval_ms`, `from`, and `recipient`.
- Removed legacy positional `arg1..arg8` variables and generic `args` variable; marker arguments are exposed explicitly as `marker_args` JSON.
- Marker events with `expectsResponse: true` receive a terminal acknowledgement after successful parsing.
- `devel` updater follows the `devel` branch.

## 0.7.0
- Updated parser to the VPP v1 marker-event format.
- Unified message identity as `id`; removed deprecated `signature`, `message_id`, and `cue`.

## 0.6.x
- Added VPP v1 envelope support, deterministic call validation and protocol diagnostics.
- Added temporary raw `JSON` test action.
- Added Navigation presets.

## 0.5.x
- Introduced `PROTOCOL.md` and correlation concepts for call/response/progress/error.

## 0.4.x
- Expanded Navigation command set and renamed Cue terminology as Marker.

## 0.3.x
- Added VPBridge API-key authentication support.

## 0.2.x
- Added BC→VP Navigation action, IP/port configuration and multiline expression input.

## 0.1.x
- Initial Companion development module.
- WebSocket connection to VPBridge, auto-reconnect and incoming variables.
