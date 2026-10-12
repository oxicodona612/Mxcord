<p align="center"><img src="assets/mxcord-logo.svg" width="96" alt="Mxcord logo"></p>

<h1 align="center">Mxcord</h1>

<p align="center">Matrix direct messages inside Discord.</p>

Mxcord is a [Revenge](https://github.com/revenge-mod) plugin for Discord on Android. It adds your one-to-one Matrix conversations to Discord's DM list and lets you read and reply to them in Discord's chat view. Messages are sent over Matrix to your homeserver; Discord's servers are never involved.

## Installation

1. In Discord, open **Settings > Revenge > Plugins** and tap **+**.
2. Enter the plugin URL:

   ```
   https://oxicodona612.github.io/Mxcord/
   ```

   Revenge shows a warning for plugins installed from a URL. Confirm to continue.
3. Open the Mxcord settings, enter your homeserver URL, username and password, and tap **Log in**. For encrypted chats, use your [pantalaimon](docs/pantalaimon.md) address instead of the homeserver's.

Revenge checks the URL for updates each time Discord starts.

Something not working? See the [FAQ](docs/faq.md).

## Features

- Matrix DMs appear in the DM list, sorted by activity, with message previews.
- Send, reply, edit and delete messages. Older history loads as you scroll.
- End-to-end encrypted rooms are supported through [pantalaimon](docs/pantalaimon.md).
- Avatars and display names are taken from Matrix and kept up to date.
- Matrix DM invites appear under Message Requests and can be accepted or ignored.
- Start a new DM with **Add by Matrix**, on the Add Friends screen or in the plugin settings.
- Notifications for new messages.
- Rooms bridged from Discord by mautrix-discord are skipped, so Discord DMs are not duplicated.

## Privacy

Mxcord runs on your device and only connects to the homeserver you configure. Bridged chats exist locally: any Discord request that refers to one, such as a read receipt or profile lookup, is handled on the device and not sent to Discord.

Your password is only used to log in. The access token returned by your homeserver is stored in the plugin's storage.

## Requirements

- Discord for Android with Revenge or another Vendetta-compatible mod.
- A Matrix account on a homeserver reachable from your phone over HTTPS. Stock Discord builds do not allow plain `http://` connections.
- [pantalaimon](docs/pantalaimon.md) for encrypted rooms. Without it, only unencrypted rooms can be read.

## Limitations

- Direct messages only. Group rooms, spaces, calls, reactions and threads are not supported.
- Notifications require Discord to be running, in the foreground or background.
- Messages sent before your pantalaimon session existed cannot be decrypted unless you import your room keys into pantalaimon.
- The Add Friends entry replaces "Find Your Friends" and relies on Discord's English label.
- Client modifications are against Discord's Terms of Service.

## How it works

Mxcord syncs with your homeserver using the Matrix Client-Server API. Each DM room is added to Discord as a local DM channel with a generated recipient, using IDs that cannot collide with real Discord IDs. Message history is provided by intercepting Discord's message requests, and new Matrix events are delivered as Discord message events.

## Building

```sh
node build.mjs
```

This writes `dist/index.js`, `dist/manifest.json` and the homepage from `site/index.html`. After editing `assets/mxcord-logo.svg`, run `npm install` and `npm run logo` to update the embedded icon.

Pushes to `main` are published to GitHub Pages by `.github/workflows/pages.yml`.

## License

Licensed under the [Apache License 2.0](LICENSE). Redistributions must retain the [NOTICE](NOTICE) file.
