# Socket Universe Module for Bitfocus Companion

`companion-module-voiceprompter` connects Bitfocus Companion to applications through Socket Universe Bridge (SUB). VoicePrompter is one of the supported application manifests.

The module uses the VoicePrompter Protocol (VPP) JSON envelope for bidirectional communication.

## Features

- Bidirectional WebSocket communication through SUB
- Configurable SUB IP address, port and Socket Box
- Optional API key
- Navigation actions for VoicePrompter
- Marker-based navigation
- Multiline Companion expression support for numeric offsets
- Preset buttons demonstrating navigation
- VPP parsing into Companion variables
- Diagnostic JSON action for protocol testing
- Automatic reconnect

## Default connection

```text
IP address: 127.0.0.1
Port:       8170
```

The module connects to the configured Socket Box:

```text
ws://<IP>:<PORT>/mailbox/<Socket Box>
```

Select an application manifest and enter its assigned Socket Box. When SUB requires an API key, configure the same key in the module.

## Companion module package

Run `npm run check` and `npm run package` to validate and build an importable Companion `.tgz` package. The build includes the synchronized application manifest cache under `manifests/`, which the runtime reads at startup. Test the packaged connection, including manifest selection and at least one action, before submitting a release.

The current development module ID is `voiceprompter`; coordinate the official repository name and any ID migration with Bitfocus before the first catalog release.

## Installation / development

This repository follows the Bitfocus Companion module naming convention.

Clone or place the repository in your Companion module development location, then install dependencies:

```bat
npm install
```

The current module is JavaScript-based and has no mandatory compile step. `upgrade.cmd` nevertheless checks for a package build script and runs it automatically if one is added in the future.

## Update

Run:

```bat
upgrade.cmd
```

The updater uses GitHub `main` as the source of truth, synchronizes the local working tree, removes obsolete untracked files, installs dependencies and runs a build when the package defines one.

Local modifications to tracked files cause the updater to stop rather than silently overwrite work.

## Protocol

The canonical protocol specification is included as [PROTOCOL.md](PROTOCOL.md).

Important VPP concepts include:

- JSON messages only
- `protocolVersion`
- unique message `id`
- `from` and `recipient` routing
- `type`
- `method` / `event`
- `args`
- `source`
- `timestamp`
- correlated `response`, `progress`, and `error`
- server `ping` and mailbox state

## Actions

### Navigation

VoicePrompter navigation supports commands including:

- Go Start
- Marker Back
- Go Back
- Go Current
- Go Next
- Marker Next
- Go Finish

Commands that use an offset accept signed integer expressions. Start/Finish commands do not require an offset.

### JSON

The temporary JSON action is intended for communication/protocol testing. It can send arbitrary text to VPBridge and is expected to be removed once protocol development no longer requires it.

## Variables

Incoming VPP messages are parsed into Companion variables for practical use in buttons and expressions. The variable model intentionally exposes known deterministic protocol fields rather than an opaque `args` array variable.

## Development documentation

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Related projects

- VoicePrompter: `Suenee/VoicePrompter`
- VoicePrompter Bridge: `Suenee/VoicePrompterBridge`

## License

A repository license has not been selected here yet. Do not assume permission beyond the rights granted by the repository owner.
