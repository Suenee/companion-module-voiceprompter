# VoicePrompter Protocol

Protocol version: **1**

VoicePrompter Protocol (VPP) is the application-level JSON protocol used between VoicePrompter, VoicePrompterModule and VoicePrompterBridge.

VoicePrompterBridge is primarily a transport layer. It authenticates connections, maintains transport queues, validates syntactically valid JSON, routes messages by Socket Box, and handles only explicitly defined messages addressed to `server`.

## Common envelope

Every VPP message MUST contain `protocolVersion`, unique `id`, `type`, `from`, `source`, and `timestamp`. `recipient` is part of the VPP envelope but MAY be omitted for application traffic only when the active transport can resolve the destination deterministically under the rules below. Messages addressed to `server` MUST always contain explicit `recipient: "server"`.

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

SUB uses dynamically configured transport **Socket Boxes**. `server` is a reserved routing name representing SUB itself and is not a Socket Box. `vp` and `bc` are the concrete Socket Box names currently used by VoicePrompter and VPM; they are not the only Socket Box names permitted by VPP v1. Parts of this document may use the legacy word *mailbox* for a Socket Box; both terms refer to the same generic transport destination.

`from` MUST match the authenticated Socket Box through which the message was received when VPP is transported through SUB. Messages with an explicit or SUB-resolved Socket Box recipient MUST be routed only to that Socket Box according to the routing and multi-connection rules defined below. Messages addressed to `server` MUST be consumed by SUB and MUST NOT be forwarded. `source` is diagnostic metadata and is distinct from routing identity. `id` uniquely identifies one message and MUST NOT be reused; UUIDv7 is preferred.

### Recipient resolution and SUB routing

VPP is not limited to SUB transport. An explicit `recipient` therefore remains a valid and portable part of the VPP envelope and MAY be supplied by the sender whenever the destination is already known.

When VPP application traffic is transported through SUB, the sender MAY omit `recipient`. In that case SUB MUST resolve the destination from the authenticated sender Socket Box and SUB's routing table before queueing or forwarding the message. The routing decision MUST be transport-generic and MUST NOT be inferred from application names, `source.app`, manifest metadata, Socket Box naming conventions, or other application-specific knowledge.

Automatic recipient resolution succeeds only when the routing table yields exactly one permitted destination Socket Box for the authenticated sender Socket Box. SUB then treats that destination as the effective `recipient` for all subsequent routing, queueing, correlation, and multi-connection processing.

If no permitted destination exists, SUB MUST reject the message with `INVALID_ROUTING` when a correlated transport error can be returned. If more than one permitted destination exists and the sender omitted `recipient`, SUB MUST NOT choose arbitrarily and MUST reject the message with `AMBIGUOUS_RECIPIENT` when a correlated transport error can be returned.

If the sender supplies `recipient` explicitly, SUB MUST validate that destination against the routing table for the authenticated sender Socket Box. An explicitly supplied destination that is not permitted by that routing table MUST be rejected with `INVALID_ROUTING`; explicitly naming a Socket Box never bypasses SUB routing policy.

Before an application message leaves SUB toward a destination connection or is stored in a destination queue, it MUST have one concrete effective recipient, either supplied by the sender and validated by SUB or resolved by SUB from its routing table. Recipient omission is therefore an input convenience at the SUB boundary, not a recipient-less forwarded-message state.

For direct VPP communication without SUB, the sender SHOULD include `recipient` explicitly unless that transport provides an equivalent deterministic destination-resolution mechanism. When no intermediary transport can determine the destination, `recipient` is required. This preserves direct VPP use cases such as SUM communicating directly with another VPP-capable application while keeping SUB-specific routing knowledge out of SUM and other generic clients.

Application messages MAY contain optional transport metadata `targetConnectionId`. When present, it MUST be a non-empty SUB-generated connection identifier belonging to the effective recipient Socket Box. If `recipient` was omitted, SUB MUST resolve the recipient first and then validate `targetConnectionId` against that resolved Socket Box. Its routing semantics are defined under **Multi-connection Socket Box routing** below. Application code MUST NOT interpret `targetConnectionId` as application data.

## Correlation and acknowledgements

A message related to a previous message MUST contain `correlationId` equal to the original message's `id`. Any VPP message with `expectsResponse: true` creates a request and MUST terminate with exactly one correlated `response` or `error`. Zero or more correlated `progress` messages MAY precede it. Receipt of valid traffic from an opposite application Socket Box is proof of life and refreshes the peer-activity timer.

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

