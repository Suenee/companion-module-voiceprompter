# Changelog

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
- Fixed marker state being cleared by unrelated VPP traffic such as ping/response messages. `marker_args` and marker `command` now keep the last marker value until a new marker event arrives.
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
