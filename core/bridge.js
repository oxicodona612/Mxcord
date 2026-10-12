// Shared Mxcord logic: syncs with a Matrix homeserver and presents 1:1 rooms as Discord DMs.
//
// Everything platform specific is supplied by the host:
//   dispatch(action)                 FluxDispatcher.dispatch
//   getCurrentUser()                 UserStore.getCurrentUser()
//   getChannel(id)                   ChannelStore.getChannel(id)
//   createChannelRecord(raw)         channel record from API data, for CHANNEL_CREATE
//   openChannel(channelId)           navigate to a DM
//   request(method, url, { headers, body })  -> { status, json }
//   avatars.uri(mxc)                 cached avatar URI, or null
//   avatars.load(mxc, url, token)    downloads and caches an avatar
//   notify({ title, body, channelId, messageId, avatar })
//   isViewing(channelId)             whether the user is looking at the channel right now
//   decoratePeer?(user)              adjusts the raw user object for bridged peers
//   reservedIds?                     extra IDs that must never reach Discord's API
//   consentAccepted                  value of Discord's ACCEPTED message request consent status
//   deviceName?                      Matrix device name used at login
//   log                              { error(...), warn(...) }
//   store                            persistent object: homeserver, session, rooms, nextSeq, notifications
export const DISCORD_EPOCH = 1420070400000n;
// Synthetic channel and user IDs use timestamps from before Discord existed, so they
// can never collide with real ones.
const CHANNEL_TS = 1n;
const USER_TS = 2n;
export const DM_CHANNEL_TYPE = 1;
const REPLY_MESSAGE_TYPE = 19;
const SYNC_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 5000;
const HISTORY_PAGE = 50;
export const UNDECRYPTABLE = "Unable to decrypt message";
const EPHEMERAL_FLAG = 1 << 6;
// Discord rebuilds its private channel list on these actions, which drops injected DMs.
export const CHANNEL_RESET_ACTIONS = ["CONNECTION_OPEN", "CONNECTION_OPEN_SUPPLEMENTAL", "CACHE_LOADED", "CACHE_LOADED_LAZY", "OVERLAY_INITIALIZE", "BACKGROUND_SYNC"];
export const WATCHDOG_MS = 5000;

export const snowflake = (timestamp, low) => ((timestamp << 22n) | (BigInt(low) & 0x3fffffn)).toString();

// FNV-1a reduced to the 22 bits below the snowflake timestamp.
export function hash22(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0) & 0x3fffff;
}

// Servers reject half-qualified IDs like "@you" or "you:server" as malformed.
export function loginIdentifier(username) {
    const user = username.trim();
    if (user.includes(":")) return user.startsWith("@") ? user : `@${user}`;
    return user.replace(/^@/, "");
}

export const localpart = mxid => mxid.replace(/^@/, "").split(":")[0];

// Rooms bridged from Discord (mautrix-discord defaults) are skipped so Discord DMs
// aren't mirrored back into Discord. The bridge bot's own room is kept.
const EXCLUDED_PEER = /^@discord_/;
const KEPT_PEER = /^@discordbot:/;
const BRIDGE_STATE_TYPES = new Set(["m.bridge", "uk.half-shot.bridge"]);
// pantalaimon delivers events it can't decrypt as m.room.message with this body.
const PANTALAIMON_UTD = /^\*\* Unable to decrypt:/;
// Invites don't expose messages until joined, so the request shows a local preview line.
const PLACEHOLDER_EVENT = "$mxcord-invite-placeholder";
// After joining a federated room, the earlier history can take a while to arrive,
// so newly joined rooms retry with backoff.
const BACKFILL_RETRY_MS = [3000, 8000, 20000, 45000];

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

