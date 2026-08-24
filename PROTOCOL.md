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
  "source": { "app": "VoicePrompterModule", "version": "...", "companionVersion": "..." },
  "timestamp": "2026-08-17T22:16:00.000+02:00"
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

#### markerBack offset semantics

`markerBack` navigates relative to markers preceding or containing the current reading position.

- `offset: 0` means **the current marker**. VoicePrompter MUST move the reading position immediately below / after that marker, i.e. to the first readable content following the marker. If the reading position is already below that marker, the operation still targets that marker's post-marker reading position rather than the previous marker.
- `offset: 1` means the previous marker before the current marker.
- Higher positive offsets continue farther backward by markers.

`offset: 0` is therefore a valid and intentional value and MUST NOT be interpreted as "do nothing" or rejected as an invalid offset.

## VoicePrompter control methods

These calls expose existing VoicePrompter user operations to remote VPP control. They are normal application `call` messages addressed to `vp` and SHOULD use `expectsResponse: true` so the caller receives a correlated success or error result.

### setMicrophone

Controls the VoicePrompter microphone state. `args` MUST contain exactly `state`: `on`, `off`, or `toggle`. `on` and `off` are idempotent.

### setFontSize

Sets the VoicePrompter teleprompter font size in CSS pixels.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setFontSize",
  "args": { "size": 50 },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `size`, as an integer number of pixels. The current VPM implementation limits user input to **20–100 px** and MUST NOT send values outside this range. VoicePrompter currently supports the same range and SHOULD reject unsupported values with `INVALID_ARGUMENT` rather than silently applying an unrelated value.

VPM MAY resolve Companion variables/expressions before validation. If the resolved value is not an integer within 20–100, VPM sends no VPP message.

### adjustFontSize

Adjusts the current VoicePrompter teleprompter font size relatively.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "adjustFontSize",
  "args": { "delta": -5 },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `delta`, as an integer number of CSS pixels. Positive values increase the current size, negative values decrease it, and `0` means no change. VPM MAY resolve Companion variables/expressions before validating that the result is an integer.

The operation is relative to the font size that VP actually has at the time the call is processed. VoicePrompter MUST enforce the same effective **20–100 px** range used by `setFontSize`. If the arithmetic result would exceed a boundary, VP MUST clamp the effective result to the nearest boundary (20 or 100 px). Therefore a caller may request any integer relative delta; the resulting font size always remains within the absolute 20–100 px range. `delta: 0` is a valid no-op and still succeeds.

### setVoiceCommands

Controls activation of Voice Commands in VoicePrompter. `args` MUST contain exactly `state`: `on`, `off`, or `toggle`. `on` and `off` are idempotent.

### setRotateScreen

Controls the VoicePrompter Rotate Screen setting.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setRotateScreen",
  "args": { "state": "toggle" },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `state`, with value `on`, `off`, or `toggle`.

- `on` — ensure Rotate Screen is active;
- `off` — ensure Rotate Screen is inactive;
- `toggle` — invert the current Rotate Screen state.

`on` and `off` are idempotent and MUST operate on the same Rotate Screen state exposed by VoicePrompter locally.

### setAlignment

Controls the VoicePrompter text alignment setting.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setAlignment",
  "args": { "align": "left" },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `align`, with value `left`, `center`, or `right`. The call MUST set the same alignment state exposed by VoicePrompter locally. The operation is idempotent. VPM currently presents this action as **Text Alignment** and uses `left` as its default UI value; this is a VPM UI default, not a protocol restriction.

### setMirrorMode

Controls the VoicePrompter Mirror Mode setting.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setMirrorMode",
  "args": { "state": "toggle" },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `state`, with value `on`, `off`, or `toggle`.

- `on` — ensure Mirror Mode is active;
- `off` — ensure Mirror Mode is inactive;
- `toggle` — invert the current Mirror Mode state.

`on` and `off` are idempotent and MUST operate on the same Mirror Mode state exposed by VoicePrompter locally.

### setRecordingDockOpacity