### setNavigationControls

Controls visibility of the VoicePrompter Navigation Controls / navigation buttons. `args` MUST contain exactly `state`: `on`, `off`, or `toggle`.

- `on` — ensure Navigation Controls are visible;
- `off` — ensure Navigation Controls are hidden;
- `toggle` — invert the current Navigation Controls visibility.

`on` and `off` are idempotent and MUST operate on the same Navigation Controls state exposed by VoicePrompter locally. When `expectsResponse: true`, the successful response follows the synchronized-setting result contract below and reports the actual resulting `navigationControls` value as `on` or `off`.

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

If VP has its local feature for remembering/persisting the last valid Google Docs URL enabled, a successful `setGoogleDocUrl` synchronization MUST update that persistent last-valid-URL value to the successfully loaded requested URL. This persistence update MUST happen only after the document has been loaded successfully; successful URL syntax validation or storing the configured URL alone is not sufficient. If synchronization fails, the previously persisted last valid URL MUST remain unchanged. If the requested URL is already the current configured URL, a successful synchronization still confirms that URL as the last valid URL and MAY rewrite the same persistent value. If VP has local last-valid-URL persistence disabled, `setGoogleDocUrl` MUST NOT create, update, clear, or otherwise modify that persistent value. VPP does not remotely enable or disable this local persistence setting.

If VP maintains a local recent-document / last-used-document history, MRU list, or equivalent queue/list of successfully opened Google Docs sources, a successful `setGoogleDocUrl` MUST update that history exactly as an equivalent successful local document open/switch would. This history update is independent of the optional last-valid-URL persistence setting above and therefore follows VP's normal local recent-history behavior. The history MUST be updated only after the requested document has been loaded successfully. URL validation alone, assigning the configured URL, or a failed synchronization MUST NOT add, promote, or otherwise modify the recent-document history. If the requested URL is already the current configured URL and synchronization succeeds, VP SHOULD treat that document as successfully used again and update/promote it according to the same local MRU semantics used for an equivalent local operation.

The standalone `syncGoogleDoc` method remains available for explicitly synchronizing the already configured document without supplying a URL. Callers MUST NOT need to send a second `syncGoogleDoc` after a successful `setGoogleDocUrl`, because synchronization is part of `setGoogleDocUrl` itself.

VPM MAY resolve Companion variables/expressions in the URL before sending it. VPM SHOULD reject an invalid resolved URL locally and send no VPP call.

## Synchronized settings and feedback

VPP supports deterministic synchronization of user-visible settings so a remote controller can expose the actual state as variables/feedback rather than merely remember what it requested. This mechanism applies only to settings explicitly declared by the application contract. It does not make arbitrary names or values valid.

For the current VoicePrompter contract the synchronized settings are exactly:

- `microphone` — string enum `on` or `off`;
- `voiceCommands` — string enum `on` or `off`;
- `navigationControls` — string enum `on` or `off`;
- `fontSize` — integer in the effective VoicePrompter font-size range;
- `textAlignment` — string enum `left`, `center`, or `right`;
- `mirrorMode` — string enum `on` or `off`;
- `rotateScreen` — string enum `on` or `off`;
- `recordingDockOpacity` — integer in the effective VoicePrompter opacity range;
- `googleDocUrl` — string containing the currently configured Google Docs URL; an empty string is valid when no URL is configured.

Navigation position/commands, `syncGoogleDoc`, raw/diagnostic JSON actions, marker data, `wordChanged`, and Status Bar zone/mode state are not part of this general settings mechanism. The `navigationControls` setting refers only to visibility of the Navigation Controls UI, not the current navigation position. Status Bar keeps its dedicated authority and synchronization model defined below.

### Result of a setting-changing call

A successful call that changes one synchronized setting MUST return the actual effective value applied by the receiver. The terminal `response.result` MUST contain exactly `setting` and `value` for that setting:

```json
{
  "type": "response",
  "correlationId": "...",
  "result": {
    "setting": "microphone",
    "value": "on"
  }
}
```

The value is the effective state after the operation, not merely the requested argument. This rule is mandatory for idempotent operations, `toggle`, relative adjustments, clamping, normalization, or any other case where the requested input is not itself sufficient to know the final state.

