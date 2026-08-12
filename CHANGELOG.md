# Changelog

## 0.7.0
- Updated parser to current VPP v1 marker-event format.
- Added `command` and positional marker `arg1..arg8` variables.
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
