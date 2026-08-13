# Changelog

## 0.9.0 (devel)
- Added VPP Status Bar actions: `setStatusBarMode`, `setStatusBar`, and `clearStatusBar`.
- Added automatic `getStatusBarMode` synchronization after VP connects or reconnects.
- Added `statusBarModeChanged` event parsing for local or remote mode changes in VoicePrompter.
- Added Companion variables `status_bar_mode` and derived `status_bar_enabled`.
- Added generic 1–6 zone Status Bar action with Companion expressions/variables and left/center/right alignment.
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
- Expanded Navigation command set and renamed Cue terminology to Marker.

## 0.3.x
- Added VPBridge API-key authentication support.

## 0.2.x
- Added BC→VP Navigation action, IP/port configuration and multiline expression input.

## 0.1.x
- Initial Companion development module.
- WebSocket connection to VPBridge, auto-reconnect and incoming variables.
