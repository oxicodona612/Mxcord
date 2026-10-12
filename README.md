<p align="center"><img src="assets/mxcord-logo.svg" width="96" alt="Mxcord logo"></p>

<h1 align="center">Mxcord</h1>

<p align="center">Matrix direct messages inside Discord, on Android and desktop.</p>

Mxcord adds your one-to-one Matrix conversations to Discord's DM list and lets you read and reply to them in Discord's chat view. It runs as a [Revenge](https://github.com/revenge-mod) plugin on Android and as a [Vencord](https://github.com/Vendicated/Vencord) plugin on desktop. Messages are sent over Matrix to your homeserver; Discord's servers are never involved.

## Installation

### Android (Revenge)

1. In Discord, open **Settings > Revenge > Plugins** and tap **+**.
2. Enter the plugin URL:

   ```
   https://oxicodona612.github.io/Mxcord/
   ```

   Revenge shows a warning for plugins installed from a URL. Confirm to continue.
3. Open the Mxcord settings, enter your homeserver URL, username and password, and tap **Log in**. For encrypted chats, use your [pantalaimon](docs/pantalaimon.md) address instead of the homeserver's.

Revenge checks the URL for updates each time Discord starts.

### Desktop (Vencord)

Vencord only loads third-party plugins in builds made from source, so Mxcord is added to a Vencord checkout and built with it. You need [Git](https://git-scm.com), [Node.js](https://nodejs.org) 18 or later and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/Vendicated/Vencord
git clone https://github.com/oxicodona612/Mxcord
node Mxcord/tools/install-vencord.mjs Vencord
cd Vencord
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

`pnpm inject` asks which Discord installation to patch. Restart Discord, enable **Mxcord** under **Settings > Vencord > Plugins**, and restart once more. Then open the plugin's settings, enter your homeserver URL, username and password, and click **Log in**.

To update, run `git pull` in both folders, then the `install-vencord.mjs`, `pnpm build` steps again and restart Discord.

Something not working? See the [FAQ](docs/faq.md).

## Features

- Matrix DMs appear in the DM list, sorted by activity, with message previews and a Matrix badge.
- Send, reply, edit and delete messages. Older history loads as you scroll.
- End-to-end encrypted rooms are supported through [pantalaimon](docs/pantalaimon.md).
- Avatars and display names are taken from Matrix and kept up to date. Profiles show the Matrix ID.
- Matrix DM invites appear under Message Requests and can be accepted or ignored.
- Start a new DM with **Add by Matrix**: on Android from the Add Friends screen, on desktop from the Vencord toolbox, and in the plugin settings on both.
- Notifications for new messages.
- Rooms bridged from Discord by mautrix-discord are skipped, so Discord DMs are not duplicated.

## Privacy

Mxcord runs on your device and only connects to the homeserver you configure. Bridged chats exist locally: any Discord request that refers to one, such as a read receipt or profile lookup, is handled on the device and not sent to Discord.

Your password is only used to log in. The access token returned by your homeserver is stored locally: in the plugin's storage on Android, and in Discord's IndexedDB on desktop, outside Vencord's settings file, so Vencord's cloud settings sync never uploads it.

## Requirements

- Android: Discord with Revenge or another Vendetta-compatible mod.
- Desktop: Discord with a Vencord build made from source (see above).
- A Matrix account on a homeserver reachable from your device. Stock Discord builds for Android do not allow plain `http://` connections.
- [pantalaimon](docs/pantalaimon.md) for encrypted rooms. Without it, only unencrypted rooms can be read.

## Limitations

- Direct messages only. Group rooms, spaces, calls, reactions and threads are not supported.
- Notifications require Discord to be running, in the foreground or background.
- Messages sent before your pantalaimon session existed cannot be decrypted unless you import your room keys into pantalaimon.
- On Android, the Add Friends entry replaces "Find Your Friends" and relies on Discord's English label.
- Client modifications are against Discord's Terms of Service.

## How it works

Mxcord syncs with your homeserver using the Matrix Client-Server API. Each DM room is added to Discord as a local DM channel with a generated recipient, using IDs that cannot collide with real Discord IDs. Message history is provided by intercepting Discord's message requests, and new Matrix events are delivered as Discord message events.

On desktop, Matrix requests are made from Discord's main process, because Discord's content security policy blocks connections to unknown servers from the app itself.

## Development

```
core/       Matrix sync and the Discord side of the bridge, shared by both clients
mobile/     Revenge plugin: Android UI, patches, avatar files, notifications
desktop/    Vencord plugin: settings panel, patches, main-process requests
site/       Homepage published with the plugin
test/       Mock Matrix homeserver and the Android test harness
tools/      Logo generator, Vencord installer, device verification
```

```sh
npm install
npm test
```

`npm test` builds `dist/` and runs the Android plugin in Node against `test/mock-homeserver.mjs`, an in-memory homeserver seeded with DMs, an invite and a Discord-bridged room. `npm run mock` starts the same server on port 8448 for manual testing; log in as `tester` with the password `tester-password`.

`node build.mjs` writes `dist/index.js` and `dist/manifest.json` for Revenge, and the homepage. The desktop plugin is built by Vencord after `tools/install-vencord.mjs` copies it into the checkout. After editing `assets/mxcord-logo.svg`, run `npm run logo` to update `core/logo.js`.

Pushes to `main` are tested and published to GitHub Pages by `.github/workflows/pages.yml`.

## License

Licensed under the [Apache License 2.0](LICENSE). Redistributions must retain the [NOTICE](NOTICE) file.
