# Socket Universe application manifest guide

This document is the authoritative authoring guide for application manifests consumed by Socket Universe Module (SUM). A manifest describes how one VPP-capable application is exposed in Bitfocus Companion through SUM. It does not define transport routing or replace the VoicePrompter Protocol (VPP).

Protocol rules are defined in [`../PROTOCOL.md`](../PROTOCOL.md). When a manifest declares a method, event, state field, queue policy, or synchronization behavior, the corresponding application behavior must remain compatible with VPP.

## Responsibilities

VPP defines the communication contract: message envelope, calls, events, responses, correlation, admission, routing semantics, queue metadata, state synchronization, and transport/application boundaries.

A manifest defines the SUM/Companion projection of that contract: configuration fields, variables, actions, event handling, runtime memory, replays, presets, synchronized settings, and optional dynamic UI data.

Routing is never an application-manifest responsibility. Do not hard-code peer Socket Box names, SUB routes, connection IDs, or routing-table assumptions into a manifest. `sourceApp` is diagnostic/application identity metadata, not a routing destination.

## Ownership and location

The canonical manifest belongs to the application repository that owns the application contract. SUM keeps a synchronized cache under `manifests/`.

The SUM registry is `manifests/manifests-list.json`. Each entry identifies the local cache filename and the canonical raw source URL. The canonical application repository should normally store its manifest as:

```text
manifest/<application-id>.json
```

The cached SUM copy must not become a separate hand-maintained source of truth.

## Top-level structure

A manifest is UTF-8 JSON. Current SUM supports `manifestVersion: 1`.

Recommended top-level order:

```json
{
  "manifestVersion": 1,
  "id": "exampleapp",
  "name": "ExampleApp",
  "version": "1.0.0",
  "description": "ExampleApp profile for Socket Universe Module.",
  "vppVersion": 1,
  "namespace": "example",
  "sourceApp": "SocketUniverseModule",
  "peerLabel": "ExampleApp",
  "configFields": [],
  "variables": [],
  "dynamicVariables": [],
  "settings": {},
  "memory": {},
  "dynamicCollections": {},
  "events": {},
  "replays": {},
  "actions": {},
  "presets": []
}
```

`dynamicCollections` is optional. Manifests that do not use runtime-generated UI lists may omit it.

## Identity fields

`id` is a stable machine identifier for the application profile. Keep it lowercase and do not change it after deployment unless a deliberate migration is being performed.

`name` is the human-readable application name shown by SUM. `version` is the manifest/application-profile version, not the SUM version and not the VPP version.

`vppVersion` declares the VPP protocol version expected by the manifest.

`namespace` is the Companion variable namespace used by the SUM instance for this manifest. Keep it short, stable, and application-specific.

`sourceApp` is the `source.app` identity used by SUM when it sends application traffic for this manifest. It is metadata, not routing information.

`peerLabel` is the human-readable remote application label used in diagnostics.

## Configuration fields

`configFields` adds application-specific settings to the generic SUM connection editor. Generic transport settings such as IP address, port, Socket Box, API key, debug mode, and SUM version belong to SUM itself and must not be duplicated here.

Example:

```json
{
  "type": "number",
  "id": "maxZones",
  "label": "Maximum zones",
  "width": 6,
  "default": 6,
  "min": 1,
  "max": 10,
  "step": 1,
  "required": true
}
```

Use stable English `id` values. Labels and tooltips should describe user-visible meaning, not implementation history.

## Variables

`variables` declares fixed Companion variables.

```json
{
  "id": "current_cname",
  "name": "Current desktop canonical name"
}
```

A variable may also declare a SUM-defined `role` for generic diagnostics and protocol fields. Existing role names should be reused rather than duplicated with application-specific logic.

A variable can define `initial` or `initialFromConfig` where an actual local initial value exists. Do not fabricate remote application state merely to avoid an empty variable. Unknown remote state should remain unknown until authoritative data arrives.

## Dynamic variables

`dynamicVariables` is for a predictable number of variable definitions generated from local configuration, not for arbitrary changing remote collections.