The current VoicePrompter method-to-setting mapping is deterministic:

- `setMicrophone` → `microphone`;
- `setVoiceCommands` → `voiceCommands`;
- `setNavigationControls` → `navigationControls`;
- `setFontSize` and `adjustFontSize` → `fontSize`;
- `setAlignment` → `textAlignment`;
- `setMirrorMode` → `mirrorMode`;
- `setRotateScreen` → `rotateScreen`;
- `setRecordingDockOpacity` and `adjustRecordingDockOpacity` → `recordingDockOpacity`;
- `setGoogleDocUrl` → `googleDocUrl`.

For example, if the current font size is 95 px and `adjustFontSize` requests `delta: 20`, VoicePrompter clamps the result to 100 px and returns `result: { "setting": "fontSize", "value": 100 }`.

A receiver MUST NOT return `toggle`, a requested delta, an unclamped requested value, or another command token as the setting feedback value. If the operation fails, it returns the normal correlated `error` and the remote side MUST NOT infer that the requested value became effective.

A remote implementation such as VPM/SUM SHOULD update its corresponding variable/feedback immediately from a valid successful response.

### settingChanged event

VoicePrompter emits `settingChanged` whenever the effective value of a synchronized setting changes independently of the remote controller, including a local user change or another local application path.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "settingChanged",
  "args": {
    "setting": "fontSize",
    "value": 72
  },
  "expectsResponse": false,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

`args` MUST contain exactly `setting` and `value`. `setting` MUST be one of the synchronized setting names declared above and `value` MUST match that setting's declared type and value constraints. Unknown setting names, additional arguments, or type-invalid values MUST NOT be silently accepted.

A remote implementation MUST treat a valid `settingChanged` value as the current effective state and update its corresponding variable/feedback. The event normally uses `expectsResponse: false`.

When a remote setting-changing call itself causes the effective value to change, the correlated response is sufficient to confirm the result. VoicePrompter MAY additionally emit the same `settingChanged` event for consistency with its local change notification path; receivers MUST tolerate this duplicate delivery because both messages carry the same effective state. If an idempotent call produces no effective change, no `settingChanged` event is required, but the correlated response MUST still return the actual current value.

### getSettingsSnapshot

