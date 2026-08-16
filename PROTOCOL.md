# VoicePrompter Protocol

Protocol version: **1**

VoicePrompter Protocol (VPP) is the application-level JSON protocol used between VoicePrompter, VoicePrompterModule and VoicePrompterBridge.

VoicePrompterBridge is primarily a transport layer. It authenticates connections, maintains transport queues, validates syntactically valid JSON, routes messages by mailbox, and handles only explicitly defined messages addressed to `server`.

## Common envelope

Every VPP message MUST contain `protocolVersion`, unique `id`, `type`, `from`, `recipient`, `source`, and `timestamp`.

```json
{
  "protocolVersion": 1,
  "id": "019c7f8e-7c5d-7a91-bfa3-2c6b78a6a421",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "source": { "app": "VoicePrompterModule", "version": "0.9.4", "companionVersion": "dev" },
  "timestamp": "2026-08-14T00:00:00.000+02:00"
}
```

Protocol version 1 routing names are exactly `vp`, `bc`, and `server`. VPBridge maintains exactly two transport mailboxes: `vp` and `bc`; `server` is not a mailbox.

`from` MUST match the mailbox through which the message was received. Messages addressed to `vp` or `bc` MUST be routed only to that mailbox. Messages addressed to `server` MUST be consumed by VPBridge and MUST NOT be forwarded. `source` is diagnostic metadata and is distinct from routing identity. `id` uniquely identifies one message and MUST NOT be reused; UUIDv7 is preferred.

## Correlation and acknowledgements

A message related to a previous message MUST contain `correlationId` equal to the original message's `id`. Any VPP message with `expectsResponse: true` creates a request and MUST terminate with exactly one correlated `response` or `error`. Zero or more correlated `progress` messages MAY precede it. Receipt of a valid message from the opposite mailbox is proof of life and refreshes the peer-activity timer.

## call

`call` requests execution of a public protocol method. `args` MUST be a JSON object. Each method has a deterministic argument schema.

### VoicePrompter navigation methods

- `goStart` — `args: {}`;
- `markerBack` — `args: { "offset": <integer> }`;
- `goBack` — `args: { "offset": <integer> }`;
- `goCurrent` — `args: { "offset": <integer> }`;
- `goNext` — `args: { "offset": <integer> }`;
- `markerNext` — `args: { "offset": <integer> }`;
- `goFinish` — `args: {}`.

Navigation calls SHOULD use `expectsResponse: true`.

## Status Bar

The Status Bar is a generic display surface controlled through normal VPP messages. Mode is exactly `off`, `top`, or `bottom`. Active zone count is an independent runtime value from 1 through 6 and MUST NOT renumber zones.

Zone text is UTF-8/Unicode plain text. Unicode symbols such as `●`, `■`, `▶`, `⏺`, `🔴` or `🟣` are valid. Zone text MUST NOT be interpreted as HTML, JavaScript, CSS, markup, URL, or executable content. Rendering MUST use a plain-text mechanism equivalent to DOM `textContent`; `innerHTML`, `eval`, or equivalent interpretation is forbidden. Each zone text is limited to 1024 Unicode characters; an empty string is valid.

### setStatusBarMode

`args` MUST contain exactly `mode`: `off`, `top`, or `bottom`.

### getStatusBarMode

Uses `args: {}` and `expectsResponse: true`. Successful `result` MUST contain exactly `mode`. VPM MUST request this state after VP connects or reconnects.

### statusBarModeChanged event

VP emits `statusBarModeChanged` whenever the actual shared mode changes, whether locally or through `setStatusBarMode`. `args` contains exactly `mode`.

### setStatusBarZoneCount

Changes only the number of active/rendered zones.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setStatusBarZoneCount",
  "args": { "count": 4 },
  "expectsResponse": false,
  "source": { "app": "VoicePrompterModule", "version": "0.9.4" },
  "timestamp": "..."
}
```

`count` MUST be an integer from 1 through 6. Changing count does not itself change zone text or alignment. Reducing count does not renumber zones and SHOULD preserve higher-numbered zone state for the current connected session. If mode is `off`, VP MUST discard the update and MUST NOT queue it for later display.

### setStatusBarZone

Changes one zone without replacing other zones. `args` MUST contain exactly `index` (integer 1–6), `text` (plain-text string 0–1024 Unicode characters), and `align` (`left`, `center`, or `right`). Empty `text` intentionally empties the zone. A zone may be updated above the active count and remain non-rendered until count includes it. This state is not persistent across reconnects. If mode is `off`, VP MUST discard the update.

### Set Status Bar aggregate behavior in VPM

`Set Status Bar` is a Companion convenience action, not a separate VPP method. With active count `N`, VPM sends one `setStatusBarZoneCount({"count":N})`, followed by one `setStatusBarZone(...)` for each index 1 through N. Zone groups above N remain stored in the Companion action but are not evaluated or sent.

### Legacy setStatusBar

Earlier development builds used `setStatusBar` to replace a complete zone array. VPM 0.9.4 and later use `setStatusBarZoneCount` and `setStatusBarZone` as canonical methods. Existing `setStatusBar` handling MAY be retained temporarily for compatibility.

### clearStatusBar

`clearStatusBar` remains part of protocol version 1 while its practical semantics are evaluated. It uses `args: {}` and clears remote Status Bar data without changing mode.

## event

Events report unsolicited events. An event MAY set `expectsResponse: true` when explicit confirmation is needed. Event schemas are deterministic per event name.

### marker event

VP emits `marker` when reading crosses a skipped marker. `command` is a non-empty marker command/name and `args` is an ordered JSON array. When `expectsResponse` is true, VPM returns `response` after successful processing or `error` on failure.

### disconnecting event — graceful disconnect

`disconnecting` announces an intentional, graceful departure **before** the sender closes its WebSocket. It allows the receiving side to update connection state immediately instead of waiting for heartbeat timeout.

It is a best-effort event and normally uses `expectsResponse: false`. A sender MUST attempt to send it before closing the socket, but shutdown/restart/exit MUST NOT be blocked indefinitely waiting for delivery or acknowledgement.

`disconnecting` does not replace heartbeat/ping. Crashes, network failures, power loss, or any failure where the sender cannot emit the event continue to be detected by heartbeat.

#### VP or VPM intentional disconnect

VP sends directly through VPBridge to BC/VPM:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "disconnecting",
  "args": { "reason": "user" },
  "expectsResponse": false,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

VPM uses the same event with `from: "bc"` and `recipient: "vp"`.

For a client-originated intentional disconnect, `reason` is currently `user`.

On receipt from the opposite mailbox, VP/VPM SHOULD immediately treat that peer as unavailable and expose the normal warning / bridge-only state. It MUST NOT wait for heartbeat timeout. The event is informational; it is not a request to disconnect the recipient.

#### VPBridge graceful shutdown/restart/exit

Before intentionally closing client sockets, VPBridge SHOULD send `disconnecting` independently to every connected mailbox.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "server",
  "recipient": "vp",
  "event": "disconnecting",
  "args": { "reason": "restart" },
  "expectsResponse": false,
  "source": { "app": "VoicePrompterBridge", "version": "..." },
  "timestamp": "..."
}
```