Sets the VoicePrompter Recording Dock opacity as an integer percentage.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setRecordingDockOpacity",
  "args": { "opacity": 65 },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `opacity`, as an integer from **30 through 100**, inclusive. VPM MAY resolve Companion variables/expressions before validation. If the resolved value is not an integer within 30–100, VPM SHOULD send no VPP call. VoicePrompter MUST validate the received value and SHOULD reject unsupported values with `INVALID_ARGUMENT` rather than silently applying an unrelated value.

### adjustRecordingDockOpacity

Adjusts the current VoicePrompter Recording Dock opacity relatively.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "adjustRecordingDockOpacity",
  "args": { "delta": -5 },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `delta`, as an integer number of percentage points. Positive values increase opacity, negative values decrease it, and `0` means no change. VPM MAY resolve Companion variables/expressions before validating that the result is an integer.

The operation is relative to the Recording Dock opacity that VP actually has at the time the call is processed. VoicePrompter MUST enforce the same effective **30–100%** range used by `setRecordingDockOpacity`. If the arithmetic result would exceed a boundary, VP MUST clamp the effective result to the nearest boundary (30 or 100%). Therefore a caller may request any integer relative delta; the resulting opacity always remains within the absolute 30–100% range. `delta: 0` is a valid no-op and still succeeds.

### syncGoogleDoc

Requests immediate synchronization/reload of the content from the currently configured Google Docs source. The request uses exactly `args: {}` and `expectsResponse: true`. VoicePrompter MUST execute the same document synchronization operation available locally. If no usable Google Docs source is configured, synchronization fails, or the document cannot be loaded, VoicePrompter MUST return a correlated `error`. Successful completion returns a correlated `response`.

### setGoogleDocUrl

Sets the Google Docs document URL used by VoicePrompter and immediately synchronizes/reloads that document.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "setGoogleDocUrl",
  "args": { "url": "https://docs.google.com/document/d/.../edit" },
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `url`, as a non-empty string. The value MUST represent an absolute HTTPS Google Docs document URL on `docs.google.com` whose path belongs to `/document/...`. The receiving VoicePrompter MUST validate the URL before storing or using it and MUST NOT execute or interpret arbitrary script/content from the URL string.

A valid `setGoogleDocUrl` call is an atomic user operation with the semantic **set URL, then synchronize**. VoicePrompter MUST ensure the requested URL is the configured source URL and MUST then execute the same document synchronization/reload operation used by `syncGoogleDoc` before returning the terminal result.

If the requested URL differs from the currently configured URL, VP stores the new URL and then synchronizes the newly selected document. If the requested URL is already the current configured URL, VP MUST NOT treat the call as a no-op: it may skip rewriting the unchanged setting, but it MUST still perform the document synchronization/reload.

When `expectsResponse: true`, VP MUST return a correlated successful `response` only after both the URL-setting step (when needed) and the synchronization have completed successfully. If URL validation fails, VP MUST return an error and MUST NOT start synchronization. If the URL is valid but the subsequent synchronization fails, VP MUST return a correlated `error` for the `setGoogleDocUrl` request; the fact that the URL may already have been stored does not turn the overall operation into a success.

The standalone `syncGoogleDoc` method remains available for explicitly synchronizing the already configured document without supplying a URL. Callers MUST NOT need to send a second `syncGoogleDoc` after a successful `setGoogleDocUrl`, because synchronization is part of `setGoogleDocUrl` itself.

VPM MAY resolve Companion variables/expressions in the URL before sending it. VPM SHOULD reject an invalid resolved URL locally and send no VPP call.

## Status Bar

The Status Bar is a generic display surface controlled through normal VPP messages. Mode is exactly `off`, `top`, or `bottom`.

### Status Bar authority and runtime memory

During one running Companion/VPM session, **VPM is the authoritative memory of the latest valid Status Bar state**. VPM updates this memory first and then attempts to deliver the corresponding change to VP. Temporary VP or VPBridge unavailability therefore does not destroy the latest desired Status Bar state.

The runtime memory consists of:

- `mode` — `off`, `top`, `bottom`, or unknown when no valid value has yet been learned;
- `activeZoneCount` — a positive integer;
- zero or more zone records containing the last resolved `text` and `align` for each zone index.