`getSettingsSnapshot` provides deterministic initialization/reconnect synchronization of all synchronized settings without requiring one query per setting. It is a public VoicePrompter `call`, uses exactly `args: {}`, and MUST use `expectsResponse: true`.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "method": "getSettingsSnapshot",
  "args": {},
  "expectsResponse": true,
  "source": { "app": "VoicePrompterModule", "version": "..." },
  "timestamp": "..."
}
```

A successful response contains exactly one `settings` object inside `result`. For the current VoicePrompter contract that object contains all synchronized setting names exactly once and their current effective values:

```json
{
  "type": "response",
  "correlationId": "...",
  "result": {
    "settings": {
      "microphone": "off",
      "voiceCommands": "on",
      "navigationControls": "on",
      "fontSize": 72,
      "textAlignment": "center",
      "mirrorMode": "off",
      "rotateScreen": "off",
      "recordingDockOpacity": 80,
      "googleDocUrl": "https://docs.google.com/document/d/.../edit"
    }
  }
}
```

The snapshot reports actual current values; it does not request or modify settings. VPM/SUM SHOULD request it after the usable VP connection is established or re-established and MUST replace its synchronized setting variables/feedback from the returned snapshot. A partial snapshot, an unknown setting, a missing required setting, or an invalid value is a protocol error and MUST NOT be silently treated as a complete synchronized state.

The settings snapshot is independent of Status Bar synchronization. `getSettingsSnapshot` MUST NOT modify or replay Status Bar runtime memory, and `statusBarSyncRequest` MUST NOT be used as a settings snapshot substitute.

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

Because SUB preserves FIFO ordering within a Socket Box route, the correlated `response` is sent only after VPM has queued the replay messages. `available: true` therefore means that VPM possessed or successfully bootstrapped a valid authoritative state and issued its restoration sequence; it does not create a second aggregate Status Bar protocol method.

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

`disconnecting` announces an intentional, graceful departure **before** the sender or SUB closes the relevant WebSocket. It allows the receiving client to update connection state immediately instead of waiting for heartbeat timeout. It is a best-effort event and normally uses `expectsResponse: false`.

`disconnecting` does not replace heartbeat/ping. Crashes, network failures, power loss, or any failure where the event cannot be emitted continue to be detected by heartbeat.

For a client-originated intentional disconnect, `reason` is currently `user`. On receipt from the opposite application Socket Box, VP/VPM SHOULD immediately treat that peer as unavailable and expose the normal warning / bridge-only state. It MUST NOT wait for heartbeat timeout.

Before intentionally closing client sockets because SUB itself is stopping, SUB SHOULD send `disconnecting` independently to every admitted connection. In that case `reason` MUST be one of `shutdown`, `restart`, or `exit`. On receipt, clients SHOULD immediately enter their server-unavailable/warning state without waiting for heartbeat timeout. Their existing reconnect logic remains active.

When SUB removes an admitted connection because another authenticated client explicitly selected it during replacement negotiation, SUB MUST first send that exact connection a `disconnecting` event with `reason: "replaced"` and then close that connection's WebSocket. `replaced` means only that this particular Socket Box connection was intentionally displaced to free capacity. It does not prohibit that client from reconnecting later; any subsequent reconnect is a new admission attempt and follows the same normal admission rules.

When SUB closes a negotiating connection because its negotiation timeout expired, SUB SHOULD first send that connection `disconnecting` with `reason: "negotiationTimeout"` and then close the WebSocket.

When connectivity returns, no new reconnect event is required. Existing WebSocket reconnect, server `ping`, Socket Box state discovery, heartbeat interval acquisition, Status Bar synchronization, and other existing initialization mechanisms continue exactly as before.

## progress

`progress` reports that work for a previous request is still in progress. `correlationId` is required and progress does not terminate the request.

## response

`response` is the terminal successful response to a request. `correlationId` MUST equal the original message's `id`. A simple acknowledgement MAY use `result: { "success": true }` only for requests whose specific method/event contract does not define a more specific result. Setting-changing calls and `getSettingsSnapshot` use the deterministic result schemas defined above.

## error

`error` is the terminal unsuccessful response. Recommended common codes include `INVALID_MESSAGE`, `INVALID_ROUTING`, `UNKNOWN_METHOD`, `UNKNOWN_ARGUMENT`, `INVALID_ARGUMENT`, `COMMAND_FAILED`, `SUPERSEDED`, `UNSUPPORTED_PROTOCOL`, `TIMEOUT`, `CONNECTION_NEGOTIATION_IN_PROGRESS`, `CONNECTION_NOT_FOUND`, and `AMBIGUOUS_RECIPIENT`.

## Buffered queue policy

When a destination Socket Box is unavailable, SUB MAY retain application messages in that Socket Box queue subject to its configured TTL. VPP distinguishes two queue policies for such **stored, not-yet-delivered** application messages: `fifo` and `replace`.

Queue behavior is expressed as transport metadata in the VPP envelope:

```json
{
  "queue": {
    "policy": "fifo"
  }
}
```

or:

```json
{
  "queue": {
    "policy": "replace",
    "key": "fontSize"
  }
}
```

`queue.policy` is exactly `fifo` or `replace`. For `replace`, `queue.key` is required and MUST be a non-empty stable application-defined string. For `fifo`, `queue.key` MUST be absent. Queue metadata does not change the application method/event arguments and MUST NOT be interpreted by the receiving application as part of `args`.

For backward compatibility, an application message without `queue` metadata is transported as `fifo`. However, a machine-readable application manifest that declares actions for SUM MUST explicitly declare the queue policy for every action that can generate buffered application traffic; the manifest MUST NOT rely on the legacy default. A `replace` action MUST also declare its stable replacement key. SUM copies that declaration into the outgoing VPP envelope. SUB MUST NOT infer queue policy from method names, arguments, or application-specific knowledge.

### `fifo`

`fifo` preserves every stored message and its order. Repeated instructions remain distinct operations. This policy is required whenever repetition or ordering has semantic meaning, including relative adjustments and navigation-like commands. For example, three stored `goNext` calls remain three calls; three stored `adjustFontSize(+5)` calls remain three relative adjustments.

### `replace` — last write wins while queued

`replace` means that only the newest still-undelivered message for the same replacement identity needs to remain in the destination queue. When a new `replace` message is stored, SUB searches only the same origin route, same destination Socket Box/target, and same `queue.key`. Any older **still queued and not yet delivered** replace message with that identity is superseded and removed, and the new message becomes the queued value.

A `replace` operation MUST NOT retract, cancel, or rewrite a message that has already been delivered to the recipient. Replacement is strictly a queue-storage optimization for unavailable recipients. With fan-out/multiple targets, replacement is evaluated independently for each target connection queue.

The newly stored replacement message has its own enqueue time and its own TTL. Replacing an older message MUST NOT inherit the older message's remaining TTL.

The replacement key represents the resulting state, not necessarily the method name. Different absolute actions MAY deliberately share one key if they represent alternative ways to set the same state. Relative/imperative operations MUST NOT share such a replace key merely because they affect the same underlying value.

Examples of suitable semantics are an absolute `setFontSize`, `setMicrophone`, or `setNavigationControls` state update. By contrast `adjustFontSize`, `adjustRecordingDockOpacity`, `goNext`, `goBack`, `markerNext`, `markerBack`, and other operations where each invocation contributes independently use `fifo`. For an action with `on` / `off` / `toggle`, explicit `on` and `off` states are suitable for `replace`, while `toggle` remains `fifo` because repeated toggles have cumulative meaning.

If a stored `replace` message with `expectsResponse: true` is superseded before delivery, the transport MUST NOT leave the original request silently pending. SUB SHOULD generate a correlated terminal `error` back to the original sender with error code `SUPERSEDED` when that sender connection is still routable. The superseded message MUST never later be delivered to the original target. This transport error does not imply that the application command failed at the target; it means that command was intentionally not delivered because a newer queued state replaced it.

System `ping` calls addressed to `server` are outside this mechanism. They are immediate transport-health operations and MUST NOT be buffered, coalesced, or replaced as application queue traffic.

## Server ping

`ping` is a system `call` handled by SUB. It verifies bridge connection and obtains Socket Box state and heartbeat policy. It MUST use the caller's authenticated Socket Box as `from`, `recipient: "server"`, `method: "ping"`, `args: {}`, and `expectsResponse: true`. SUB consumes it locally and MUST NOT forward it.

A Socket Box is considered connected when it has at least one admitted active connection. Pending replacement-negotiation connections do not make a Socket Box connected.

## Socket Box connection admission and replacement negotiation

Connection limits and admission are generic SUB transport mechanisms. They are not VoicePrompter application methods and MUST NOT require SUB to understand application-specific behavior.

Each Socket Box MUST have a SUB transport configuration property `maxConnections`. It is an integer with minimum value `1` and default value `1`, and represents the maximum number of simultaneously admitted active WebSocket connections for that Socket Box. `maxConnections` is not an application setting and MUST NOT be changed through VP/VPM application methods.

A WebSocket that has authenticated but is currently negotiating replacement does not count toward `maxConnections` and MUST NOT receive or send normal application Socket Box traffic until admitted.

### Client connection registration

After successful transport authentication and before normal Socket Box admission, a client MUST identify the connection to SUB with a server `call` named `registerConnection`. The call uses the authenticated Socket Box as `from`, `recipient: "server"`, `expectsResponse: true`, and `args` MAY contain exactly one optional field:

- `hostName` — a non-empty UTF-8/Unicode string identifying the client host. If the client cannot provide a host name it omits this field.

The normal required VPP `source` envelope remains present. SUB SHOULD use a non-empty `source.app`, when available, as the human-readable application/service name for the connection; the service name does not need to be duplicated in `args`.

Example:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "server",
  "method": "registerConnection",
  "args": {
    "hostName": "STUDIO-PC"
  },
  "expectsResponse": true,
  "source": { "app": "Socket Universe Module", "version": "..." },
  "timestamp": "..."
}
```