The event to VPM uses `recipient: "bc"` and its own unique `id`.

VPBridge `reason` MUST be one of:

- `shutdown` — bridge/server is intentionally being stopped;
- `restart` — bridge/server is intentionally restarting;
- `exit` — VPBridge application is intentionally terminating.

On receipt of `disconnecting` from `server`, VP and VPM SHOULD immediately enter their server-unavailable/warning state without waiting for heartbeat timeout. Their existing reconnect logic remains active.

When connectivity returns, **no new reconnect event is required**. Existing WebSocket reconnect, server `ping`, mailbox-state discovery, heartbeat interval acquisition, Status Bar synchronization, and other existing initialization mechanisms continue exactly as before.

## progress

`progress` reports that work for a previous request is still in progress. `correlationId` is required and progress does not terminate the request.

## response

`response` is the terminal successful response to a request. `correlationId` MUST equal the original message's `id`. A simple acknowledgement MAY use `result: { "success": true }`.

## error

`error` is the terminal unsuccessful response. Recommended common codes include `INVALID_MESSAGE`, `INVALID_ROUTING`, `UNKNOWN_METHOD`, `UNKNOWN_ARGUMENT`, `INVALID_ARGUMENT`, `COMMAND_FAILED`, `UNSUPPORTED_PROTOCOL`, and `TIMEOUT`.

## Server ping

`ping` is a system `call` handled by VPBridge. It verifies bridge connection and obtains mailbox state and heartbeat policy. It MUST use caller mailbox as `from`, `recipient: "server"`, `method: "ping"`, `args: {}`, and `expectsResponse: true`. VPBridge consumes it locally and MUST NOT forward it.

## Heartbeat / idle health check

VPBridge is authoritative for heartbeat interval. Default is 30000 ms (30 seconds). VP and VPM obtain it after establishing/re-establishing their WebSocket connection. Normal valid opposite-mailbox traffic is proof of life.

After a full interval without peer traffic, the client sends `ping` to `server`. Clients use a fixed 5000 ms (5 seconds) grace period. With default interval, expected health confirmation may therefore take up to 35000 ms (35 seconds).

A valid ping response with opposite mailbox `connected:false` means bridge alive / peer unavailable. Failure to receive ping response within grace means VPBridge connection is unhealthy and client SHOULD reconnect.

A received `disconnecting` event is authoritative for an intentional departure and permits immediate state update; it does not alter heartbeat rules for unannounced failures.

## Connection-state interpretation

Clients SHOULD expose:

- **connected** — VPBridge WebSocket healthy and opposite mailbox connected;
- **bridge-only / warning** — VPBridge healthy but opposite mailbox unavailable, including an announced peer `disconnecting`;
- **disconnected / server unavailable** — VPBridge unhealthy, server `disconnecting` received, or server ping timed out.

## VPBridge transport rule

VPBridge authenticates according to transport configuration, accepts complete syntactically valid JSON, verifies routing envelope fields, routes `vp`/`bc` messages unchanged according to FIFO/buffer rules, consumes `server` messages locally, maintains mailbox connection state, and rejects invalid JSON diagnostically.

Except for routing, explicit server methods, and its own graceful-shutdown `disconnecting` event, VPBridge SHALL NOT interpret application-level methods, marker commands, Status Bar data, application arguments, results, progress data, or application errors.

## Compatibility

A receiver unable to support `protocolVersion` SHOULD return `UNSUPPORTED_PROTOCOL` when a correlated response is possible. Receivers MAY ignore unknown optional metadata fields, but MUST NOT silently accept unknown deterministic method/event arguments. Application versions are diagnostic metadata and do not replace `protocolVersion`.