The current VPM initializes `activeZoneCount` when the module instance starts from its configured **Maximum Status Bar zones** value. Therefore a fresh VPM runtime knows the desired active zone count before any `setStatusBarZoneCount` action is executed. The mode intentionally remains unknown until it is learned from a valid Status Bar operation or bootstrapped by VP during synchronization.

This memory is valid only for the lifetime of the running Companion/VPM instance. Restarting Companion/VPM creates a new runtime memory: `mode` becomes unknown, `activeZoneCount` is initialized again from the current VPM configuration, and remembered zone records start empty. VPP v1 does not require persistence of this memory across a Companion/VPM restart.

An unknown `mode` is **not** equivalent to `mode: off`. `off` is a real, valid state. Until VPM learns or bootstraps a valid mode, it does not yet have a complete authoritative Status Bar state to replay.

VP is still allowed to originate a user change of Status Bar mode while a usable VP↔VPM connection exists. Such a local change is reported through `statusBarModeChanged`; once VPM accepts that event, the received mode immediately becomes the newest authoritative value in VPM memory. VP MUST NOT allow a local Status Bar mode change while VPM is unavailable, because VPM could not learn that newer state.

The VPP protocol does **not** define a maximum number of Status Bar zones. `count` and `index` are positive integers beginning at 1. A particular sender implementation MAY expose a configurable practical/UI limit, but that limit is not part of VPP and MUST NOT be interpreted as a protocol maximum.

Zone text is UTF-8/Unicode plain text. Unicode symbols such as `●`, `■`, `▶`, `⏺`, `🔴` or `🟣` are valid. Zone text MUST NOT be interpreted as HTML, JavaScript, CSS, markup, URL, or executable content. Rendering MUST use a plain-text mechanism equivalent to DOM `textContent`; `innerHTML`, `eval`, or equivalent interpretation is forbidden. Each zone text is limited to 1024 Unicode characters; an empty string is valid.

### VPM write-before-delivery rule

For every Status Bar action originating in Companion, VPM MUST first update its runtime memory and only then attempt to send the corresponding VPP message to VP. If VP is unavailable, the delivery attempt may be skipped or fail, but the new runtime-memory value remains authoritative for later synchronization.

When VPM later replays memory to VP, it MUST replay the newest values that are current at replay time. A replay MUST NOT overwrite a newer `statusBarModeChanged` value with an older cached mode.

### setStatusBarMode

`args` MUST contain exactly `mode`: `off`, `top`, or `bottom`.

When the operation originates from VPM, VPM MUST store the requested mode in runtime memory before sending the call. When VP applies the mode, VP emits `statusBarModeChanged` with the actual resulting mode so VPM can confirm/update its authoritative memory.

### statusBarModeChanged event

VP emits `statusBarModeChanged` whenever the actual shared mode changes, whether locally or through `setStatusBarMode`. `args` contains exactly `mode`.

On receipt of a valid event, VPM MUST update `memory.mode` **before** any subsequent Status Bar replay or delivery. This event represents an actual newer state change and therefore always replaces the previously remembered mode.

A replay triggered by `statusBarModeChanged` MUST NOT send `setStatusBarMode` back to VP. It may replay only the zone state (`setStatusBarZoneCount` and `setStatusBarZone`) that belongs to the newly accepted mode. This rule prevents feedback loops and stale-mode overwrite.

### setStatusBarZoneCount

Changes only the number of active/rendered remote Status Bar zones. `args` contains exactly `count`, a positive integer (`>= 1`). VPP defines no upper bound. Changing count does not itself destroy, renumber, or rewrite stored zone data.

VPM MUST update `memory.activeZoneCount` before attempting delivery to VP. When the active count increases, VPM SHOULD also deliver any already remembered zones that have newly become active so stale/empty VP state is not exposed for those indexes.

A receiver that cannot process a particular value because of an implementation/resource limitation MAY reject it with `INVALID_ARGUMENT` when a correlated response is requested. Such an implementation limitation MUST NOT be represented as a VPP-wide maximum.

If mode is `off`, VP MAY discard incoming zone-display updates because nothing is rendered. VPM still retains the authoritative values in runtime memory and can replay them when the mode becomes visible again.

### setStatusBarZone

Changes one zone without replacing other zones. `args` MUST contain exactly:

- `index` — positive integer (`>= 1`), with no VPP-defined upper bound;
- `text` — plain-text string of 0–1024 Unicode characters;
- `align` — `left`, `center`, or `right`.

Empty `text` intentionally empties the zone. VPM MUST store the resolved `text` and `align` before attempting delivery. A zone may be stored above the current active count; it remains part of VPM memory and becomes renderable when `activeZoneCount` later includes that index.

For Companion variables/expressions, VPM stores the value that was actually resolved when the action executed, not the unevaluated expression string.

### statusBarSyncRequest event

VP uses `statusBarSyncRequest` to request the latest authoritative Status Bar state after VP starts, reconnects, restarts, after VPM itself restarts while VP remains running, or whenever VP otherwise needs its rendered Status Bar state synchronized.

The event is sent from `vp` to `bc`, MUST set `expectsResponse: true`, and `args` MUST contain exactly one field, `mode`, whose value is `off`, `top`, or `bottom`:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "statusBarSyncRequest",
  "args": { "mode": "off" },
  "expectsResponse": true,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

`args.mode` is a **bootstrap hint**, not a request to change the Status Bar mode. VP SHOULD send its actual current local mode with every `statusBarSyncRequest`; VPM decides whether that value is applicable.

VPM MUST apply the bootstrap hint only when `statusBarMemory.mode` is currently unknown/null. In that case VPM stores `args.mode` as the initial authoritative runtime mode before evaluating whether the Status Bar memory is available for replay.

If VPM already knows `statusBarMemory.mode`, it MUST ignore `args.mode` completely for state-authority purposes. The bootstrap hint MUST NOT overwrite an existing remembered mode, even if the local VP value differs. This is what makes reconnect/resync deterministic: once VPM has an authoritative runtime mode, VPM wins during synchronization.

Because the current VPM initializes `activeZoneCount` from configuration at module start, accepting a valid bootstrap mode is sufficient to make a fresh runtime Status Bar memory replayable even when no explicit `setStatusBarZoneCount` action has yet run. An empty `zones` map is a valid state and simply means no zone contents have yet been remembered.

If VPM still cannot form a valid replayable state, VPM sends the correlated terminal `response`:

```json
{
  "result": { "available": false }
}
```

VP then remains in `WAITING...` and MUST NOT invent or commit a replacement authoritative state.

If VPM has a valid state, VPM replays the current runtime memory using the existing atomic calls and then terminates the request with:

```json
{
  "result": { "available": true }
}
```

For a complete visible-state restore, replay order is:

1. `setStatusBarMode` with the current remembered mode;
2. if mode is `top` or `bottom`, `setStatusBarZoneCount` with the current remembered active count;
3. `setStatusBarZone` for every remembered zone that should be available to the current active range;
4. correlated `response` to the original `statusBarSyncRequest`.

When mode is `off`, the replay stops after `setStatusBarMode`; zone count and zone data stay in VPM memory for a later visible mode.

Because VPBridge preserves FIFO ordering within a mailbox route, the correlated `response` is sent only after VPM has queued the replay messages. `available: true` therefore means that VPM possessed or successfully bootstrapped a valid authoritative state and issued its restoration sequence; it does not create a second aggregate Status Bar protocol method.

### Synchronization and local mode-change safety

During initial synchronization VP SHOULD treat the Status Bar state as not ready and keep `WAITING...` until the `statusBarSyncRequest` terminal response is received.

A local VP mode change MUST NOT be allowed while there is no usable connection to VPM. During a reconnect/initial-sync window, VP SHOULD also avoid committing a local mode change until the pending Status Bar synchronization has completed. This removes ambiguity about whether a local change or a replayed value is newer.

The bootstrap `args.mode` carried by `statusBarSyncRequest` MUST NOT be used as a normal state-change mechanism. A real local user change after initialization MUST be reported through `statusBarModeChanged`, which immediately becomes the newest authoritative value in VPM memory.

If a valid `statusBarModeChanged` arrives while a replay is being prepared, VPM MUST treat the event value as newer: update memory first and MUST NOT subsequently send an older remembered mode from that replay. Implementations MAY cancel/restart the replay or continue only with zone delivery consistent with the new mode.