SUB MUST create and retain an internal connection record containing at least:

- `connectionId` — unique non-empty SUB-generated identifier for this WebSocket connection;
- `socketBox` — the authenticated Socket Box name;
- `hostName` — optional value declared by the client;
- `ip` — the remote IP address observed by SUB for the actual transport connection; the client does not supply this field;
- `service` — optional human-readable application/service name, preferably taken from `source.app`;
- `connectedAt` — SUB-generated timestamp in ISO 8601 format representing when the admitted connection was established.

`connectionId`, `ip`, and `connectedAt` are authoritative SUB-generated metadata. `hostName` and `service` are descriptive metadata only and MUST NOT be used as authorization credentials.

`connectionId` is a technical identifier used to make transport decisions unambiguous. Client UI SHOULD NOT expose it as the primary user-facing identity. For user selection the client SHOULD display human-readable metadata. If `hostName` is available, a recommended presentation is `hostName (ip)`. If `hostName` is absent, empty, or unavailable, the UI MUST display at least the SUB-observed `ip` address so the connection remains human-identifiable.

If the Socket Box has available capacity, SUB admits the connection and returns a correlated `response` whose `result` contains exactly:

```json
{
  "status": "admitted",
  "maxConnections": 2,
  "currentConnections": 1,
  "connection": {
    "connectionId": "019...",
    "socketBox": "bc",
    "hostName": "STUDIO-PC",
    "ip": "192.168.1.25",
    "service": "Socket Universe Module",
    "connectedAt": "2026-09-01T11:34:27.123+02:00"
  }
}
```