export function createBridge(host) {
    const { store, log } = host;
    store.homeserver ??= "";
    store.rooms ??= {};
    store.nextSeq ??= 1;
    store.notifications ??= true;

    const roomByChannel = new Map();
    const fakeIds = new Set();
    const bridgedUsers = new Set();
    const userToRoom = new Map();
    const cache = new Map();
    const statusListeners = new Set();
    const discordBridgedRooms = new Set();
    const profileLookups = new Set();
    const blockedLog = [];
    const debugLog = [];
    let status = "Not logged in";
    let syncAbort = null;
    let directMap = {};
    let watchdog = null;
    for (const id of host.reservedIds ?? []) fakeIds.add(id);

    function debug(text) {
        debugLog.push(`${new Date().toISOString().slice(11, 23)} ${text}`);
        if (debugLog.length > 200) debugLog.shift();
    }
    const shortId = roomId => roomId.slice(0, 8);

    function setStatus(text) {
        status = text;
        for (const listener of statusListeners) listener(text);
    }

    const channelIdFor = seq => snowflake(CHANNEL_TS, seq);
    const userIdFor = seq => snowflake(USER_TS, seq);
    const messageIdFor = (ts, eventId) => snowflake(BigInt(ts) - DISCORD_EPOCH, hash22(eventId));
    const baseUrl = () => store.homeserver.replace(/\/+$/, "");

    async function api(method, path, { body, query, auth = true, signal } = {}) {
        const qs = Object.entries(query ?? {})
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
        const url = `${baseUrl()}/_matrix/client/v3${path}${qs ? `?${qs}` : ""}`;
        const headers = { "Content-Type": "application/json" };
        if (auth) headers.Authorization = `Bearer ${store.session?.accessToken}`;
        const { status: code, json } = await host.request(method, url, { headers, body: body && JSON.stringify(body), signal });
        if (code < 200 || code >= 300) {
            const error = new Error(`${method} ${path}: ${code} ${json?.errcode ?? ""} ${json?.error ?? ""}`.trim());
            error.status = code;
            error.errcode = json?.errcode;
            throw error;
        }
        return json ?? {};
    }

    const encodeRoom = roomId => encodeURIComponent(roomId);
    const txnId = () => `mxcord${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    async function login(username, password) {
        if (!/^https?:\/\/.+/.test(store.homeserver)) throw new Error("Enter your homeserver URL first");
        const res = await api("POST", "/login", {
            auth: false,
            body: {
                type: "m.login.password",
                identifier: { type: "m.id.user", user: loginIdentifier(username) },
                password,
                initial_device_display_name: host.deviceName ?? "Discord (Mxcord)",
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
            log.warn("Matrix logout failed", error);
        }
        delete store.session;
        removeAllChannels();
        setStatus("Not logged in");
    }

    function roomEntry(roomId, peer) {
        let entry = store.rooms[roomId];
        if (!entry) {
            store.rooms[roomId] = { seq: store.nextSeq++, peer, name: "", lastMessageId: "" };
            entry = store.rooms[roomId];
        }
        if (peer) entry.peer = peer;
        return entry;
    }

    function rawPeerUser(roomId) {
        const entry = store.rooms[roomId];
        const member = cache.get(roomId)?.members.get(entry.peer);
        const name = member?.displayname || entry.name || localpart(entry.peer);
        const user = {
            id: userIdFor(entry.seq),
            username: localpart(entry.peer).toLowerCase().replace(/[^a-z0-9_.]/g, "_").slice(0, 32) || "matrix",
            global_name: name,
            avatar: avatarUriFor(entry) ? `mx${hash22(entry.avatarMxc)}` : null,
            discriminator: "0",
            public_flags: 0,
            flags: 0,
            bot: false,
        };
        return host.decoratePeer ? host.decoratePeer(user) : user;
    }

    function rawSelfUser() {
        const me = host.getCurrentUser();
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
        const peerId = channel.recipients[0].id;
        roomByChannel.set(channel.id, roomId);
        fakeIds.add(channel.id);
        fakeIds.add(peerId);
        bridgedUsers.add(peerId);
        userToRoom.set(peerId, roomId);
        const record = host.createChannelRecord(channel);
        if (host.getChannel(channel.id)) {
            host.dispatch({ type: "CHANNEL_UPDATES", channels: [record] });
        } else {
            debug(`create ${shortId(roomId)} ${channel.recipients[0].global_name} request=${channel.is_message_request} last=${channel.last_message_id}`);
            host.dispatch({ type: "CHANNEL_CREATE", channel: record });
        }
        return channel.id;
    }

    function removeAllChannels() {
        for (const [channelId] of roomByChannel) {
            host.dispatch({ type: "CHANNEL_DELETE", channel: { id: channelId, type: DM_CHANNEL_TYPE, guild_id: null } });
        }
        roomByChannel.clear();
        fakeIds.clear();
        for (const id of host.reservedIds ?? []) fakeIds.add(id);
        bridgedUsers.clear();
        userToRoom.clear();
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
            if (live) host.dispatch({ type: "MESSAGE_DELETE", id: msgId, channelId });
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
                host.dispatch({ type: "MESSAGE_UPDATE", message: upgraded });
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
            if (live) host.dispatch({ type: "MESSAGE_UPDATE", message: edited });
            return;
        }

        const raw = toRawMessage(roomId, event, channelId);
        rememberMessage(roomId, event.event_id, raw);
        if (live) {
            // Discord's handlers modify the dispatched message, so the notification is built first.
            const notification = event.sender !== store.session?.userId && event.origin_server_ts >= (c.quietBefore ?? 0)
                ? messageNotification(roomId, raw)
                : null;
            host.dispatch({ type: "MESSAGE_CREATE", channelId, guildId: null, message: raw, optimistic: false, isPushNotification: false });
            if (notification) host.notify(notification);
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
                host.dispatch({ type: "CHANNEL_DELETE", channel: { id: channelId, type: DM_CHANNEL_TYPE, guild_id: null } });
            }
            roomByChannel.delete(channelId);
            fakeIds.delete(channelId);
            fakeIds.delete(userIdFor(entry.seq));
            bridgedUsers.delete(userIdFor(entry.seq));
            userToRoom.delete(userIdFor(entry.seq));
            delete store.rooms[roomId];
        }
        cache.delete(roomId);
    }

    function processSync(res, initial) {
        const r = res.rooms ?? {};
        const n = o => Object.keys(o ?? {}).length;
        if (initial || n(r.invite) || n(r.leave)) debug(`sync initial=${initial} join=${n(r.join)} invite=${n(r.invite)} leave=${n(r.leave)}`);
        for (const [roomId, room] of Object.entries(r.invite ?? {})) processInvite(roomId, room, !initial);
        for (const roomId of Object.keys(r.leave ?? {})) {
            if (store.rooms[roomId]) removeRoom(roomId);
        }
        for (const event of res.account_data?.events ?? []) {
            if (event.type === "m.direct") directMap = event.content ?? {};
        }
        for (const [roomId, room] of Object.entries(r.join ?? {})) {
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

    async function syncLoop(signal) {
        let since = null;
        while (!signal.aborted) {
            try {
                const res = await api("GET", "/sync", {
                    query: { filter: SYNC_FILTER, since, timeout: since ? SYNC_TIMEOUT_MS : 0 },
                    signal,
                });
                if (signal.aborted) return;
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
                log.error("Matrix sync failed", error);
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
                log.error("Matrix backfill failed", error);
                retry();
            });
    }

    const newestFirst = messages => [...messages].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

    function preloadChannel(roomId) {
        const channelId = channelIdFor(store.rooms[roomId].seq);
        const c = roomCache(roomId);
        const newest = newestFirst(c.messages.values());
        if (!newest.length) return;
        host.dispatch({
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

    async function fetchMessages(options) {
        const channelId = options.channelId;
        const roomId = roomByChannel.get(channelId);
        const limit = options.limit ?? HISTORY_PAGE;
        const before = options.before ? BigInt(options.before) : null;
        const c = roomCache(roomId);
        let pool = newestFirst(c.messages.values()).filter(m => before == null || BigInt(m.id) < before);
        if (pool.length < limit && c.prevBatch) {
            try {
                await paginateBack(roomId);
            } catch (error) {
                log.error("Matrix history fetch failed", error);
            }
            pool = newestFirst(c.messages.values()).filter(m => before == null || BigInt(m.id) < before);
        }
        host.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId,
            messages: pool.slice(0, limit),
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

    async function sendMessage(channelId, text, replyToMsgId) {
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
        host.dispatch({ type: "MESSAGE_CREATE", channelId, guildId: null, message: raw, optimistic: false, isPushNotification: false });
        ensureChannel(roomId);
        return raw;
    }

    async function editMessage(channelId, messageId, text) {
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

    async function deleteMessage(channelId, messageId) {
        const roomId = roomByChannel.get(channelId);
        const eventId = roomCache(roomId).msgToEvent.get(messageId);
        if (!eventId) throw new Error("unknown message");
        await api("PUT", `/rooms/${encodeRoom(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId()}`, { body: {} });
    }

    function homeserverName() {
        return store.session ? store.session.userId.split(":").slice(1).join(":") : "server";
    }

    function normaliseMxid(input) {
        let mxid = input.trim();
        if (!mxid) throw new Error("Enter a Matrix ID");
        if (!mxid.startsWith("@")) mxid = `@${mxid}`;
        if (!mxid.includes(":")) mxid += `:${homeserverName()}`;
        if (!/^@[^:\s]+:[^\s]+$/.test(mxid)) throw new Error(`"${input}" is not a Matrix ID`);
        return mxid;
    }

    const openRoom = roomId => host.openChannel(channelIdFor(store.rooms[roomId].seq));

    async function openMatrixDm(input) {
        if (!store.session) throw new Error("Log in to Matrix first (Mxcord settings)");
        const mxid = normaliseMxid(input);
        if (mxid === store.session.userId) throw new Error("That's your own account");
        if (EXCLUDED_PEER.test(mxid)) throw new Error("Discord-bridged users are already in your DM list");

        const existing = (directMap[mxid] ?? []).find(roomId => store.rooms[roomId] && cache.has(roomId));
        if (existing) {
            openRoom(existing);
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
        syncPeerProfile(roomId);
        openRoom(roomId);
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
            host.dispatch({ type: "MESSAGE_DELETE", id: placeholder, channelId });
        }
        c.prevBatch = null;
        c.backfillPending = true;
        // The history that arrives with the join is not news.
        c.quietBefore = Date.now();
        await api("POST", `/rooms/${encodeRoom(roomId)}/join`, { body: {} });
        await addToDirect(entry.peer, roomId);
        entry.request = false;
        entry.requestTs = "";
        // A DM without a last message ID can drop out of the list.
        entry.lastMessageId = snowflake(BigInt(Date.now()) - DISCORD_EPOCH, 0);
        ensureChannel(roomId);
        host.dispatch({ type: "MESSAGE_REQUEST_ACCEPT_OPTIMISTIC", channelId });
        if (c.backfillPending) backfill(roomId, true);
    }

    async function rejectRequest(channelId) {
        const roomId = roomByChannel.get(channelId);
        await api("POST", `/rooms/${encodeRoom(roomId)}/leave`, { body: {} });
        removeRoom(roomId);
    }

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
        syncPeerProfile(roomId);
        showInvitePlaceholder(roomId, inviter, entry.requestTs);
        if (live && isNew && store.notifications) {
            const name = c.members.get(inviter)?.displayname || inviter;
            host.notify({
                title: "Message request",
                body: `${name} (${inviter}) wants to chat on Matrix`,
                channelId: channelIdFor(entry.seq),
                avatar: avatarUriFor(entry),
            });
        }
    }

    // Discord's push service never sees Matrix messages, so notifications are posted locally.
    function messageNotification(roomId, raw) {
        if (!store.notifications || host.isViewing(raw.channel_id)) return null;
        return {
            title: raw.author.global_name ?? raw.author.username,
            body: raw.content,
            channelId: raw.channel_id,
            messageId: raw.id,
            avatar: avatarUriFor(store.rooms[roomId]),
        };
    }

    function namesFakeId(value) {
        if (!fakeIds.size || value == null) return false;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return text.split(/[^0-9]+/).some(part => fakeIds.has(part));
    }

    const ok = body => Promise.resolve({ ok: true, status: body ? 200 : 204, body: body ?? null, headers: {} });
    const RECIPIENT_ME = /\/channels\/(\d+)\/recipients\/@me$/;
    const USER_PROFILE = /\/users\/(\d+)\/profile(?:\?|$)/;

    // Profile popouts show the Matrix ID as the bio instead of failing to load.
    function profileFor(roomId) {
        return {
            user: rawPeerUser(roomId),
            user_profile: { bio: `Matrix: ${store.rooms[roomId].peer}`, accent_color: null, pronouns: "" },
            connected_accounts: [],
            badges: [],
            guild_badges: [],
            mutual_guilds: [],
            mutual_friends_count: 0,
            premium_type: 0,
            premium_since: null,
            premium_guild_since: null,
        };
    }

    // Requests that reference a bridged chat are answered locally and never sent to Discord.
    // Message request actions are routed here by URL, since they only call the HTTP API.
    function contain(method, args, original) {
        const first = args[0];
        const url = typeof first === "string" ? first : first?.url;
        const body = typeof first === "object" ? first?.body : args[1]?.body;
        if (typeof url === "string") {
            if (url.includes("/read-states/ack-bulk") && Array.isArray(body?.read_states)) {
                const kept = body.read_states.filter(state => !fakeIds.has(String(state.channel_id)));
                if (kept.length !== body.read_states.length) {
                    if (!kept.length) return ok();
                    body.read_states = kept;
                }
                return original(...args);
            }
            if (url.endsWith("/recipients/@me/batch-reject") && Array.isArray(body?.channel_ids)) {
                const bridged = body.channel_ids.filter(isBridged);
                for (const channelId of bridged) rejectRequest(channelId).catch(error => log.error("Matrix decline failed", error));
                if (!bridged.length) return original(...args);
                body.channel_ids = body.channel_ids.filter(id => !isBridged(id));
                return body.channel_ids.length ? original(...args) : ok();
            }
            const profile = method === "get" && USER_PROFILE.exec(url);
            if (profile && userToRoom.has(profile[1])) return ok(profileFor(userToRoom.get(profile[1])));
            const recipient = RECIPIENT_ME.exec(url);
            if (recipient && isBridged(recipient[1])) {
                if (method === "del") return rejectRequest(recipient[1]).then(() => ok());
                if (method === "put" && body?.consent_status === host.consentAccepted) return acceptRequest(recipient[1]).then(() => ok());
                return ok();
            }
        }
        if (namesFakeId(url) || namesFakeId(body)) {
            blockedLog.push(`${new Date().toISOString()} ${method.toUpperCase()} ${url}`);
            if (blockedLog.length > 50) blockedLog.shift();
            if (method === "get") return Promise.reject({ ok: false, status: 404, body: { code: 10003, message: "Unknown Channel" }, headers: {} });
            return ok();
        }
        return original(...args);
    }

    function reinjectAll(reason) {
        let missing = 0;
        for (const [channelId, roomId] of roomByChannel) {
            if (host.getChannel(channelId)) continue;
            missing++;
            ensureChannel(roomId);
            if (cache.has(roomId)) preloadChannel(roomId);
        }
        if (missing) debug(`reinject ${missing} after ${reason}`);
    }

    const onChannelReset = action => setTimeout(() => reinjectAll(action.type), 0);

    function avatarUriFor(entry) {
        return entry?.avatarMxc ? host.avatars.uri(entry.avatarMxc) : null;
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
        if (!nameChanged && !avatarChanged && (!mxc || host.avatars.uri(mxc))) return;
        entry.appliedName = name;
        entry.avatarMxc = mxc;
        if (nameChanged || avatarChanged) debug(`profile ${shortId(roomId)} name=${name} avatar=${mxc ? "set" : "none"}`);
        const apply = () => {
            const user = rawPeerUser(roomId);
            host.dispatch({ type: "USER_UPDATE", user });
            refreshAuthor(roomId, user);
            ensureChannel(roomId);
        };
        apply();
        if (mxc && !host.avatars.uri(mxc)) {
            const [server, mediaId] = mxc.slice(6).split("/");
            // Thumbnails fail through pantalaimon, so the original is downloaded.
            const url = `${baseUrl()}/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`;
            host.avatars.load(mxc, url, store.session.accessToken)
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

    // Rooms whose avatar file disappeared are refetched.
    function forgetAvatar(mxc) {
        for (const [roomId, entry] of Object.entries(store.rooms)) {
            if (entry.avatarMxc !== mxc) continue;
            entry.avatarMxc = "";
            if (cache.has(roomId)) syncPeerProfile(roomId);
        }
    }

    function isBridged(channelId) {
        return roomByChannel.has(String(channelId));
    }

    // The host subscribes onChannelReset to CHANNEL_RESET_ACTIONS.
    function start() {
        watchdog = setInterval(() => reinjectAll("watchdog"), WATCHDOG_MS);
        if (store.session) startSync();
    }

    function stop() {
        clearInterval(watchdog);
        stopSync();
        removeAllChannels();
    }

    return {
        store,
        start,
        stop,
        login,
        logout,
        openMatrixDm,
        homeserverName,
        isBridged,
        isBridgedUser: userId => bridgedUsers.has(userId),
        avatarForUser: userId => {
            const roomId = userToRoom.get(userId);
            return roomId ? avatarUriFor(store.rooms[roomId]) : null;
        },
        fetchMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        acceptRequest,
        rejectRequest,
        contain,
        forgetAvatar,
        onChannelReset,
        status: () => status,
        onStatus(listener) {
            statusListeners.add(listener);
            return () => statusListeners.delete(listener);
        },
        debug: { cache, roomByChannel, fakeIds, blockedLog, debugLog, processSync },
    };
}
