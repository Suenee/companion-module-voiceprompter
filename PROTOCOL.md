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
  "source": {
    "app": "VoicePrompterModule",
    "version": "0.9.4",
    "companionVersion": "dev"
  },
  "timestamp": "2026-08-14T00:00:00.000+02:00"
}
```

Protocol version 1 routing names are exactly:

- `vp` — VoicePrompter mailbox;
- `bc` — VoicePrompterModule / Bitfocus Companion mailbox;
- `server` — VoicePrompterBridge itself.

VPBridge maintains exactly two transport mailboxes: `vp` and `bc`. `server` is not a mailbox. A connection to `/vp` owns `vp`; a connection to `/bc` owns `bc`.

`from` MUST match the mailbox through which the message was received. Messages addressed to `vp` or `bc` MUST be routed only to that mailbox. Messages addressed to `server` MUST be consumed by VPBridge and MUST NOT be forwarded.

`source` is diagnostic metadata and is distinct from routing identity.

`id` uniquely identifies one message and MUST NOT be reused. UUIDv7 is preferred.

## Correlation and acknowledgements

A message related to a previous message MUST contain `correlationId` equal to the original message's `id`.

Any VPP message with `expectsResponse: true` creates a request and MUST terminate with exactly one correlated `response` or `error`. Zero or more correlated `progress` messages MAY precede the terminal message.

A `response` means the requested processing completed successfully. An `error` means processing failed, was rejected, unsupported, or could not be completed.

Receipt of a valid message from the opposite mailbox, including `progress`, `response` or `error`, is proof of life and refreshes the peer-activity timer.

## call

`call` requests execution of a public protocol method.

`args` MUST be a JSON object. Use `{}` when there are no arguments. Each method has a deterministic argument schema. A receiver MUST reject unknown methods, unknown arguments, missing required arguments, or arguments of the wrong type with a correlated protocol `error` when `expectsResponse` is true.

### VoicePrompter navigation methods

- `goStart` — `args: {}`;
- `markerBack` — `args: { "offset": <integer> }`;
- `goBack` — `args: { "offset": <integer> }`;
- `goCurrent` — `args: { "offset": <integer> }`;
- `goNext` — `args: { "offset": <integer> }`;
- `markerNext` — `args: { "offset": <integer> }`;
- `goFinish` — `args: {}`.

Offset semantics: `goNext` positive moves forward and negative backward; `goBack` is the reverse; marker methods follow the analogous marker direction. `goCurrent` ignores sign: 0 does nothing, 1 goes to the current paragraph start, 2 to the previous paragraph, etc. `goStart` and `goFinish` do not use an offset.

Navigation calls SHOULD use `expectsResponse: true`. VoicePrompter MUST return a terminal `response` after successful execution or `error` after failure.

## Status Bar

The VoicePrompter Status Bar is a generic display surface controlled through normal VPP `call` and `event` messages. It does not introduce a separate protocol.

The mode is one shared VoicePrompter state with exactly these values:

- `off` — hidden;
- `top` — visible at the top;
- `bottom` — visible at the bottom.

The active zone count is an independent runtime value from **1 through 6**. Changing the active count changes how many zone slots are rendered. It MUST NOT renumber zones. Reducing the count MUST NOT require deleting stored in-session data for higher-numbered zones; increasing the count MAY therefore expose data previously set in the same connected session. Remote Status Bar data is still session/display data and SHOULD NOT be restored automatically after reconnect.

Status Bar zone text is UTF-8/Unicode plain text. Unicode symbols such as `●`, `■`, `▶`, `⏺`, `🔴` or `🟣` are valid text when supported by the rendering font. Zone text MUST NOT be interpreted as HTML, JavaScript, CSS, markup, a URL, or executable content. A receiver MUST render it through a plain-text mechanism equivalent to DOM `textContent`; it MUST NOT use `innerHTML`, `eval`, or equivalent interpretation of zone text.

Each zone text is limited to **1024 Unicode characters**. An empty string is valid and represents an intentionally empty zone.

### setStatusBarMode

`setStatusBarMode` changes the shared Status Bar mode.

`args` MUST contain exactly one field, `mode`, with value `off`, `top`, or `bottom`.

Changing the mode through this call changes the same state as changing it locally in VoicePrompter.

### getStatusBarMode

`getStatusBarMode` obtains the authoritative current mode after connection or reconnect.

Request uses `args: {}` and `expectsResponse: true`.

Successful `result` MUST contain exactly one field, `mode`, with value `off`, `top`, or `bottom`.

VPM MUST request this state after the VP mailbox becomes connected or reconnects. VPM MUST NOT treat a value cached across a disconnected session as authoritative.

### statusBarModeChanged event

VoicePrompter emits `statusBarModeChanged` whenever the actual shared mode changes, regardless of whether the change originated locally in VoicePrompter or remotely through `setStatusBarMode`.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "statusBarModeChanged",
  "args": { "mode": "bottom" },
  "expectsResponse": false,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `mode`, with value `off`, `top`, or `bottom`.

The event SHOULD be emitted only when the effective value actually changes.

VPM exposes the authoritative value as `status_bar_mode` (`off`, `top`, `bottom`) and MAY expose a derived enabled value where `off = 0` and `top/bottom = 1`.

### setStatusBarZoneCount

`setStatusBarZoneCount` changes only the number of active/rendered Status Bar zones.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setStatusBarZoneCount",
  "args": {
    "count": 4
  },
  "expectsResponse": false,
  "source": { "app": "VoicePrompterModule", "version": "0.9.4" },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field:

- `count`: integer from 1 through 6.

A value outside 1 through 6 or a non-integer is invalid. A deterministic receiver MUST reject invalid protocol arguments according to the normal VPP rules.

The Companion action MAY calculate `count` from variables/expressions. VPM validates the resolved value before sending. If the result is not an integer in the range 1 through 6, the Companion action does nothing and no VPP message is sent.

Changing the count does not itself change zone text or alignment. Reducing the count does not renumber zones and SHOULD preserve higher-numbered zone state for the current connected session so that a later increase can make it visible again.

If the current Status Bar mode is `off`, VoicePrompter MUST discard remote Status Bar display updates, including `setStatusBarZoneCount`, and MUST NOT queue them for later display.

### setStatusBarZone

`setStatusBarZone` changes one Status Bar zone without replacing the other zones.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setStatusBarZone",
  "args": {
    "index": 3,
    "text": "● REC",
    "align": "left"
  },
  "expectsResponse": false,
  "source": { "app": "VoicePrompterModule", "version": "0.9.4" },
  "timestamp": "..."
}
```