Optional `hostName` or `service` fields are omitted when unavailable. `currentConnections` is the number of admitted active connections in that Socket Box after admission, including the newly admitted connection.

### Starting replacement negotiation

If admitting a new authenticated connection would exceed `maxConnections` and no replacement negotiation is currently active for that Socket Box, SUB MAY start one replacement negotiation with that new client. The client becomes the sole **negotiating connection** for that Socket Box. No queue of negotiating clients exists.

For each Socket Box, SUB MUST allow at most one replacement negotiation at a time. While a replacement negotiation is active, every additional connection attempt to the same Socket Box that reaches admission after successful authentication MUST be rejected immediately and unambiguously. SUB MUST return a correlated `error` with code `CONNECTION_NEGOTIATION_IN_PROGRESS` and then close that new WebSocket. Such a rejected client MUST NOT join a waiting queue, MUST NOT receive the current connection roster, and MUST NOT participate in the active negotiation.

The negotiating client receives a correlated successful `response` to `registerConnection` whose `result.status` is `replacementNegotiation` and which includes the current admitted connections:

```json
{
  "status": "replacementNegotiation",
  "maxConnections": 1,
  "currentConnections": 1,
  "expiresAt": "2026-09-01T11:41:00.000+02:00",
  "connections": [
    {
      "connectionId": "019...",
      "socketBox": "bc",
      "hostName": "STUDIO-PC",
      "ip": "192.168.1.25",
      "service": "Socket Universe Module",
      "connectedAt": "2026-09-01T10:41:12.382+02:00"
    }
  ]
}
```

Optional `hostName` or `service` fields are omitted when unavailable. The roster MUST contain only currently admitted connections from the same Socket Box and MUST NOT expose connections from another Socket Box.

While negotiating, the client MUST NOT send or receive normal application traffic for that Socket Box. SUB MAY accept only generic server-level transport operations needed for the negotiation and health handling, including `ping`, `replaceConnection`, and `cancelConnectionNegotiation`.

### Negotiation timeout

Every replacement negotiation MUST have a finite timeout. The duration is a SUB transport configuration and is not an application setting. SUB MUST calculate and return `expiresAt` when the negotiation starts. The original expiration deadline MUST NOT be extended merely because the connection roster changes or because a replacement target disappears.

When the timeout expires before successful admission or explicit cancellation, SUB MUST cancel the negotiation, release the per-Socket-Box negotiation lock immediately, and close the negotiating WebSocket. SUB SHOULD first send `disconnecting` with `reason: "negotiationTimeout"`. Once the lock is released, a later connection attempt may start a new negotiation normally.

### replaceConnection

The negotiating client MAY choose exactly one existing connection to replace by sending a server `call` named `replaceConnection`. The method MUST use `recipient: "server"`, `expectsResponse: true`, and `args` containing exactly:

- `connectionId` — the non-empty technical identifier of the specific admitted connection selected by the user.

