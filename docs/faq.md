# FAQ and troubleshooting

## Login

### "User ID is malformed"

```
Login failed: POST /login: 400 M_INVALID_USERNAME User ID is malformed
```

The username was a partial Matrix ID, such as `you:example.com` without the `@`, or `@you` without the server. Enter either the full ID (`@you:example.com`) or just the local part (`you`). Current versions of Mxcord correct partial IDs automatically.

### Login fails with M_FORBIDDEN

The password is wrong, or the account exists on a different homeserver than the one in the URL field. A plain username is always looked up on the configured homeserver.

### "This account does not exist"

The homeserver URL is correct but has no account with that name. Check the spelling, or check that the URL points at the server the account was registered on.

### "Network request failed"

Discord could not reach the URL. Check that:

- the URL opens in the phone's browser (`<url>/_matrix/client/versions` should return JSON);
- it uses `https://`, because stock Discord builds block plain `http://`;
- a LAN address such as `http://192.168.1.2:8009` is only used while the phone is on the same network.

### "Session expired. Log in again."

The access token was revoked, usually because the device was signed out from Element or another client. Log in again from the Mxcord settings.

## Encryption

### Encrypted messages show "Unable to decrypt message", or replies are sent unencrypted

Mxcord is connected directly to the homeserver instead of to pantalaimon. Mxcord does not encrypt or decrypt anything itself; pantalaimon does, and only for clients that connect through it.

The URL in the Mxcord settings must be pantalaimon's address, not your homeserver's:

| | URL |
|---|---|
| Wrong | `https://example.com` (the homeserver) |
| Right | `https://pan.example.com` or `http://192.168.1.2:8009` (pantalaimon) |

To change it, tap **Log out**, enter the pantalaimon URL and log in again. Keep your homeserver's own address for Element and other clients; only Mxcord should go through pantalaimon.

See [pantalaimon.md](pantalaimon.md) for installation. If the homeserver is behind a Cloudflare Tunnel, add a public hostname such as `pan.example.com` with the service `http://localhost:8009`.

### Only older messages fail to decrypt

pantalaimon can only decrypt messages sent after its session was created. Export your room keys from Element and import them into pantalaimon as described in [Older messages](pantalaimon.md#older-messages).

### The device shows as "Unverified" in Element

pantalaimon's device can't be verified from Element, because its encryption library does not support cross-signing. Sign it with your cross-signing key using the script in [Verifying the pantalaimon device](pantalaimon.md#verifying-the-pantalaimon-device):

```
node tools/verify-device.mjs https://example.com
```

The `Discord (Mxcord)` session has no encryption keys and always shows as unverified. That is expected; pantalaimon does the encryption for it.

### pantalaimon logs errors with Conduit, conduwuit or continuwuity

These servers send responses that pantalaimon's library rejects. Apply the patches in [Conduit, conduwuit and continuwuity](pantalaimon.md#conduit-conduwuit-and-continuwuity).

## Chats

### Matrix DMs disappear for a moment

Discord rebuilds its DM list when it reconnects. Mxcord adds the Matrix DMs back within about five seconds. If they stay missing, restart Discord.

### The first message of an invite is missing after accepting

When the invite comes from another homeserver, its history can take a while to arrive. Mxcord keeps checking for it for up to a minute after you accept.

### A Matrix room does not appear

Mxcord only shows one-to-one direct messages. Group rooms and spaces are not shown. Rooms with users bridged from Discord by mautrix-discord (`@discord_<id>`) are skipped on purpose, because the original Discord DM is already in your list.

### "Add by Matrix" is missing from the Add Friends screen

The entry replaces "Find Your Friends" and is found by its English label. With Discord set to another language, use **Add by Matrix** in the Mxcord settings instead.

### Notifications don't arrive

Notifications are only shown while Discord is running, in the foreground or background. If Android stops Discord in the background, no notifications arrive until it is opened again. Excluding Discord from battery optimization helps.

## Updates

### A new version doesn't show up

Revenge checks the plugin URL for updates when Discord starts. Fully close Discord and open it again.