`args` MUST contain exactly:

- `index`: integer from 1 through 6;
- `text`: UTF-8/Unicode plain-text string, 0 to 1024 characters;
- `align`: `left`, `center`, or `right`.

An empty `text` intentionally empties that zone; it does not remove or renumber other zones.

A zone MAY be updated even when its index is currently above the active zone count; it remains non-rendered until the active count includes it. This permits dynamic count changes without forcing clients to resend unchanged data. This in-session state MUST NOT be treated as persistent across reconnects.

If the current mode is `off`, VoicePrompter MUST discard the update and MUST NOT retain it for later display.

The Companion action MAY calculate `index` from variables/expressions. VPM validates the resolved value before sending. A resolved index outside 1 through 6, or a value that is not an integer, causes the Companion action to do nothing and no VPP message is sent.

### Set Status Bar aggregate behavior in VPM

`Set Status Bar` is a Companion convenience action, not an additional VPP method requirement. Its UI always exposes six zone groups plus a `Number of active zones` selector.

When executed with active count `N`, VPM performs the equivalent of these normal VPP calls, in this order:

1. one `setStatusBarZoneCount({"count": N})` call;
2. one `setStatusBarZone(...)` call for each index `1` through `N`.

Zone groups above `N` remain stored in the Companion action configuration but are not evaluated and no message is sent for them. Empty zone text within `1..N` is valid and is sent as an empty string.

This aggregate action intentionally composes the same public methods that are also available as individual Companion actions. VoicePrompter does not need a separate `setStatusBar` implementation for this aggregate behavior.

### Legacy setStatusBar

Earlier VPM development builds used a `setStatusBar` method that replaced the complete zone array. VPM 0.9.4 and later no longer use this method for the aggregate Companion action. New VoicePrompter implementations SHOULD implement `setStatusBarZoneCount` and `setStatusBarZone` as the canonical zone-control methods. Existing `setStatusBar` handling MAY be retained temporarily for compatibility, but clients MUST NOT depend on it for new behavior.

### clearStatusBar