Example:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "bc",
  "recipient": "server",
  "method": "replaceConnection",
  "args": {
    "connectionId": "019..."
  },
  "expectsResponse": true,
  "source": { "app": "Socket Universe Module", "version": "..." },
  "timestamp": "..."
}
```

SUB MUST permit `replaceConnection` only for the authenticated negotiating connection that currently owns the replacement negotiation for that same Socket Box. The selected `connectionId` identifies exactly one connection and MUST NOT be substituted with another connection merely because the Socket Box state changed.

The replacement decision and admission MUST be serialized/atomic with respect to admissions for that Socket Box. While SUB processes the decision, no concurrent admission may cause `maxConnections` to be exceeded.

Immediately before acting on the selected ID, SUB MUST re-evaluate the actual current Socket Box state:

- If the selected `connectionId` still identifies an admitted connection, SUB MUST first send that exact client `disconnecting` with `reason: "replaced"`, then close that exact WebSocket and remove that exact connection. SUB MUST NOT disconnect any other connection as a substitute. SUB then admits the negotiating client into the freed capacity, ends the negotiation, and releases the lock.
- If the selected `connectionId` has already disappeared and the Socket Box now has available capacity, SUB MUST NOT disconnect any other connection. It admits the negotiating client directly, ends the negotiation, and releases the lock.
- If the selected `connectionId` has already disappeared but the Socket Box is still at its limit, SUB MUST NOT disconnect another connection automatically. The negotiating client remains negotiating until the original timeout and receives an updated roster so the user can select another specific connection or cancel.

On successful admission, the correlated `response.result` contains exactly:

```json
{
  "status": "admitted",
  "maxConnections": 1,
  "currentConnections": 1,
  "connection": {
    "connectionId": "020...",
    "socketBox": "bc",
    "hostName": "NEW-PC",
    "ip": "192.168.1.30",
    "service": "Socket Universe Module",
    "connectedAt": "2026-09-01T11:40:00.000+02:00"
  }
}
```

If the selected connection disappeared but capacity is still unavailable, the correlated `response.result` uses `status: "replacementNegotiation"`, preserves the original `expiresAt`, and returns the updated `currentConnections` and `connections` roster in the same schema used when negotiation started.

### cancelConnectionNegotiation

The negotiating client MAY cancel its own attempt by sending a server `call` named `cancelConnectionNegotiation` with exactly `args: {}` and `expectsResponse: true`.

SUB MUST release the per-Socket-Box negotiation lock, return a correlated successful response with exactly `result: { "status": "cancelled" }`, and then close the negotiating WebSocket. Cancellation MUST NOT affect any admitted connection.

A client displaced with `reason: "replaced"` MAY subsequently reconnect. Such a reconnect is a completely new authenticated connection and repeats registration and the same admission process; VPP does not impose a special reconnect prohibition or priority rule for previously displaced clients.

## Multi-connection Socket Box routing

A Socket Box can have between zero and `maxConnections` admitted active connections. Routing to a Socket Box MUST therefore be deterministic when more than one connection is active. For SUB traffic, this section applies after the effective recipient Socket Box has been explicitly validated or automatically resolved under **Recipient resolution and SUB routing**.

`targetConnectionId` is optional generic transport metadata in an application message. When present, SUB MUST deliver the message only to that exact active connection, and that connection MUST belong to the effective recipient Socket Box. If the ID is not an active connection of that recipient Socket Box, SUB MUST NOT reroute the message to another connection and SHOULD return `CONNECTION_NOT_FOUND` when a correlated transport error can be delivered to the sender.

When `targetConnectionId` is absent:

- if the recipient Socket Box has exactly one admitted active connection, SUB delivers the message to that connection;
- if it has more than one admitted active connection and the message has `expectsResponse: false`, SUB fans the message out to all currently admitted active connections of that Socket Box;
- if it has more than one admitted active connection and the message has `expectsResponse: true`, SUB MUST NOT choose an arbitrary connection and MUST NOT broadcast the request. SUB MUST return a correlated `error` with code `AMBIGUOUS_RECIPIENT` to the originating connection;
- if it has no admitted active connection, the normal Socket Box queue mode/TTL and per-message queue policy determine whether the message is retained or discarded.

This fan-out rule applies only when no terminal response is expected. It therefore cannot create multiple terminal responses for a single VPP request.

For every live request with `expectsResponse: true` that SUB successfully routes to one concrete destination connection, SUB MUST internally remember the originating `connectionId` together with the request `id` for the lifetime of that request. Correlated `progress`, `response`, and `error` messages returning to the origin Socket Box MUST be delivered only to that originating connection. They MUST NOT be broadcast to other connections of the same Socket Box merely because those connections share the same `from`/`recipient` routing name.

If the originating connection disappears before the terminal reply, SUB MUST NOT redirect that correlated reply to another active connection of the same Socket Box. The technical connection identity is intentionally connection-scoped and does not transfer to a reconnecting client.

A queued message carrying `targetConnectionId` is meaningful only for that exact connection. If that connection is no longer active when delivery is attempted, SUB MUST NOT silently retarget it to another connection.

These rules preserve the VPP invariant that one request with `expectsResponse: true` terminates with at most one application recipient and exactly one terminal `response` or `error` from that request path.

## Heartbeat / idle health check

SUB is authoritative for heartbeat interval. Default is 30000 ms (30 seconds). Clients obtain it after establishing/re-establishing their WebSocket connection. Normal valid traffic from the relevant opposite application Socket Box is proof of life.

After a full interval without peer traffic, the client sends `ping` to `server`. Clients use a fixed 5000 ms (5 seconds) grace period. With default interval, expected health confirmation may therefore take up to 35000 ms (35 seconds).

A valid ping response showing the relevant opposite Socket Box as not connected means SUB alive / peer unavailable. Failure to receive ping response within grace means the SUB connection is unhealthy and client SHOULD reconnect. A received `disconnecting` event is authoritative for an intentional departure and permits immediate state update.

## Connection-state interpretation

Clients SHOULD expose:

- **connected** — SUB WebSocket healthy and the relevant opposite Socket Box has at least one admitted active connection;
- **bridge-only / warning** — SUB healthy but the relevant opposite Socket Box is unavailable, including an announced peer `disconnecting`;
- **disconnected / server unavailable** — SUB unhealthy, server `disconnecting` received, or server ping timed out.

## Mailbox queue storage and TTL

Socket Box queue storage is a transport/server configuration of SUB, not an application action and not a manifest property. Each Socket Box MAY be configured with exactly one queue mode, `OFF`, `MEMORY`, or `PERSISTENT`, and a TTL in whole seconds.

`OFF` means that if the recipient is unavailable, an otherwise routable application message is discarded immediately and no undelivered message is stored.

`MEMORY` means that undelivered messages are retained only in RAM and are subject to TTL. Restarting SUB destroys the in-memory queue.

`PERSISTENT` means that undelivered messages are retained in persistent storage such as SQLite and are subject to the same TTL. Restarting SUB preserves queued messages that have not expired.

TTL is absolute from the instant SUB first accepts the message. The server MUST record an acceptance time equivalent to `receivedAt`; for finite TTL it MAY persist an absolute `expiresAt`. Restarting SUB MUST NOT reset, extend, pause, or otherwise restart TTL.

For `PERSISTENT` queues, startup recovery MUST immediately remove messages whose TTL expired while the server was stopped before attempting normal delivery. A message whose expiration time is less than or equal to the current time is expired and MUST NOT be delivered.

`TTL: 0` means no time-based expiration. In `MEMORY` mode such a message can remain queued until delivery or server restart. In `PERSISTENT` mode it can remain queued across restarts until delivery or explicit queue removal. In `OFF` mode TTL is irrelevant because undelivered messages are not stored.

Queue mode/TTL and per-message queue policy are independent. Queue mode decides whether and where an undelivered message is retained; message policy decides how retained messages relate to other retained messages. If a newer message replaces an older queued message, the newer message keeps its own original `receivedAt` and its own TTL; it does not inherit the older message's age or expiration time.

System `ping` calls addressed to `server` are consumed immediately by the server and are not application Socket Box backlog items governed by these queue settings.

## VPBridge transport rule

SUB authenticates according to transport configuration, performs generic Socket Box connection registration/admission/replacement negotiation, accepts complete syntactically valid JSON, verifies routing envelope fields, resolves an omitted application `recipient` from the authenticated sender Socket Box and routing table when that resolution is unambiguous, validates explicit recipients against the same routing table, routes dynamic Socket Box messages according to the deterministic multi-connection rules and FIFO/buffer rules including generic `targetConnectionId` and `queue` metadata, consumes `server` messages locally, maintains Socket Box connection state, and rejects invalid JSON diagnostically.

Except for routing, explicit server methods, generic connection admission/replacement management, generic correlation routing, generic queue-policy enforcement, and its own transport `disconnecting` events, SUB SHALL NOT interpret application-level methods, marker commands, Status Bar data, application arguments, results, progress data, or application errors.

## Compatibility

A receiver unable to support `protocolVersion` SHOULD return `UNSUPPORTED_PROTOCOL` when a correlated response is possible. Receivers MAY ignore unknown optional metadata fields, but MUST NOT silently accept unknown deterministic method/event arguments. Application versions are diagnostic metadata and do not replace `protocolVersion`.
