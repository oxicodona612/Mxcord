(() => {
    // Mxcord: shows 1:1 Matrix rooms as Discord DMs.
    // Revenge loads this file as `vendetta => { return <file> }`, so it must start with the IIFE.

    const { metro, patcher, plugin, logger, ui, storage: storageApi } = vendetta;
    const { FluxDispatcher, React, ReactNative } = metro.common;
    const { FormSection, FormInput, FormRow, FormText, FormDivider, FormSwitchRow } = ui.components.Forms;

    const UserStore = metro.findByStoreName("UserStore");
    const ChannelStore = metro.findByStoreName("ChannelStore");
    const MessageActions = metro.findByProps("sendMessage", "fetchMessages");
    // CHANNEL_CREATE expects a ChannelRecord, not raw API data.
    const { createChannelRecordFromServer } = metro.findByProps("createChannelRecordFromServer");
    const HTTP_METHODS = ["get", "post", "put", "patch", "del"];
    const httpModules = [...new Set(metro.findByPropsAll(...HTTP_METHODS))];
    const RowManager = metro.findByName("RowManager");
    const ChannelSelect = metro.findByProps("selectPrivateChannel");
    const JsxRuntime = metro.findByProps("jsx", "jsxs");
    // ui.alerts.showInputAlert depends on an alert component Discord no longer ships.
    const { openAlert, dismissAlert } = metro.findByProps("openAlert", "dismissAlert");
    const { AlertModal, AlertActions, AlertActionButton } = metro.findByProps("AlertModal", "AlertActions");
    const { TextInput } = metro.findByProps("TextInput", "TextArea");
    const GuildTagBadges = metro.findByProps("GuildTagBadge", "BaseGuildTagChiplet");
    const GuildTagUtils = metro.findByProps("getGuildTagBadgeUrl", "getUserPrimaryGuild");
    // @generated-logo-begin
    const LOGO_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAHGElEQVR4nN2aX2zTVRTHzy3tRB1zrBL/IkWjCQlgh74QTTZjeFCJDDURwua6BOaDJpYXTOQBeNBEXugSfaCQbHMjmw+6YRQTiXFLMPiArqBPGKED4x+go2MDdOt2/d5upb92vz+n/d2y1U9y0/P79bbn3HPv7957zv0JKjGBvvbqsRupOjlNQUEyiFvVUlKABIoRSXEhKE5ESUkiJjwUW3KXdzC+uSWJeyVDoGhn2ZFoUErRPC1lPREFUdwQ8wgxIITsvLytNYZrrWhzgOrpa+OTzejJMAkKUCnAKMF/R6oqfZ26RoZAccVMw1PvwLowLqtRbgdJmA5HeNvcOsKVA/zdh5ulnI5ArEaZD5JCeMKJxu2dkItCoBTM/T3tgcnUZLskqqcFABox4PP6Wv7a2hKnAsFvC8PfdbhB0nQ7xPnqdSuSgjwtiabt/ZDZFOSAe7sPHcDMHoa4YMGKEbnSuGMnRBZsB/i7o+1SUojKACGoI9HY2gLREYHiiL8r2ieJGiCWDWhYf6KpdTNEW1DPnnLq+Xw4I0GgWIKej6DnscaXL2hgG0ZCGKIp+N6c2dm+D2LZg9Vhs9XqYOoAtc5PpCaHIFaj/B9IVnh9tWb7BFMHYOh/h6FfTxasWeqnqooKSHO5NjFBP19NQNKPG71o6AAehecg5iBQcvAfiYYQurZDNOWj9XW09bEnIFnT89tZevvkICR96NCLELslsa21gwwIlFvMBDaT5yGaDn3VAwMvvQLJmfqvPrftkULQqDeJSHKlMYDKcUBN18G9uLWHLHj2vgfo6IaNkJyp7eulC9fHILmnEAdsOv4lnfj7T0hWyH0jTW/upVluOcCp9xVcB/RiKL5lMxSL4WM8AlscHgGFswNyR4FASVPTfShMUh6AaImZA3afOkm/GIbcqMNk5AY1Eu4xTIKrcf3+0+shZWE4AK0WO0cad0QgGRzwSfQ8rgJkg5kDWApLRNH2ILM08kbrSkhoMlA5vKlpGoJoS9EKS4QbexZ5qFblGNMOwLofkYwtrxuFpcCNPWh4G/YFYXxi+HdFh/ARRLHFjcJS4NKe2EhTa62Ynf2v4oYjXIW71q6jZ1D31JVLtNiziFbX+PHbB/ENoe4fdHF8nPaf+Sm9TKpJbdeadbZ1rODaYwVWg6WikKCHo/BdNH7X2qcg2TM68S99eu5Xev3Rx+GEO3BnLqrO7lM/UM+5s7iaC8ceO1SQJJw2P0Y4Cr/A96r3dZKvIwPHHnvkPoGER7+UtAlXjnAUlsIBF8bHqLa/F1IuHHvsEIKO4hGIDkiiOlw7wlF4YuOrtKq6BlIuaneoeHF5wDKis6vTNPgNHbs4DCkLxx47BNGg4GyAMnAUDjVsoUcql0DKYgxQ1G7ObF/vVGf/mR/pQ0yKRjj2OBDDHBCVEFhwFJ59rYn8ixdDmuGfqRQ91NMOKcvvW0J0p9cHaYabqRQ93JtbJwZHLjc48tjFOEbBcUhZOPY4UXIHXLp5g1Z9dgRSFk6d/Lnke+h4GbqMcOxxQrsDvn2hgYL+ZZBmiCUu0/Nf90PKwqlTtg7gGK6rDsceJ5QD4kS0AsURjkKO4brqcOxxYFj7MsgxXFcdjj12CLUMlnojZGa4rjoce+wQJDrxCBzcC3EPMeAo5Biuqw7HHnvUVlhzMMQxXFcdjj12pIMh3eEwx3BddTj22JEOh/GpEiIxfDyJYgtHIcdwXXU49thwGgmRYNoBWAkiUlNKrKtuQzqYyaACnPwUua46HHusEMaUmM6kqApkVO+paE6d16leywQ5GXTV4dhjRU5SVIHHIE4OGyKuQpXmUg1QBqtzAjN01OHaY8Iwhn+AQNYBRR6MvJd3MKJ6SxlcCpQz1IjIoA5GPtB1MDK7GsQJjkcxxcwBZjid0hYD53RYwXDAKGb/wJyjMYXTpojrAIUxweEW1fP5CRIrnB1gcTiqcBoFhRgyX6fDDnpzel+R4wCF0wsSnFNasyXLLTr0Or4gkQH7AtsIUfWImqHNULO1rqGfjxu9aOgg1v16ygP35zL7klQMoumjUIaMVnh9QfZLUopCgqSFjgp6CnpNLgMehYhkbJEXMmhgG4Z+GKIp+N4ef9ehDkmyGWLZoRIeiaYdIbLB0QGKQrJGCwVO4xUsByjKaSRwG69gO0BRDnMCGmT7zOeD+oUxuzp00MJbIkcx24esZnsrCnaAQu0TJlOTeCSsN0u3EzRi0Of1hczWeSfw2+KZ3TZHIM7XaBjF9jacv70tBFcOUMwEUBNh/BXKbXPEKKK6SFVlRcQY2BSDawdkSDvieiqEpEoYlytQSsEwkhmRqru9HW4bnkGbA4yoHOP0NIUk0gLEyDY7cBpGDng81KFyeLjWCv67tKiRMTY+VS9pKiiECJKkajgmQHNHybAgipOgpJQSycpFsSWViwZ09bQV/wEiL97wCODX4AAAAABJRU5ErkJggg==";
    // @generated-logo-end
    const LOGO_URI = `data:image/png;base64,${LOGO_PNG_B64}`;

    // Synthetic channel and user IDs use timestamps from before Discord existed, so they
    // can never collide with real ones.
    const DISCORD_EPOCH = 1420070400000n;
    const CHANNEL_TS = 1n;
    const USER_TS = 2n;
    // Bridged users get a guild tag pointing here so the DM list reserves a badge slot.
    const MATRIX_TAG_GUILD_ID = String((3n << 22n) | 1n);
    const LOGO_SIZE_DP = 18;
    const LOGO_LINE_SP = 18;
    const DM_CHANNEL_TYPE = 1;
    const REPLY_MESSAGE_TYPE = 19;
    const SYNC_TIMEOUT_MS = 30000;
    const RETRY_DELAY_MS = 5000;
    const HISTORY_PAGE = 50;
    const HOMESERVER_PLACEHOLDER = "https://matrix.example.com";
    const UNDECRYPTABLE = "Unable to decrypt message";
    const EPHEMERAL_FLAG = 1 << 6;

    const store = plugin.storage;
    store.homeserver ??= "";
    // Revenge storage can't hold null: unset values are deleted keys or empty strings.
    store.rooms ??= {};
    store.nextSeq ??= 1;
    store.notifications ??= true;
    store.avatarFiles ??= {};

    const roomByChannel = new Map();
    const fakeIds = new Set();
    const bridgedUsers = new Set();
    const userToRoom = new Map();
    const cache = new Map();
    const statusListeners = new Set();
    const blockedLog = [];
    const debugLog = [];
    function debug(text) {
        debugLog.push(`${new Date().toISOString().slice(11, 23)} ${text}`);
        if (debugLog.length > 200) debugLog.shift();
    }
    const shortId = roomId => roomId.slice(0, 8);
    let status = "Not logged in";
    let syncAbort = null;
    let directMap = {};
    const unpatches = [];

    function setStatus(text) {
        status = text;
        for (const listener of statusListeners) listener();
    }

    const snowflake = (timestamp, low) => ((timestamp << 22n) | (BigInt(low) & 0x3fffffn)).toString();
    const channelIdFor = seq => snowflake(CHANNEL_TS, seq);
    const userIdFor = seq => snowflake(USER_TS, seq);

    // FNV-1a reduced to the 22 bits below the snowflake timestamp.
    function hash22(text) {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
        return (h >>> 0) & 0x3fffff;
    }
    const messageIdFor = (ts, eventId) => snowflake(BigInt(ts) - DISCORD_EPOCH, hash22(eventId));

    async function api(method, path, { body, query, signal, auth = true } = {}) {
        // React Native's URL polyfill has no searchParams.set.
        const qs = Object.entries(query ?? {})
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
        const url = store.homeserver.replace(/\/+$/, "") + "/_matrix/client/v3" + path + (qs ? `?${qs}` : "");
        const headers = { "Content-Type": "application/json" };
        if (auth) headers.Authorization = `Bearer ${store.session?.accessToken}`;
        const res = await fetch(url, { method, headers, body: body && JSON.stringify(body), signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = new Error(`${method} ${path}: ${res.status} ${json.errcode ?? ""} ${json.error ?? ""}`.trim());
            error.status = res.status;
            error.errcode = json.errcode;
            throw error;
        }
        return json;
    }

    const encodeRoom = roomId => encodeURIComponent(roomId);
    const txnId = () => `mxcord${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    async function login(username, password) {
        if (!/^https?:\/\/.+/.test(store.homeserver)) throw new Error("Enter your homeserver URL first");
        // Servers reject half-qualified IDs like "@you" or "you:server" as malformed.
        let user = username.trim();
        if (user.includes(":")) {
            if (!user.startsWith("@")) user = `@${user}`;
        } else {
            user = user.replace(/^@/, "");
        }
        const res = await api("POST", "/login", {
            auth: false,
            body: {
                type: "m.login.password",
                identifier: { type: "m.id.user", user },
                password,
                initial_device_display_name: "Discord (Mxcord)",
            },
        });
        store.session = { accessToken: res.access_token, userId: res.user_id, deviceId: res.device_id };
        startSync();
    }

    async function logout() {
        stopSync();
        try {
            await api("POST", "/logout", { body: {} });
        } catch (error) {
            logger.warn("Matrix logout failed", error);
        }
        delete store.session;
        removeAllChannels();
        setStatus("Not logged in");
    }

    function localpart(mxid) {
        return mxid.replace(/^@/, "").split(":")[0];
    }

    function roomEntry(roomId, peer) {
        let entry = store.rooms[roomId];
        if (!entry) {
            entry = store.rooms[roomId] = { seq: store.nextSeq++, peer, name: "", lastMessageId: "" };
        }
        if (peer) entry.peer = peer;
        return entry;
    }

    function rawPeerUser(roomId) {
        const entry = store.rooms[roomId];
        const member = cache.get(roomId)?.members.get(entry.peer);
        const name = member?.displayname || entry.name || localpart(entry.peer);
        return {
            id: userIdFor(entry.seq),
            username: localpart(entry.peer).toLowerCase().replace(/[^a-z0-9_.]/g, "_").slice(0, 32) || "matrix",
            global_name: name,
            avatar: avatarUriFor(entry) ? `mx${hash22(entry.avatarMxc)}` : null,
            discriminator: "0",
            public_flags: 0,
            flags: 0,
            bot: false,
            primary_guild: { identity_guild_id: MATRIX_TAG_GUILD_ID, identity_enabled: true, tag: "MTRX", badge: "mxcord" },
        };
    }

    function rawSelfUser() {
        const me = UserStore.getCurrentUser();
        return {
            id: me.id,
            username: me.username,
            global_name: me.globalName ?? null,
            avatar: me.avatar,
            discriminator: me.discriminator ?? "0",
            public_flags: me.publicFlags ?? 0,
            flags: me.flags ?? 0,
            bot: false,
        };
    }

    function rawChannel(roomId) {
        const entry = store.rooms[roomId];
        return {
            id: channelIdFor(entry.seq),
            type: DM_CHANNEL_TYPE,
            recipients: [rawPeerUser(roomId)],
            last_message_id: entry.lastMessageId || null,
            flags: 0,
            is_spam: false,
            is_message_request: !!entry.request,
            is_message_request_timestamp: entry.request ? entry.requestTs || new Date().toISOString() : null,
        };
    }

    function ensureChannel(roomId) {
        const channel = rawChannel(roomId);
        roomByChannel.set(channel.id, roomId);
        fakeIds.add(channel.id);
        fakeIds.add(channel.recipients[0].id);
        bridgedUsers.add(channel.recipients[0].id);
        userToRoom.set(channel.recipients[0].id, roomId);
        const record = createChannelRecordFromServer(channel);
        if (ChannelStore.getChannel(channel.id)) {
            FluxDispatcher.dispatch({ type: "CHANNEL_UPDATES", channels: [record] });
        } else {
            debug(`create ${shortId(roomId)} ${channel.recipients[0].global_name} request=${channel.is_message_request} last=${channel.last_message_id}`);
            FluxDispatcher.dispatch({ type: "CHANNEL_CREATE", channel: record });
        }
        return channel.id;
    }

    function removeAllChannels() {
        for (const [channelId] of roomByChannel) {
            FluxDispatcher.dispatch({ type: "CHANNEL_DELETE", channel: { id: channelId, type: DM_CHANNEL_TYPE, guild_id: null } });
        }
        roomByChannel.clear();
        fakeIds.clear();
        fakeIds.add(MATRIX_TAG_GUILD_ID);
        bridgedUsers.clear();
        cache.clear();
    }

    function roomCache(roomId) {
        let c = cache.get(roomId);
        if (!c) {
            c = { messages: new Map(), eventToMsg: new Map(), msgToEvent: new Map(), prevBatch: null, members: new Map() };
            cache.set(roomId, c);
        }
        return c;
    }

    // Discord renders the referenced message itself, so drop the quoted reply fallback.
    function stripReplyFallback(body) {
        const lines = body.split("\n");
        let i = 0;
        while (i < lines.length && lines[i].startsWith(">")) i++;
        if (i > 0 && lines[i] === "") i++;
        return lines.slice(i).join("\n");
    }

    // pantalaimon delivers events it can't decrypt as m.room.message with this body.
    const PANTALAIMON_UTD = /^\*\* Unable to decrypt:/;

    function bodyFor(content) {
        const body = content?.body ?? "";
        if (PANTALAIMON_UTD.test(body)) return UNDECRYPTABLE;
        switch (content?.msgtype) {
            case "m.emote": return `*${body}*`;
            case "m.image": case "m.file": case "m.video": case "m.audio":
                return `[${content.msgtype.slice(2)}] ${body}`;
            default: return body;
        }
    }

    function toRawMessage(roomId, event, channelId) {
        const c = roomCache(roomId);
        const id = messageIdFor(event.origin_server_ts, event.event_id);
        const mine = event.sender === store.session?.userId;
        const content = event.type === "m.room.encrypted" ? null : event.content;
        const replyTo = content?.["m.relates_to"]?.["m.in_reply_to"]?.event_id;
        const referenced = replyTo && c.messages.get(c.eventToMsg.get(replyTo));
        const raw = {
            id,
            channel_id: channelId,
            type: referenced ? REPLY_MESSAGE_TYPE : 0,
            content: content ? (referenced ? stripReplyFallback(bodyFor(content)) : bodyFor(content)) : UNDECRYPTABLE,
            author: mine ? rawSelfUser() : rawPeerUser(roomId),
            timestamp: new Date(event.origin_server_ts).toISOString(),
            edited_timestamp: null,
            attachments: [],
            embeds: [],
            mentions: [],
            mention_roles: [],
            components: [],
            pinned: false,
            mention_everyone: false,
            tts: false,
            flags: 0,
        };
        if (referenced) {
            raw.message_reference = { channel_id: channelId, message_id: referenced.id };
            raw.referenced_message = referenced;
        }
        return raw;
    }

    function rememberMessage(roomId, eventId, raw) {
        const c = roomCache(roomId);
        c.messages.set(raw.id, raw);
        c.eventToMsg.set(eventId, raw.id);
        c.msgToEvent.set(raw.id, eventId);
        const entry = store.rooms[roomId];
        if (!entry.lastMessageId || BigInt(raw.id) > BigInt(entry.lastMessageId)) entry.lastMessageId = raw.id;
    }

    function handleTimelineEvent(roomId, event, live) {
        const channelId = channelIdFor(store.rooms[roomId].seq);
        const c = roomCache(roomId);
        if (event.unsigned?.redacted_because) return;

        if (event.type === "m.room.redaction") {
            const target = event.redacts ?? event.content?.redacts;
            const msgId = target && c.eventToMsg.get(target);
            if (!msgId) return;
            c.messages.delete(msgId);
            if (live) FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: msgId, channelId });
            return;
        }

        if (event.type !== "m.room.message" && event.type !== "m.room.encrypted") return;
        // Already shown. Replace an undecryptable copy once the event can be decrypted.
        if (c.eventToMsg.has(event.event_id)) {
            const msgId = c.eventToMsg.get(event.event_id);
            const known = c.messages.get(msgId);
            if (known?.content === UNDECRYPTABLE && event.type === "m.room.message" && bodyFor(event.content) !== UNDECRYPTABLE) {
                const upgraded = { ...known, content: bodyFor(event.content) };
                c.messages.set(msgId, upgraded);
                FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: upgraded });
            }
            return;
        }

        const relation = event.content?.["m.relates_to"];
        if (relation?.rel_type === "m.replace") {
            const msgId = c.eventToMsg.get(relation.event_id);
            const original = msgId && c.messages.get(msgId);
            if (!original) return;
            const edited = {
                ...original,
                content: bodyFor(event.content["m.new_content"] ?? event.content),
                edited_timestamp: new Date(event.origin_server_ts).toISOString(),
            };
            c.messages.set(msgId, edited);
            c.eventToMsg.set(event.event_id, msgId);
            if (live) FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: edited });
            return;
        }

        const raw = toRawMessage(roomId, event, channelId);
        rememberMessage(roomId, event.event_id, raw);
        if (live) {
            FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId, guildId: null, message: raw, optimistic: false, isPushNotification: false });
            if (event.sender !== store.session?.userId) notify(raw);
        }
    }

    function isDirectRoom(roomId, room) {
        for (const [mxid, rooms] of Object.entries(directMap)) {
            if (rooms.includes(roomId)) return mxid;
        }
        const summary = room.summary ?? {};
        const joined = summary["m.joined_member_count"];
        const heroes = summary["m.heroes"] ?? [];
        const named = [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])]
            .some(e => e.type === "m.room.name" && e.content?.name);
        if (joined === 2 && heroes.length === 1 && !named) return heroes[0];
        return store.rooms[roomId]?.peer ?? null;
    }

    // Rooms bridged from Discord (mautrix-discord defaults) are skipped so Discord DMs
    // aren't mirrored back into Discord. The bridge bot's own room is kept.
    const EXCLUDED_PEER = /^@discord_/;
    const KEPT_PEER = /^@discordbot:/;
    const BRIDGE_STATE_TYPES = new Set(["m.bridge", "uk.half-shot.bridge"]);
    const discordBridgedRooms = new Set();

    function isExcluded(roomId, peer, room) {
        if (KEPT_PEER.test(peer ?? "")) return false;
        const events = [...(room?.state?.events ?? []), ...(room?.timeline?.events ?? [])];
        if (events.some(e => BRIDGE_STATE_TYPES.has(e.type) && e.content?.protocol?.id === "discord")) {
            discordBridgedRooms.add(roomId);
        }
        return discordBridgedRooms.has(roomId) || EXCLUDED_PEER.test(peer ?? "");
    }

    function removeRoom(roomId) {
        const entry = store.rooms[roomId];
        if (entry) {
            debug(`remove ${shortId(roomId)} ${entry.peer}`);
            const channelId = channelIdFor(entry.seq);
            if (roomByChannel.has(channelId)) {
                FluxDispatcher.dispatch({ type: "CHANNEL_DELETE", channel: { id: channelId, type: DM_CHANNEL_TYPE, guild_id: null } });
            }
            roomByChannel.delete(channelId);
            fakeIds.delete(channelId);
            fakeIds.delete(userIdFor(entry.seq));
            bridgedUsers.delete(userIdFor(entry.seq));
            delete store.rooms[roomId];
        }
        cache.delete(roomId);
    }

    function processSync(res, initial) {
        const r = res.rooms ?? {};
        const n = o => Object.keys(o ?? {}).length;
        if (initial || n(r.invite) || n(r.leave)) debug(`sync initial=${initial} join=${n(r.join)} invite=${n(r.invite)} leave=${n(r.leave)}`);
        for (const [roomId, room] of Object.entries(res.rooms?.invite ?? {})) processInvite(roomId, room, !initial);
        for (const roomId of Object.keys(res.rooms?.leave ?? {})) {
            if (store.rooms[roomId]) removeRoom(roomId);
        }
        for (const event of res.account_data?.events ?? []) {
            if (event.type === "m.direct") directMap = event.content ?? {};
        }
        for (const [roomId, room] of Object.entries(res.rooms?.join ?? {})) {
            const peer = isDirectRoom(roomId, room);
            if (!peer) continue;
            if (isExcluded(roomId, peer, room)) {
                removeRoom(roomId);
                continue;
            }
            const firstSight = !cache.has(roomId);
            const entry = roomEntry(roomId, peer);
            entry.request = false;
            entry.requestTs = "";
            const c = roomCache(roomId);
            for (const event of [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])]) {
                if (event.type === "m.room.member" && event.state_key) c.members.set(event.state_key, event.content ?? {});
                if (event.type === "m.room.name") entry.name = event.content?.name ?? "";
            }
            // Some servers omit prev_batch for newly joined rooms; backfill covers that case.
            if (firstSight) c.prevBatch = room.timeline?.prev_batch ?? null;
            ensureChannel(roomId);
            syncPeerProfile(roomId);
            for (const event of room.timeline?.events ?? []) handleTimelineEvent(roomId, event, !initial && !firstSight);
            ensureChannel(roomId);
            if (firstSight) preloadChannel(roomId);
            if ((firstSight && c.messages.size < HISTORY_PAGE) || c.backfillPending) {
                backfill(roomId, c.backfillPending || !initial || c.messages.size === 0);
            }
        }
    }

    const SYNC_FILTER = JSON.stringify({
        presence: { types: [] },
        account_data: { types: ["m.direct"] },
        room: {
            state: { types: ["m.room.member", "m.room.name", "m.bridge", "uk.half-shot.bridge"], lazy_load_members: true },
            timeline: { limit: HISTORY_PAGE, types: ["m.room.message", "m.room.encrypted", "m.room.redaction", "m.room.member", "m.room.name"] },
            ephemeral: { types: [] },
            account_data: { types: [] },
        },
    });

    async function syncLoop(signal) {
        let since = null;
        while (!signal.aborted) {
            try {
                const res = await api("GET", "/sync", {
                    query: { filter: SYNC_FILTER, since, timeout: since ? SYNC_TIMEOUT_MS : 0 },
                    signal,
                });
                processSync(res, since == null);
                since = res.next_batch;
                setStatus(`Connected as ${store.session.userId} (${roomByChannel.size} DMs)`);
            } catch (error) {
                if (signal.aborted) return;
                if (error.errcode === "M_UNKNOWN_TOKEN") {
                    delete store.session;
                    removeAllChannels();
                    setStatus("Session expired. Log in again.");
                    return;
                }
                logger.error("Matrix sync failed", error);
                setStatus(`Sync error: ${error.message} (retrying)`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    function startSync() {
        stopSync();
        if (!store.session) return;
        for (const [roomId, entry] of Object.entries(store.rooms)) {
            if (isExcluded(roomId, entry.peer)) removeRoom(roomId);
            else ensureChannel(roomId);
        }
        syncAbort = new AbortController();
        setStatus("Connecting…");
        syncLoop(syncAbort.signal);
    }

    function stopSync() {
        syncAbort?.abort();
        syncAbort = null;
    }

    // Without a pagination token, start from the latest event (allowed since Matrix 1.3).
    async function paginateBack(roomId, fromLatest = false) {
        const c = roomCache(roomId);
        if (!c.prevBatch && !fromLatest) return;
        const res = await api("GET", `/rooms/${encodeRoom(roomId)}/messages`, {
            query: { dir: "b", from: c.prevBatch ?? undefined, limit: HISTORY_PAGE, filter: JSON.stringify({ lazy_load_members: true }) },
        });
        for (const event of res.state ?? []) {
            if (event.type === "m.room.member" && event.state_key) c.members.set(event.state_key, event.content ?? {});
        }
        // The chunk is newest first; replay oldest first so replies resolve.
        for (const event of [...(res.chunk ?? [])].reverse()) handleTimelineEvent(roomId, event, false);
        c.prevBatch = res.end && res.chunk?.length ? res.end : null;
    }

    // After joining a federated room, the earlier history can take a while to arrive,
    // so newly joined rooms retry with backoff.
    const BACKFILL_RETRY_MS = [3000, 8000, 20000, 45000];

    function backfill(roomId, persistent = false, attempt = 0) {
        const c = roomCache(roomId);
        c.backfillPending = false;
        const before = c.messages.size;
        const locked = () => [...c.messages.values()].some(m => m.content === UNDECRYPTABLE);
        const retry = () => {
            if (!persistent || attempt >= BACKFILL_RETRY_MS.length || !store.rooms[roomId]) return;
            c.prevBatch = null;
            setTimeout(() => backfill(roomId, persistent, attempt + 1), BACKFILL_RETRY_MS[attempt]);
        };
        paginateBack(roomId, !c.prevBatch)
            .then(() => {
                debug(`backfill ${shortId(roomId)} try=${attempt} persistent=${persistent} ${before}->${c.messages.size} locked=${locked()}`);
                ensureChannel(roomId);
                preloadChannel(roomId);
                if (c.messages.size === before || locked()) retry();
            })
            .catch(error => {
                debug(`backfill ${shortId(roomId)} try=${attempt} error ${error.message}`);
                logger.error("Matrix backfill failed", error);
                retry();
            });
    }

    function preloadChannel(roomId) {
        const channelId = channelIdFor(store.rooms[roomId].seq);
        const c = roomCache(roomId);
        const newest = [...c.messages.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        if (!newest.length) return;
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId,
            messages: newest.slice(0, HISTORY_PAGE),
            isBefore: false,
            isAfter: false,
            hasMoreBefore: newest.length > HISTORY_PAGE || c.prevBatch != null,
            hasMoreAfter: false,
            limit: HISTORY_PAGE,
            isStale: false,
            truncate: false,
        });
    }

    async function serveHistory(options) {
        const channelId = options.channelId;
        const roomId = roomByChannel.get(channelId);
        const limit = options.limit ?? HISTORY_PAGE;
        const before = options.before ? BigInt(options.before) : null;
        const c = roomCache(roomId);
        const sorted = () => [...c.messages.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        let pool = sorted().filter(m => before == null || BigInt(m.id) < before);
        if (pool.length < limit && c.prevBatch) {
            try {
                await paginateBack(roomId);
            } catch (error) {
                logger.error("Matrix history fetch failed", error);
            }
            pool = sorted().filter(m => before == null || BigInt(m.id) < before);
        }
        const page = pool.slice(0, limit);
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId,
            messages: page,
            isBefore: before != null,
            isAfter: false,
            hasMoreBefore: pool.length > limit || c.prevBatch != null,
            hasMoreAfter: false,
            limit,
            jump: options.jump,
            isStale: false,
            truncate: false,
        });
    }

    async function sendText(channelId, text, replyToMsgId) {
        const roomId = roomByChannel.get(channelId);
        const c = roomCache(roomId);
        const content = { msgtype: "m.text", body: text };
        const replyEvent = replyToMsgId && c.msgToEvent.get(replyToMsgId);
        if (replyEvent) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyEvent } };
        const { event_id } = await api("PUT", `/rooms/${encodeRoom(roomId)}/send/m.room.message/${txnId()}`, { body: content });
        // Local echo. The copy that arrives through sync is deduplicated by event ID.
        const event = { event_id, sender: store.session.userId, origin_server_ts: Date.now(), type: "m.room.message", content };
        const raw = toRawMessage(roomId, event, channelId);
        rememberMessage(roomId, event_id, raw);
        FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId, guildId: null, message: raw, optimistic: false, isPushNotification: false });
        ensureChannel(roomId);
    }

    async function editText(channelId, messageId, text) {
        const roomId = roomByChannel.get(channelId);
        const eventId = roomCache(roomId).msgToEvent.get(messageId);
        if (!eventId) throw new Error("unknown message");
        await api("PUT", `/rooms/${encodeRoom(roomId)}/send/m.room.message/${txnId()}`, {
            body: {
                msgtype: "m.text",
                body: `* ${text}`,
                "m.new_content": { msgtype: "m.text", body: text },
                "m.relates_to": { rel_type: "m.replace", event_id: eventId },
            },
        });
    }

    async function redact(channelId, messageId) {
        const roomId = roomByChannel.get(channelId);
        const eventId = roomCache(roomId).msgToEvent.get(messageId);
        if (!eventId) throw new Error("unknown message");
        await api("PUT", `/rooms/${encodeRoom(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId()}`, { body: {} });
    }

    const toast = text => ui.toasts.showToast(text);

    function normaliseMxid(input) {
        let mxid = input.trim();
        if (!mxid) throw new Error("Enter a Matrix ID");
        if (!mxid.startsWith("@")) mxid = `@${mxid}`;
        if (!mxid.includes(":")) mxid += `:${store.session.userId.split(":").slice(1).join(":")}`;
        if (!/^@[^:\s]+:[^\s]+$/.test(mxid)) throw new Error(`"${input}" is not a Matrix ID`);
        return mxid;
    }

    function openChannel(roomId) {
        ChannelSelect.selectPrivateChannel(channelIdFor(store.rooms[roomId].seq));
    }

    async function openMatrixDm(input) {
        if (!store.session) throw new Error("Log in to Matrix first (Mxcord settings)");
        const mxid = normaliseMxid(input);
        if (mxid === store.session.userId) throw new Error("That's your own account");
        if (EXCLUDED_PEER.test(mxid)) throw new Error("Discord-bridged users are already in your DM list");

        const existing = (directMap[mxid] ?? []).find(roomId => store.rooms[roomId] && cache.has(roomId));
        if (existing) {
            openChannel(existing);
            return;
        }

        let profile;
        try {
            profile = await api("GET", `/profile/${encodeURIComponent(mxid)}`);
        } catch (error) {
            if (error.status === 404) throw new Error(`No Matrix user ${mxid}`);
            throw error;
        }

        const { room_id: roomId } = await api("POST", "/createRoom", {
            body: {
                preset: "trusted_private_chat",
                is_direct: true,
                invite: [mxid],
                initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
            },
        });

        await addToDirect(mxid, roomId);

        roomEntry(roomId, mxid);
        roomCache(roomId).members.set(mxid, { displayname: profile.displayname, avatar_url: profile.avatar_url, membership: "invite" });
        ensureChannel(roomId);
        openChannel(roomId);
    }

    async function addToDirect(mxid, roomId) {
        const me = encodeURIComponent(store.session.userId);
        let direct = {};
        try {
            direct = await api("GET", `/user/${me}/account_data/m.direct`);
        } catch (error) {
            if (error.status !== 404) throw error;
        }
        direct[mxid] = [...new Set([...(direct[mxid] ?? []), roomId])];
        await api("PUT", `/user/${me}/account_data/m.direct`, { body: direct });
        directMap = direct;
    }

    async function acceptRequest(channelId) {
        const roomId = roomByChannel.get(channelId);
        const entry = store.rooms[roomId];
        const c = roomCache(roomId);
        // Set up before joining: the sync that carries the join can arrive before this returns.
        const placeholder = c.eventToMsg.get(PLACEHOLDER_EVENT);
        if (placeholder) {
            c.messages.delete(placeholder);
            c.eventToMsg.delete(PLACEHOLDER_EVENT);
            c.msgToEvent.delete(placeholder);
            FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: placeholder, channelId });
        }
        c.prevBatch = null;
        c.backfillPending = true;
        await api("POST", `/rooms/${encodeRoom(roomId)}/join`, { body: {} });
        await addToDirect(entry.peer, roomId);
        entry.request = false;
        entry.requestTs = "";
        ensureChannel(roomId);
        FluxDispatcher.dispatch({ type: "MESSAGE_REQUEST_ACCEPT_OPTIMISTIC", channelId });
        // A DM without a last message ID can drop out of the list.
        entry.lastMessageId = snowflake(BigInt(Date.now()) - DISCORD_EPOCH, 0);
        if (c.backfillPending) backfill(roomId, true);
    }

    async function rejectRequest(channelId) {
        const roomId = roomByChannel.get(channelId);
        await api("POST", `/rooms/${encodeRoom(roomId)}/leave`, { body: {} });
        removeRoom(roomId);
    }

    // Invites don't expose messages until joined, so the request shows a local preview line.
    const PLACEHOLDER_EVENT = "$mxcord-invite-placeholder";

    function showInvitePlaceholder(roomId, inviter, requestTs) {
        const c = roomCache(roomId);
        if (c.eventToMsg.has(PLACEHOLDER_EVENT)) return;
        const name = c.members.get(inviter)?.displayname || inviter;
        const event = {
            event_id: PLACEHOLDER_EVENT,
            sender: inviter,
            origin_server_ts: Date.parse(requestTs) || Date.now(),
            type: "m.room.message",
            content: { msgtype: "m.notice", body: `${name} invited you to chat on Matrix. Accept to read their messages.` },
        };
        const raw = toRawMessage(roomId, event, channelIdFor(store.rooms[roomId].seq));
        // Ephemeral: rendered as local-only, and ignored by message-logging plugins on removal.
        raw.flags = EPHEMERAL_FLAG;
        rememberMessage(roomId, PLACEHOLDER_EVENT, raw);
        ensureChannel(roomId);
        preloadChannel(roomId);
    }

    function processInvite(roomId, room, live) {
        const events = room.invite_state?.events ?? [];
        const mine = events.find(e => e.type === "m.room.member" && e.state_key === store.session.userId);
        if (mine?.content?.membership !== "invite") return;
        const inviter = mine.sender;
        const named = events.some(e => e.type === "m.room.name" && e.content?.name);
        if (!mine.content.is_direct && named) return;
        if (isExcluded(roomId, inviter, { state: { events } })) return;
        const isNew = !store.rooms[roomId]?.request;
        const entry = roomEntry(roomId, inviter);
        entry.request = true;
        entry.requestTs ||= new Date(mine.origin_server_ts ?? Date.now()).toISOString();
        const c = roomCache(roomId);
        for (const event of events) {
            if (event.type === "m.room.member" && event.state_key) c.members.set(event.state_key, event.content ?? {});
        }
        ensureChannel(roomId);
        showInvitePlaceholder(roomId, inviter, entry.requestTs);
        if (live && isNew && store.notifications && PushNotifications?.presentLocalNotification) {
            const name = c.members.get(inviter)?.displayname || inviter;
            PushNotifications.presentLocalNotification({
                alertTitle: "Message request",
                alertBody: `${name} (${inviter}) wants to chat on Matrix`,
                silent: false,
                userInfo: { channel_id: channelIdFor(entry.seq) },
            });
        }
    }

    const ADD_BY_MATRIX_ALERT = "mxcord-add-by-matrix";

    function AddByMatrixAlert() {
        const [value, setValue] = React.useState("");
        const server = store.session ? store.session.userId.split(":").slice(1).join(":") : "server";
        const submit = () => {
            dismissAlert(ADD_BY_MATRIX_ALERT);
            openMatrixDm(value).catch(error => {
                toast(error.message);
                logger.error("Add by Matrix failed", error);
            });
        };
        return h(AlertModal, {
            title: "Add by Matrix",
            content: "Start a DM with a Matrix user.",
            extraContent: h(TextInput, {
                value,
                onChange: setValue,
                placeholder: `@name:${server}`,
                autoFocus: true,
                autoCapitalize: "none",
                autoCorrect: false,
                returnKeyType: "go",
                onSubmitEditing: submit,
            }),
            actions: h(AlertActions, null,
                h(AlertActionButton, { text: "Start chat", variant: "primary", onPress: submit }),
                h(AlertActionButton, { text: "Cancel", variant: "secondary", onPress: () => dismissAlert(ADD_BY_MATRIX_ALERT) })),
        });
    }

    function promptAddByMatrix() {
        openAlert(ADD_BY_MATRIX_ALERT, h(AddByMatrixAlert));
    }

    function namesFakeId(value) {
        if (!fakeIds.size || value == null) return false;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return text.split(/[^0-9]+/).some(part => fakeIds.has(part));
    }

    // Requests that reference a bridged chat are answered locally and never sent to Discord.
    function contain(method, args, original) {
        const first = args[0];
        const url = typeof first === "string" ? first : first?.url;
        const body = typeof first === "object" ? first?.body : args[1]?.body;
        if (typeof url === "string" && url.includes("/read-states/ack-bulk") && Array.isArray(body?.read_states)) {
            const kept = body.read_states.filter(state => !fakeIds.has(String(state.channel_id)));
            if (kept.length !== body.read_states.length) {
                if (!kept.length) return Promise.resolve({ ok: true, status: 204, body: null, headers: {} });
                body.read_states = kept;
            }
            return original(...args);
        }
        if (namesFakeId(url) || namesFakeId(body)) {
            blockedLog.push(`${new Date().toISOString()} ${method.toUpperCase()} ${url}`);
            if (blockedLog.length > 50) blockedLog.shift();
            if (method === "get") {
                const error = { ok: false, status: 404, body: { code: 10003, message: "Unknown Channel" }, headers: {} };
                return Promise.reject(error);
            }
            return Promise.resolve({ ok: true, status: 204, body: null, headers: {} });
        }
        return original(...args);
    }

    const h = React.createElement;

    function Settings() {
        storageApi.useProxy(store);
        const [, rerender] = React.useReducer(x => x + 1, 0);
        const [username, setUsername] = React.useState("");
        const [password, setPassword] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        React.useEffect(() => {
            statusListeners.add(rerender);
            return () => void statusListeners.delete(rerender);
        }, []);

        const doLogin = () => {
            if (busy || !username || !password) return;
            setBusy(true);
            login(username, password)
                .then(() => toast("Logged in to Matrix"))
                .catch(error => toast(`Login failed: ${error.message}`))
                .finally(() => {
                    setPassword("");
                    setBusy(false);
                });
        };

        const session = store.session;
        return h(ReactNative.ScrollView, { style: { flex: 1 } },
            h(FormSection, { title: "Status" }, h(FormText, null, status)),
            h(FormSection, { title: "Notifications" },
                h(FormSwitchRow, {
                    label: "Notify for Matrix messages",
                    subLabel: "Shown while Discord is running, including in the background",
                    value: store.notifications,
                    onValueChange: value => { store.notifications = value; },
                })),
            h(FormSection, { title: "Homeserver" },
                h(FormInput, {
                    title: "URL (pantalaimon for E2EE)",
                    value: store.homeserver,
                    onChange: value => { store.homeserver = value.trim(); },
                    placeholder: HOMESERVER_PLACEHOLDER,
                    autoCapitalize: "none",
                    autoCorrect: false,
                    editable: !session,
                }),
                store.homeserver.startsWith("http://")
                    ? h(FormText, null, "Plain http:// is blocked by stock Discord builds. Use https:// unless your build allows cleartext traffic.")
                    : null),
            session
                ? h(FormSection, { title: "Account" },
                    h(FormRow, { label: session.userId, subLabel: `Device ${session.deviceId}` }),
                    h(FormDivider),
                    h(FormRow, { label: "Add by Matrix", subLabel: "Start a DM with a Matrix user", onPress: promptAddByMatrix }),
                    h(FormDivider),
                    h(FormRow, { label: "Log out", onPress: () => logout().then(() => toast("Logged out of Matrix")) }))
                : h(FormSection, { title: "Log in" },
                    h(FormInput, { title: "Username", value: username, onChange: setUsername, placeholder: "@you:server or you", autoCapitalize: "none", autoCorrect: false }),
                    h(FormInput, { title: "Password", value: password, onChange: setPassword, secureTextEntry: true, autoCapitalize: "none", autoCorrect: false }),
                    h(FormDivider),
                    h(FormRow, { label: busy ? "Logging in…" : "Log in", onPress: doLogin })));
    }

    // Discord rebuilds its private channel list on these actions, which drops injected DMs.
    const CHANNEL_RESET_ACTIONS = ["CONNECTION_OPEN", "CONNECTION_OPEN_SUPPLEMENTAL", "CACHE_LOADED", "CACHE_LOADED_LAZY", "OVERLAY_INITIALIZE", "BACKGROUND_SYNC"];
    const WATCHDOG_MS = 5000;

    function reinjectAll(reason) {
        let missing = 0;
        for (const [channelId, roomId] of roomByChannel) {
            if (ChannelStore.getChannel(channelId)) continue;
            missing++;
            ensureChannel(roomId);
            if (cache.has(roomId)) preloadChannel(roomId);
        }
        if (missing) debug(`reinject ${missing} after ${reason}`);
    }

    function onChannelReset(action) {
        setTimeout(() => reinjectAll(action.type), 0);
    }

    // Discord's push service never sees Matrix messages, so notifications are posted locally.
    const PushNotifications = globalThis.nativeModuleProxy.PushNotificationAndroid;
    const NotificationManager = globalThis.nativeModuleProxy.DCDNotificationManager;
    const SelectedChannelStore = metro.findByStoreName("SelectedChannelStore");

    function notify(raw) {
        if (!store.notifications || !PushNotifications?.presentLocalNotification) return;
        const viewing = ReactNative.AppState.currentState === "active"
            && SelectedChannelStore.getChannelId() === raw.channel_id;
        if (viewing) return;
        const author = raw.author;
        PushNotifications.presentLocalNotification({
            alertTitle: author.global_name ?? author.username,
            alertBody: raw.content,
            silent: false,
            userInfo: { channel_id: raw.channel_id, message_id: raw.id },
        });
    }

    // Read acks for bridged chats are suppressed, so their notifications are cleared here.
    function onChannelSelect(action) {
        if (isBridged(action.channelId)) NotificationManager?.clearNotificationsForChannel?.(action.channelId);
    }

    // Matrix media needs an access token, which image views can't send, so avatars are
    // downloaded once and served from Discord's cache directory.
    const FileModule = globalThis.nativeModuleProxy.NativeFileModule
        ?? globalThis.nativeModuleProxy.RTNFileManager
        ?? globalThis.nativeModuleProxy.DCDFileManager;
    const AVATAR_DIR = "mxcord/avatars";
    // Restored from storage so avatars appear before the first sync.
    const avatarFiles = new Map(Object.entries(store.avatarFiles));
    const avatarFetches = new Set();
    const profileLookups = new Set();

    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function base64Encode(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
            out += B64[n >>> 18] + B64[(n >>> 12) & 63]
                + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=")
                + (i + 2 < bytes.length ? B64[n & 63] : "=");
        }
        return out;
    }

    const avatarPath = mxc => `${AVATAR_DIR}/${mxc.slice(6).replace(/[^A-Za-z0-9._-]/g, "_")}`;

    function rememberAvatar(mxc, uri) {
        avatarFiles.set(mxc, uri);
        store.avatarFiles[mxc] = uri;
    }

    // Android may clear the cache directory between runs.
    async function verifyAvatarFiles() {
        for (const [mxc, uri] of [...avatarFiles]) {
            if (await FileModule.fileExists(uri.replace(/^file:\/\//, ""))) continue;
            avatarFiles.delete(mxc);
            delete store.avatarFiles[mxc];
            debug(`avatar file missing ${mxc.slice(6, 40)}`);
            for (const [roomId, entry] of Object.entries(store.rooms)) {
                if (entry.avatarMxc !== mxc) continue;
                entry.avatarMxc = "";
                if (cache.has(roomId)) syncPeerProfile(roomId);
            }
        }
    }

    function avatarUriFor(entry) {
        return entry?.avatarMxc ? avatarFiles.get(entry.avatarMxc) ?? null : null;
    }

    async function fetchAvatar(mxc) {
        if (avatarFiles.has(mxc) || avatarFetches.has(mxc)) return;
        avatarFetches.add(mxc);
        try {
            const absolute = `${FileModule.getConstants().CacheDirPath}/${avatarPath(mxc)}`;
            if (await FileModule.fileExists(absolute)) {
                rememberAvatar(mxc, `file://${absolute}`);
                return;
            }
            const [server, mediaId] = mxc.slice(6).split("/");
            const base = store.homeserver.replace(/\/+$/, "");
            // Thumbnails fail through pantalaimon, so the original is downloaded.
            const res = await fetch(`${base}/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`, {
                headers: { Authorization: `Bearer ${store.session.accessToken}` },
            });
            if (!res.ok) throw new Error(`avatar ${res.status}`);
            const bytes = new Uint8Array(await res.arrayBuffer());
            const path = await FileModule.writeFile("cache", avatarPath(mxc), base64Encode(bytes), "base64");
            rememberAvatar(mxc, `file://${path}`);
            debug(`avatar ${mxc.slice(6, 40)} ${bytes.length}B`);
        } finally {
            avatarFetches.delete(mxc);
        }
    }

    function syncPeerProfile(roomId) {
        const entry = store.rooms[roomId];
        const member = cache.get(roomId)?.members.get(entry.peer);
        // Members are lazy-loaded; fall back to the global profile.
        if (!member) {
            if (!profileLookups.has(roomId)) {
                profileLookups.add(roomId);
                api("GET", `/profile/${encodeURIComponent(entry.peer)}`)
                    .then(profile => {
                        roomCache(roomId).members.set(entry.peer, { displayname: profile.displayname, avatar_url: profile.avatar_url, membership: "join" });
                        syncPeerProfile(roomId);
                    })
                    .catch(error => debug(`profile ${shortId(roomId)} error ${error.message}`));
            }
            return;
        }
        const name = member.displayname || "";
        const mxc = typeof member.avatar_url === "string" && member.avatar_url.startsWith("mxc://") ? member.avatar_url : "";
        const nameChanged = name !== (entry.appliedName ?? "");
        const avatarChanged = mxc !== (entry.avatarMxc ?? "");
        if (!nameChanged && !avatarChanged && (!mxc || avatarFiles.has(mxc))) return;
        entry.appliedName = name;
        entry.avatarMxc = mxc;
        if (nameChanged || avatarChanged) debug(`profile ${shortId(roomId)} name=${name} avatar=${mxc ? "set" : "none"}`);
        const apply = () => {
            const user = rawPeerUser(roomId);
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            refreshAuthor(roomId, user);
            ensureChannel(roomId);
        };
        apply();
        if (mxc && !avatarFiles.has(mxc)) {
            fetchAvatar(mxc)
                .then(() => { if (store.rooms[roomId]?.avatarMxc === mxc) apply(); })
                .catch(error => debug(`avatar ${shortId(roomId)} error ${error.message}`));
        }
    }

    // Messages hold a copy of their author, so cached messages are updated as well.
    function refreshAuthor(roomId, user) {
        const c = cache.get(roomId);
        if (!c) return;
        let changed = false;
        for (const [id, raw] of c.messages) {
            if (raw.author.id !== user.id) continue;
            c.messages.set(id, { ...raw, author: user });
            changed = true;
        }
        if (changed) preloadChannel(roomId);
    }

    function bridgedAvatar(userId) {
        const roomId = userToRoom.get(userId);
        return roomId ? avatarUriFor(store.rooms[roomId]) : null;
    }

    function renderLogo() {
        return h(ReactNative.Image, {
            source: { uri: LOGO_URI },
            accessibilityLabel: "Matrix",
            style: { width: LOGO_SIZE_DP, height: LOGO_SIZE_DP, marginLeft: 4 },
        });
    }

    // The Add Friends rows are native table cells with a fixed count, so one is replaced
    // instead of adding a new row.
    const FIND_YOUR_FRIENDS = /^Find Your Friends$/;

    function asAddByMatrixRow(props) {
        const { trailing, ...rest } = props;
        return {
            ...rest,
            label: "Add by Matrix",
            icon: h(ReactNative.Image, { source: { uri: LOGO_URI }, style: { width: 24, height: 24 } }),
            arrow: true,
            onPress: promptAddByMatrix,
        };
    }

    // The role icon slot shows the Matrix badge; the guild tag is cleared so it isn't shown twice.
    function decorateRow(row) {
        const message = row?.message;
        if (!message || !bridgedUsers.has(message.authorId)) return;
        const avatar = bridgedAvatar(message.authorId);
        if (avatar) message.avatarURL = avatar;
        message.roleIcon = { name: "Matrix (Mxcord)", alt: "Matrix", source: LOGO_URI, size: LOGO_LINE_SP };
        message.clanTag = null;
        message.clanBadgeUrl = null;
        message.clanTagGuildId = null;
    }

    const isBridged = channelId => roomByChannel.has(channelId);

    return {
        onLoad() {
            try {
                load();
            } catch (error) {
                // Revenge only logs start errors to its own logger.
                console.error("[Mxcord] onLoad failed", String(error?.stack ?? error));
                throw error;
            }
        },
        onUnload() {
            stopSync();
            removeAllChannels();
            for (const unpatch of unpatches.splice(0)) unpatch();
            delete globalThis.__mxcord;
        },
        settings: Settings,
    };

    function load() {
        for (const mod of httpModules) {
            for (const method of HTTP_METHODS) {
                if (typeof mod[method] !== "function") continue;
                unpatches.push(patcher.instead(method, mod, (args, original) => contain(method, args, original)));
            }
        }

        for (const type of CHANNEL_RESET_ACTIONS) {
            FluxDispatcher.subscribe(type, onChannelReset);
            unpatches.push(() => FluxDispatcher.unsubscribe(type, onChannelReset));
        }
        const watchdog = setInterval(() => reinjectAll("watchdog"), WATCHDOG_MS);
        unpatches.push(() => clearInterval(watchdog));
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        unpatches.push(() => FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect));

        fakeIds.add(MATRIX_TAG_GUILD_ID);
        for (const key of ["default", "GuildTagBadge"]) {
            const memo = GuildTagBadges?.[key];
            if (typeof memo?.type !== "function") continue;
            unpatches.push(patcher.instead("type", memo, (args, original) =>
                bridgedUsers.has(args[0]?.userId) ? renderLogo() : original(...args)));
        }
        const UserRecordProto = Object.getPrototypeOf(UserStore.getCurrentUser());
        unpatches.push(patcher.instead("getAvatarURL", UserRecordProto, function (args, original) {
            return bridgedAvatar(this?.id) ?? original.apply(this, args);
        }));
        unpatches.push(patcher.instead("getAvatarSource", UserRecordProto, function (args, original) {
            const uri = bridgedAvatar(this?.id);
            return uri ? { uri } : original.apply(this, args);
        }));
        const AvatarUtils = metro.findByProps("getUserAvatarURL", "getUserAvatarSource");
        unpatches.push(patcher.instead("getUserAvatarURL", AvatarUtils, (args, original) =>
            bridgedAvatar(args[0]?.id) ?? original(...args)));
        unpatches.push(patcher.instead("getUserAvatarSource", AvatarUtils, (args, original) => {
            const uri = bridgedAvatar(args[0]?.id);
            return uri ? { uri } : original(...args);
        }));

        unpatches.push(patcher.instead("getGuildTagBadgeUrl", GuildTagUtils, (args, original) =>
            args[0] === MATRIX_TAG_GUILD_ID ? LOGO_URI : original(...args)));
        unpatches.push(patcher.after("generate", RowManager.prototype, (_args, row) => decorateRow(row)));
        for (const fn of ["jsx", "jsxs"]) {
            unpatches.push(patcher.before(fn, JsxRuntime, args => {
                const label = args[1]?.label;
                if (typeof label === "string" && FIND_YOUR_FRIENDS.test(label)) args[1] = asAddByMatrixRow(args[1]);
            }));
        }

        unpatches.push(patcher.instead("fetchMessages", MessageActions, (args, original) => {
            if (!isBridged(args[0]?.channelId)) return original(...args);
            return serveHistory(args[0]);
        }));
        for (const name of ["fetchLocalMessages", "fetchNewLocalMessages", "_tryFetchMessagesCached"]) {
            if (typeof MessageActions[name] !== "function") continue;
            unpatches.push(patcher.instead(name, MessageActions, (args, original) =>
                isBridged(args[0]?.channelId ?? args[0]) ? Promise.resolve() : original(...args)));
        }

        unpatches.push(patcher.instead("sendMessage", MessageActions, (args, original) => {
            const [channelId, message, , options] = args;
            if (!isBridged(channelId)) return original(...args);
            const replyTo = options?.messageReference?.message_id;
            return sendText(channelId, message?.content ?? "", replyTo)
                .then(() => ({ ok: true }))
                .catch(error => {
                    toast(`Matrix send failed: ${error.message}`);
                    logger.error("Matrix send failed", error);
                });
        }));
        unpatches.push(patcher.instead("editMessage", MessageActions, (args, original) => {
            const [channelId, messageId, message] = args;
            if (!isBridged(channelId)) return original(...args);
            MessageActions.endEditMessage?.(channelId);
            return editText(channelId, messageId, message?.content ?? "").catch(error => toast(`Matrix edit failed: ${error.message}`));
        }));
        const MessageRequestActions = metro.findByProps("acceptMessageRequest", "rejectMessageRequest");
        unpatches.push(patcher.instead("acceptMessageRequest", MessageRequestActions, (args, original) => {
            if (!isBridged(args[0])) return original(...args);
            return acceptRequest(args[0]).catch(error => toast(`Matrix join failed: ${error.message}`));
        }));
        unpatches.push(patcher.instead("rejectMessageRequest", MessageRequestActions, (args, original) => {
            if (!isBridged(args[0])) return original(...args);
            return rejectRequest(args[0]).catch(error => toast(`Matrix decline failed: ${error.message}`));
        }));
        unpatches.push(patcher.instead("rejectMessageRequestBatch", MessageRequestActions, (args, original) => {
            const ids = Array.isArray(args[0]) ? args[0] : [];
            const bridged = ids.filter(isBridged);
            for (const channelId of bridged) rejectRequest(channelId).catch(error => toast(`Matrix decline failed: ${error.message}`));
            const rest = ids.filter(id => !isBridged(id));
            return rest.length ? original(rest, ...args.slice(1)) : Promise.resolve();
        }));

        unpatches.push(patcher.instead("deleteMessage", MessageActions, (args, original) => {
            const [channelId, messageId] = args;
            if (!isBridged(channelId)) return original(...args);
            return redact(channelId, messageId).catch(error => toast(`Matrix delete failed: ${error.message}`));
        }));

        // Exposed for debugging from a JS console.
        globalThis.__mxcord = { store, cache, roomByChannel, fakeIds, processSync, removeAllChannels, blockedLog, debugLog, promptAddByMatrix, notify, status: () => status };
        if (store.session) startSync();
        setTimeout(() => verifyAvatarFiles().catch(error => debug(`avatar verify error ${error.message}`)), 2000);
    }
})()
