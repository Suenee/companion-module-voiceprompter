# VoicePrompter Protocol

Protocol version: **1**

VoicePrompter Protocol (VPP) is the application-level JSON protocol used between VoicePrompter and integrations such as VoicePrompterModule.

VoicePrompterBridge is primarily a transport layer. It authenticates connections, maintains transport queues, validates that each WebSocket message is syntactically valid JSON, and routes messages according to their `recipient`. Messages addressed to `vp` or `bc` are forwarded unchanged. Messages addressed to `server` are system messages for VPBridge itself.

## Common envelope

Every protocol message SHOULD contain `protocolVersion`, unique `id`, `type`, `from`, `recipient`, `source`, and `timestamp`.

```json
{
  "protocolVersion": 1,
  "id": "019c7f8e-7c5d-7a91-bfa3-2c6b78a6a421",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "source": { "app": "VoicePrompterModule", "version": "0.7.0", "companionVersion": "dev" },
  "timestamp": "2026-08-12T10:46:00.000+02:00"
}
```

`from` identifies the logical sender for routing. `recipient` identifies the destination. Protocol version 1 defines `vp`, `bc`, and `server`. `source` remains diagnostic application/version metadata.

VPBridge maintains two fixed transport mailboxes in protocol version 1: `vp` and `bc`. `server` addresses VPBridge itself and is not a mailbox.

## Correlation and acknowledgements

A message related to a previous message MUST contain `correlationId` equal to the original message's `id`. Multiple requests may be in flight simultaneously.

Any VPP message with `expectsResponse: true` MUST terminate with exactly one correlated `response` or `error`. Zero or more `progress` messages MAY precede it.

A `response` means the message arrived and requested processing completed successfully. Its `result` may be a simple success acknowledgement or contain requested data. An `error` means the message arrived but processing failed, was rejected, or could not be completed.

This acknowledgement traffic also serves as proof of life.

## call

`call` requests execution of a public protocol method. `args` MUST be a JSON object; use `{}` when there are no arguments.

Initial navigation methods: `goStart`, `markerBack`, `goBack`, `goCurrent`, `goNext`, `markerNext`, `goFinish`.

Offset semantics: `goNext` positive moves forward and negative backward; `goBack` is the reverse; `markerNext` and `markerBack` follow the analogous marker direction. `goCurrent` ignores sign: 0 does nothing, 1 goes to the current paragraph start, 2 to the previous paragraph, etc. `goStart` and `goFinish` do not require an offset.

## server ping

`ping` is a system method handled by VPBridge. It verifies the bridge and obtains mailbox state and heartbeat policy. It MUST use `recipient: "server"`, `args: {}`, and `expectsResponse: true`. VPBridge consumes it locally and MUST NOT forward it.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "server",
  "method": "ping",
  "args": {},
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "2026-08-12T10:46:00.000+02:00"
}
```

Response:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "correlationId": "<ping-id>",
  "type": "response",
  "from": "server",
  "recipient": "bc",
  "result": {
    "mailboxes": {
      "vp": { "connected": true },
      "bc": { "connected": true }
    },
    "heartbeat": { "intervalMs": 30000 }
  },
  "source": { "app": "VoicePrompterBridge", "version": "..." },
  "timestamp": "2026-08-12T10:46:00.001+02:00"
}
```

The `mailboxes` object is keyed by recipient/mailbox name. `connected` reports whether the mailbox owner currently has an active connection to VPBridge. Clients SHOULD read mailbox state by mailbox name rather than depend on dedicated fields.

## Heartbeat / idle health check

VPBridge is authoritative for the heartbeat interval. Default: **30000 ms (30 seconds)**. VP and VPM obtain `result.heartbeat.intervalMs` from the server ping response for the current connection session and obtain it again after reconnect.

Normal valid VPP traffic is proof of life. If traffic occurred within the heartbeat interval, no ping is necessary. After a full interval of inactivity, the client pings `server` for current mailbox state.

Clients use a fixed implementation grace period of **5000 ms (5 seconds)** after sending the heartbeat ping. The grace period is hard-coded, not configured by VPBridge, and absorbs scheduler/network/processing jitter. With the default interval, failure is therefore concluded only after up to **35000 ms (35 seconds)** without the expected health confirmation.

Any valid VPP message from the opposite endpoint, including terminal `response` or `error`, refreshes the activity timer.

## event

Events report unsolicited events. Event-specific `args` shapes may differ from `call.args`.

### marker event

VoicePrompter emits a `marker` event when reading crosses a skipped marker in square brackets. `command` contains the marker command/name and `args` is always a JSON array. Numbers are JSON numbers; quoted values are strings. VoicePrompter parses marker syntax but does not interpret command meaning.

Example `[VLC PLAY 2, "Intro.mp4", 5]` becomes:

```json
{
  "command": "VLC PLAY",
  "args": [2, "Intro.mp4", 5]
}
```

Additional arguments MUST be comma-separated. String arguments MUST be double-quoted. Invalid marker syntax is not emitted and SHOULD be logged diagnostically.

## progress

Reports that work for a previous request is still in progress. `correlationId` is required. Progress does not terminate the request.

## response

Terminal successful response to a previous message that requested a response. `correlationId` is required and MUST equal the original message's `id`.

## error

Terminal unsuccessful response. For an error concerning a specific previous message, `correlationId` is required and MUST equal that message's `id`. `error.code` is stable and machine-readable; `error.message` is human-readable; `error.details` is optional structured diagnostic data.

## VPBridge transport rule

VPBridge SHALL authenticate the WebSocket connection, accept only syntactically valid JSON, inspect `from` and `recipient` only as required for routing/system handling, forward `vp`/`bc` messages unchanged according to FIFO/buffer rules, consume `server` messages locally, and interpret only explicitly defined server methods.

Except for routing and defined server methods, VPBridge SHALL NOT interpret application-level VPP fields.

## Compatibility

Receivers SHOULD ignore unknown optional fields. A receiver unable to support a protocol version or requested method SHOULD return a protocol `error` when possible. Application/Companion versions are diagnostic metadata and do not replace `protocolVersion`.