Example:

```json
{
  "idTemplate": "marker_arg{index}",
  "nameTemplate": "Marker argument {index}",
  "countFromConfig": "markerArgVariables"
}
```

Use dynamic collections, described below, when the remote application owns a list whose members can change at runtime.

## Synchronized settings

`settings` maps an application-owned settings snapshot and change event to Companion variables. Use it only for deterministic settings for which the application can report the actual effective value.

Example pattern:

```json
{
  "settings": {
    "snapshotMethod": "getSettingsSnapshot",
    "changedEvent": "settingChanged",
    "values": {
      "fontSize": {
        "variableId": "font_size",
        "type": "integer",
        "min": 20,
        "max": 100
      }
    }
  }
}
```

A setting-changing call should report the effective resulting value rather than merely echoing the requested command. See `PROTOCOL.md` for synchronization rules.

## Runtime memory

`memory` stores SUM-owned runtime state that must survive temporary peer unavailability during the current SUM process lifetime. VoicePrompter Status Bar is the reference example.

Runtime memory must have an explicit owner and lifetime. Do not use SUM memory to guess state that is authoritative in the remote application.

A memory block can define fields and publish selected values to Companion variables. Replays may then reconstruct state after reconnect.

## Events

`events` describes application events accepted by SUM and how they are handled.

A simple event that maps arguments to variables:

```json
{
  "desktopStateChanged": {
    "operation": "mapArgsToVariables",
    "expectsResponse": false,
    "args": {
      "currentCName": { "type": "string" },
      "desktopCount": { "type": "integer" }
    },
    "map": {
      "currentCName": "current_cname",
      "desktopCount": "desktop_count"
    }
  }
}
```

Event schemas should be deterministic. Unknown fields should not be silently accepted when the contract defines an exact argument set.

## Actions

`actions` maps Companion actions to VPP calls or to SUM runtime-memory operations.

Basic call example:

```json
{
  "activate_desktop": {
    "name": "Desktop: Activate",
    "operation": "call",
    "method": "activateDesktop",
    "expectsResponse": true,
    "queue": { "policy": "replace", "key": "desktop.activate" },
    "options": []
  }
}
```

Every non-raw action that can create buffered application traffic must explicitly declare a queue policy. Use `fifo` when repeated operations or ordering have meaning. Use `replace` for absolute state where only the newest still-undelivered value matters. A `replace` action must have a stable `key` or `keyTemplate`.

Do not use `replace` for relative or cumulative commands such as next/previous, increments, decrements, or toggle when repeated execution changes the result.

### Action options

Common option types include `textinput`, `number`, `checkbox`, and `dropdown`. An option that becomes a VPP argument declares `arg` and a parser such as `string`, `integer`, or `enum`.

Static dropdown example:

```json
{
  "type": "dropdown",
  "id": "state",
  "label": "State",
  "default": "toggle",
  "arg": "state",
  "parse": "enum",
  "values": ["on", "off", "toggle"],
  "choices": [
    { "id": "on", "label": "On" },
    { "id": "off", "label": "Off" },
    { "id": "toggle", "label": "Toggle" }
  ]
}
```

## Dynamic collections and dynamic dropdowns

Use a dynamic collection when an authoritative remote application owns a list whose contents can change while SUM is running, for example virtual desktops, scenes, profiles, devices, or other named runtime objects.

The application owns the collection. SUM stores only the latest valid snapshot needed for UI generation. The collection must not be inferred from transport connectivity or from previous commands.

A manifest declares the collection and the event field that supplies its authoritative snapshot. Recommended schema:

```json
{
  "dynamicCollections": {
    "desktops": {
      "event": "desktopStateChanged",
      "path": "desktops",
      "item": {
        "value": "cname",
        "label": "title"
      }
    }
  }
}
```

The corresponding application event carries the actual array as structured JSON data, for example:

```json
{
  "event": "desktopStateChanged",
  "args": {
    "desktops": [
      { "cname": "WORK", "title": "Work", "position": 1 },
      { "cname": "VIDEO", "title": "Video", "position": 2 }
    ]
  }
}
```