`clearStatusBar` remains part of protocol version 1 while its practical semantics are evaluated. It clears remote Status Bar data without changing the current mode.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "clearStatusBar",
  "args": {},
  "expectsResponse": false,
  "source": { "app": "VoicePrompterModule", "version": "0.9.4" },
  "timestamp": "..."
}
```

`clearStatusBar` is explicitly different from `setStatusBarMode({"mode":"off"})`: it removes remote content only; it does not hide the Status Bar. When remote content is cleared while mode remains `top` or `bottom`, VoicePrompter may display its own internal placeholder.

Remote zone data is session/display data and SHOULD NOT be restored automatically after reconnect unless explicitly sent again by VPM.

## event

Events report unsolicited events. An event MAY set `expectsResponse: true` when the sender needs explicit confirmation that the event was accepted and processed. Event schemas are deterministic per event name.

### marker event

VoicePrompter emits a `marker` event when reading crosses a skipped marker in square brackets.

`command` is a non-empty string containing the marker command/name. `args` is a JSON array containing the marker's ordered arguments. Numbers are JSON numbers; quoted values are strings.

Example `[VLC PLAY 2, "Intro.mp4", 5]` becomes:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "marker",
  "command": "VLC PLAY",
  "args": [2, "Intro.mp4", 5],
  "expectsResponse": true,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

Additional marker arguments MUST be comma-separated. String arguments MUST be double-quoted. Invalid marker syntax MUST NOT be emitted and SHOULD be logged diagnostically.

When `expectsResponse` is true, VPM returns `response` after successfully parsing/publishing the marker event or `error` if it cannot process it.

## progress

`progress` reports that work for a previous request is still in progress. `correlationId` is required. Progress does not terminate the request.

## response

`response` is the terminal successful response to a previous message that requested a response. `correlationId` is required and MUST equal the original message's `id`.

A simple acknowledgement MAY use:

```json
"result": { "success": true }
```

## error

`error` is the terminal unsuccessful response. For an error concerning a specific previous message, `correlationId` is required.

`error.code` is stable and machine-readable. `error.message` is human-readable. `error.details` is optional structured diagnostic data.

Recommended common error codes include `INVALID_MESSAGE`, `INVALID_ROUTING`, `UNKNOWN_METHOD`, `UNKNOWN_ARGUMENT`, `INVALID_ARGUMENT`, `COMMAND_FAILED`, `UNSUPPORTED_PROTOCOL`, and `TIMEOUT`.

## Server ping

`ping` is a system `call` handled by VPBridge. It verifies the bridge connection and obtains current mailbox state and heartbeat policy.

A ping MUST use `from` as caller mailbox (`vp` or `bc`), `recipient: "server"`, `method: "ping"`, `args: {}`, and `expectsResponse: true`.

VPBridge MUST consume the ping locally and MUST NOT forward it.

The successful result contains both mailbox connection states and `heartbeat.intervalMs`. The same response shape is used for a ping originating from `vp`; only `recipient` changes.

An unsupported message addressed to `server` SHOULD receive a correlated `error` and MUST NOT be forwarded.

## Heartbeat / idle health check

VPBridge is authoritative for the heartbeat interval. The default is **30000 ms (30 seconds)**. The interval is configured on VPBridge and distributed to both clients in the server ping response as `result.heartbeat.intervalMs`.

VP and VPM MUST obtain the heartbeat interval after establishing or re-establishing their WebSocket connection.

Normal valid VPP traffic from the opposite mailbox is proof of life. If peer traffic has occurred within the heartbeat interval, no heartbeat ping is necessary.

After a full heartbeat interval without valid peer traffic, the client sends a `ping` to `server`.

Clients use a fixed implementation grace period of **5000 ms (5 seconds)** after sending the heartbeat ping. With the default interval, a client therefore allows up to **35000 ms (35 seconds)** from the last confirmed peer activity before treating expected health confirmation as failed.

A valid ping response with the opposite mailbox `connected: false` means the bridge is alive but the peer is unavailable. Failure to receive the ping response within the grace period means the VPBridge connection itself is unhealthy and the client SHOULD reconnect.

## Connection-state interpretation

Clients SHOULD expose:

- **connected** — VPBridge WebSocket is healthy and the opposite mailbox is connected;
- **bridge-only** — VPBridge WebSocket is healthy but the opposite mailbox is not connected;
- **disconnected** — VPBridge WebSocket is unhealthy or server ping timed out.

## VPBridge transport rule

VPBridge SHALL authenticate according to transport configuration, accept only complete syntactically valid JSON messages, verify routing envelope fields needed for transport, route `vp`/`bc` messages unchanged according to FIFO/buffer rules, consume `server` messages locally, maintain mailbox connection state, and reject invalid JSON diagnostically.

Except for routing and explicit `server` methods, VPBridge SHALL NOT interpret application-level VPP fields such as application methods, marker commands, Status Bar data, application arguments, results, progress data, or application errors.

## Compatibility

A receiver unable to support `protocolVersion` SHOULD return `UNSUPPORTED_PROTOCOL` when a correlated response is possible.

Receivers MAY ignore unknown optional metadata fields, but MUST NOT silently accept unknown deterministic method/event arguments.

Application and Companion versions are diagnostic metadata and do not replace `protocolVersion`.