No VP-session identifier, first-sync flag, or revision counter is required by VPP v1. The bootstrap rule itself is sufficient: bootstrap mode is accepted only while VPM mode is unknown; after that, synchronization is VPM-authoritative and actual changes use `statusBarModeChanged`.

### VPM practical/UI zone limit

A VPM implementation MAY provide a user-configurable maximum number of zones for UI/readability purposes. This value limits what that VPM instance allows its actions to address or activate. It does not change VPP semantics and is not transmitted as a protocol capability or protocol maximum.

The current VPM design uses a configurable practical range of **1–10**, with a default of **6**. The configured value also initializes `activeZoneCount` whenever that VPM instance starts. These values belong to VPM configuration only. VP MUST NOT hard-code them as protocol limits.

If the VPM practical maximum is reduced below the current active zone count, VPM SHOULD reduce its active zone count to the configured maximum. Zone data above the practical maximum MAY remain stored in VPM runtime memory so it is not unnecessarily destroyed and can become usable again if the practical maximum is later increased.

### clearStatusBar

`clearStatusBar` remains part of protocol version 1. It uses `args: {}` and clears remembered remote zone data without implicitly changing `mode` or `activeZoneCount`. VPM MUST update its runtime memory before attempting delivery so cleared data cannot be unintentionally restored after a VP reconnect during the same Companion/VPM run.

There is no aggregate `Set Status Bar` VPP method or required VPM action. Status Bar restoration uses the existing atomic `setStatusBarMode`, `setStatusBarZoneCount` and `setStatusBarZone` operations plus the `statusBarSyncRequest` event.

## event

Events report unsolicited events. An event MAY set `expectsResponse: true` when explicit confirmation is needed. Event schemas are deterministic per event name.

### marker event

VP emits `marker` when reading crosses a skipped marker. `command` is a non-empty marker command/name and `args` is an ordered JSON array. When `expectsResponse` is true, VPM returns `response` after successful processing or `error` on failure.

### wordChanged event

VoicePrompter emits `wordChanged` when the currently selected/read word changes.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "wordChanged",
  "args": { "word": "Disclosure" },
  "expectsResponse": false,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly one field, `word`, as a UTF-8/Unicode string. The value represents the word that VP currently considers selected/active/read. An empty string is valid and means that no current word is selected.

VP SHOULD emit this event only when the effective word value changes. The event is high-frequency UI state and SHOULD use `expectsResponse: false`; no acknowledgement is required. VPM SHOULD expose the latest received value as Companion variable `word` (for example `$(vp:word)`) and MUST NOT clear it because of unrelated VPP traffic. The value changes only when a new valid `wordChanged` event is received, including an explicit empty-string value.

### disconnecting event — graceful disconnect

`disconnecting` announces an intentional, graceful departure **before** the sender closes its WebSocket. It allows the receiving side to update connection state immediately instead of waiting for heartbeat timeout. It is a best-effort event and normally uses `expectsResponse: false`.

`disconnecting` does not replace heartbeat/ping. Crashes, network failures, power loss, or any failure where the sender cannot emit the event continue to be detected by heartbeat.

For a client-originated intentional disconnect, `reason` is currently `user`. On receipt from the opposite mailbox, VP/VPM SHOULD immediately treat that peer as unavailable and expose the normal warning / bridge-only state. It MUST NOT wait for heartbeat timeout.

Before intentionally closing client sockets, VPBridge SHOULD send `disconnecting` independently to every connected mailbox. VPBridge `reason` MUST be one of `shutdown`, `restart`, or `exit`. On receipt, VP and VPM SHOULD immediately enter their server-unavailable/warning state without waiting for heartbeat timeout. Their existing reconnect logic remains active.

When connectivity returns, no new reconnect event is required. Existing WebSocket reconnect, server `ping`, mailbox-state discovery, heartbeat interval acquisition, Status Bar synchronization, and other existing initialization mechanisms continue exactly as before.

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

A valid ping response with opposite mailbox `connected:false` means bridge alive / peer unavailable. Failure to receive ping response within grace means VPBridge connection is unhealthy and client SHOULD reconnect. A received `disconnecting` event is authoritative for an intentional departure and permits immediate state update.

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
