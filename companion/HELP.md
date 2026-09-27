# Socket Universe Module (SUM)

SUM connects Bitfocus Companion to applications through Socket Universe Bridge (SUB). Select an application manifest to provide its Companion actions, variables and presets.

## Connection

1. Start SUB and configure its routing for the application you want to control.
2. Add a Socket Universe Module connection in Companion.
3. Select the application's **Manifest** and enter the **IP Address** and **Port** of SUB.
4. Enter the **Socket Box** name assigned to this Companion connection in SUB. It must not be empty.
5. If SUB requires an API key, enter the same key in the connection settings.

The connection uses a WebSocket at `ws://<IP Address>:<Port>/mailbox/<Socket Box>`. The default address is `127.0.0.1` and the default port is `8170`.

The available actions, variables and application settings depend on the selected manifest. After changing the manifest, check the connection status and review your buttons. SUM reconnects automatically when the bridge becomes available again.

For protocol details and troubleshooting, see the [project documentation](https://github.com/Suenee/companion-module-voiceprompter#readme).