Prefer native JSON arrays/objects for data that SUM must interpret. A JSON-encoded string such as `desktopsJson` is useful as a raw diagnostic/Companion variable, but should not be the primary machine-readable source for a dynamic dropdown.

An action option references the collection with `choicesFrom`:

```json
{
  "type": "dropdown",
  "id": "cname",
  "label": "Desktop",
  "default": "",
  "arg": "cname",
  "parse": "string",
  "choicesFrom": "desktops",
  "value": "cname",
  "labelFrom": "title"
}
```

`choicesFrom` identifies a declared `dynamicCollections` entry. `value`/`valueFrom` identifies the stable value stored in the Companion action. `labelFrom` identifies the user-visible label. If the collection declaration already supplies `item.value` and `item.label`, the option may omit the corresponding overrides.

The stored action value should use a stable application identifier such as `cname`, not a mutable array position. If a previously stored value later disappears from the current collection, SUM must not silently substitute a different item. The saved value remains the saved value and the UI should represent it as unavailable/missing until the user chooses a valid replacement.

When a valid collection snapshot changes, SUM should regenerate the affected Companion action definitions so open/new action editors receive the current choices. The change must not alter existing saved action values automatically.

### Required initial publication

A dynamic collection is not initialized merely because SUB and the two Socket Boxes are connected.

After every new admission/reconnect in which the receiving peer may have lost runtime knowledge, the authoritative application **MUST publish the complete current collection snapshot** without waiting for the collection to change and without requiring the user to execute a first command. This is the same general initialization principle used by VoicePrompter Status Bar synchronization.

The startup snapshot must contain the application's real current data. An empty array is valid only when the authoritative collection is actually empty. SUM must keep the collection in an uninitialized state until a valid authoritative snapshot is received.

After initialization, the normal update mode is event-driven/on-change: publish a new authoritative snapshot whenever a change affects the collection or any field used by SUM for its stable values or labels. Do not poll or resend unchanged collections periodically unless the application contract explicitly requires it.

An application may additionally expose an explicit sync request when a peer needs to force resynchronization. Such a request complements, but does not replace, the mandatory initial publication after a new usable connection.

See `PROTOCOL.md` sections on authoritative application state and dynamic authoritative data for the transport-level rules.

## Replays

`replays` defines deterministic sequences used to restore SUM-owned runtime memory to a peer. Replays should use existing normal calls rather than inventing a second aggregate protocol operation unless the application contract genuinely requires one.

Replay order matters. Every replay call must declare its queue behavior consistently with the underlying operation.

## Presets

`presets` contains optional Companion button presets. A preset is convenience UI only; it must not introduce protocol behavior that is absent from the manifest's actions/events.

## Naming conventions

Use stable machine IDs in English. Prefer lowercase `snake_case` for manifest IDs, variable IDs, and action IDs where a new identifier is being introduced, while preserving already-deployed IDs for compatibility. Protocol method/event names follow the owning application contract and may use the established camelCase style.

Human-readable names should be short and consistent. Group related actions with a common prefix such as `Desktop:`, `Navigation:`, or `Status Bar:`.

## Versioning

Increase the manifest `version` when its public SUM projection changes: actions, options, event schemas, variables, dynamic collections, settings mappings, or semantics.

Changing `manifestVersion` means changing the SUM manifest format itself and requires corresponding SUM support. Changing `vppVersion` means the application contract requires another VPP version. These version numbers are independent.

## Validation checklist

Before publishing a manifest, verify that its JSON parses; identity fields are non-empty and stable; `vppVersion` matches the application; every action declares deterministic queue semantics; every event schema matches what the application really sends; variable IDs are unique; dynamic UI collections have stable item values; initial authoritative dynamic snapshots are sent after admission/reconnect; no routing assumptions are encoded; and the canonical manifest in the application repository is the source registered by `manifests-list.json`.

A manifest should describe real application behavior. Do not add fields merely because SUM can display them, and do not make SUM invent state that only the application can know.
