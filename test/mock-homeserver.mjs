// A small in-memory Matrix homeserver for testing Mxcord without a real account.
//
// It implements the parts of the Client-Server API that Mxcord uses, seeded with a few
// DMs, an excluded Discord-bridged room, a group room and a pending invite. The /_mock
// endpoints act as the other users: send messages, edit, redact, invite, change profiles.
//
// Usage: node test/mock-homeserver.mjs [port]   (default 8448)
// Log in as "tester" with password "tester-password".
import { createServer } from "node:http";
import { deflateSync, crc32 } from "node:zlib";

const PORT = Number(process.argv[2] ?? 8448);
const SERVER = "mock.test";
const ME = `@tester:${SERVER}`;
const PASSWORD = "tester-password";

// Seeded history is spread over the last few days; later events use the real time.
let clock = Date.now() - 3 * 86400_000;
let seeding = true;
const tick = () => (clock = seeding ? clock + 60_000 : Math.max(clock + 1, Date.now()));
let eventSeq = 0;
let tokenSeq = 0;
const tokens = new Map();
const accountData = new Map();
const sentLog = [];

const profiles = {
    [ME]: { displayname: "Tester" },
    [`@alice:${SERVER}`]: { displayname: "Alice", avatar_url: `mxc://${SERVER}/alice` },
    [`@bob:${SERVER}`]: { displayname: "Bob" },
    [`@carol:${SERVER}`]: { displayname: "Carol", avatar_url: `mxc://${SERVER}/carol` },
    [`@dave:${SERVER}`]: { displayname: "Dave" },
    [`@discord_123:${SERVER}`]: { displayname: "Bridged Discord user" },
};

// Solid-colour PNGs served as avatar media.
const COLORS = { alice: [0xe9, 0x1e, 0x63], carol: [0x3f, 0x51, 0xb5], alice2: [0x4c, 0xaf, 0x50] };
function png(rgb, size = 96) {
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => rgb[i % 3])]);
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, "ascii");
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0);
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

// Each room keeps its full timeline, its state and per-member membership.
const rooms = new Map();
const invites = new Map();
const timeline = []; // [{ pos, roomId, kind: "join" | "invite" | "leave" }] drives incremental sync.
const waiters = new Set();

function event(roomId, sender, type, content, extra = {}) {
    return { event_id: `$ev${++eventSeq}:${SERVER}`, room_id: roomId, sender, type, content, origin_server_ts: tick(), ...extra };
}

function memberEvent(roomId, sender, target, membership, extra = {}) {
    return event(roomId, sender, "m.room.member", { membership, ...profiles[target], ...extra }, { state_key: target });
}

function createRoom({ name, members, direct = true, encrypted = false }) {
    const roomId = `!room${rooms.size + invites.size + 1}:${SERVER}`;
    const room = { roomId, name, events: [], state: new Map(), members: new Map() };
    rooms.set(roomId, room);
    const creator = members[0];
    append(room, event(roomId, creator, "m.room.create", { creator }, { state_key: "" }), false);
    for (const m of members) append(room, memberEvent(roomId, m, m, "join"), false);
    if (name) append(room, event(roomId, creator, "m.room.name", { name }, { state_key: "" }), false);
    if (encrypted) append(room, event(roomId, creator, "m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2" }, { state_key: "" }), false);
    if (direct) {
        const peer = members.find(m => m !== ME);
        const direct = accountData.get("m.direct") ?? {};
        direct[peer] = [...(direct[peer] ?? []), roomId];
        accountData.set("m.direct", direct);
    }
    return room;
}

function append(room, ev, notify = true) {
    room.events.push(ev);
    if (ev.state_key !== undefined) {
        room.state.set(`${ev.type}|${ev.state_key}`, ev);
        if (ev.type === "m.room.member") room.members.set(ev.state_key, ev.content.membership);
    }
    if (notify) {
        timeline.push({ pos: timeline.length + 1, roomId: room.roomId, kind: "join", event: ev });
        wake();
    }
    return ev;
}

function wake() {
    for (const w of waiters) w();
    waiters.clear();
}

function say(room, sender, body, extra = {}) {
    return append(room, event(room.roomId, sender, "m.room.message", { msgtype: "m.text", body, ...extra }));
}

// Seed data.
const alice = createRoom({ members: [ME, `@alice:${SERVER}`], encrypted: true });
for (let i = 1; i <= 60; i++) {
    append(alice, event(alice.roomId, i % 3 ? `@alice:${SERVER}` : ME, "m.room.message", { msgtype: "m.text", body: `History message ${i}` }), false);
}
const bobRoom = createRoom({ members: [ME, `@bob:${SERVER}`], direct: false });
const bobHello = append(bobRoom, event(bobRoom.roomId, `@bob:${SERVER}`, "m.room.message", { msgtype: "m.text", body: "Hey, it's Bob" }), false);
append(bobRoom, event(bobRoom.roomId, ME, "m.room.message", {
    msgtype: "m.text",
    body: "> <@bob:mock.test> Hey, it's Bob\n\nHi Bob, this is a reply",
    "m.relates_to": { "m.in_reply_to": { event_id: bobHello.event_id } },
}), false);
append(bobRoom, event(bobRoom.roomId, `@bob:${SERVER}`, "m.room.message", { msgtype: "m.emote", body: "waves" }), false);
const bridged = createRoom({ members: [ME, `@discord_123:${SERVER}`] });
append(bridged, event(bridged.roomId, `@discord_123:${SERVER}`, "m.room.message", { msgtype: "m.text", body: "I should not appear" }), false);
const group = createRoom({ name: "Group chat", members: [ME, `@alice:${SERVER}`, `@bob:${SERVER}`], direct: false });
append(group, event(group.roomId, `@bob:${SERVER}`, "m.room.message", { msgtype: "m.text", body: "Group rooms are skipped" }), false);
invite(`@carol:${SERVER}`, "Hi! Carol here, accept my request");
seeding = false;

function invite(from, firstMessage) {
    const room = createRoom({ members: [from], direct: false });
    rooms.delete(room.roomId);
    const inviteEvent = memberEvent(room.roomId, from, ME, "invite", { is_direct: true });
    append(room, inviteEvent, false);
    if (firstMessage) say(room, from, firstMessage), timeline.pop();
    invites.set(room.roomId, room);
    timeline.push({ pos: timeline.length + 1, roomId: room.roomId, kind: "invite" });
    wake();
    return room;
}

const isState = ev => ev.state_key !== undefined;
const stateList = room => [...room.state.values()];

function roomSummary(room) {
    const joined = [...room.members].filter(([, m]) => m === "join").map(([u]) => u);
    const heroes = [...room.members.keys()].filter(u => u !== ME).slice(0, 5);
    return { "m.joined_member_count": joined.length, "m.invited_member_count": [...room.members.values()].filter(m => m === "invite").length, "m.heroes": heroes };
}

function joinedRooms() {
    return [...rooms.values()].filter(r => r.members.get(ME) === "join");
}

function initialSync(limit) {
    const join = {};
    for (const room of joinedRooms()) {
        const messages = room.events;
        const start = Math.max(0, messages.length - limit);
        join[room.roomId] = {
            summary: roomSummary(room),
            state: { events: stateList(room) },
            timeline: { events: messages.slice(start), limited: start > 0, prev_batch: start > 0 ? `b${start}` : undefined },
        };
    }
    const invite = {};
    for (const room of invites.values()) {
        invite[room.roomId] = { invite_state: { events: stateList(room).map(({ type, state_key, content, sender }) => ({ type, state_key, content, sender })) } };
    }
    return {
        next_batch: `s${timeline.length}`,
        account_data: { events: accountData.has("m.direct") ? [{ type: "m.direct", content: accountData.get("m.direct") }] : [] },
        rooms: { join, invite, leave: {} },
    };
}

function incrementalSync(since) {
    const from = Number(since.slice(1));
    const changes = timeline.slice(from);
    const res = { next_batch: `s${timeline.length}`, rooms: { join: {}, invite: {}, leave: {} }, account_data: { events: [] } };
    for (const change of changes) {
        if (change.kind === "account") {
            res.account_data.events = [{ type: "m.direct", content: accountData.get("m.direct") ?? {} }];
        } else if (change.kind === "invite") {
            const room = invites.get(change.roomId);
            if (room) res.rooms.invite[room.roomId] = { invite_state: { events: stateList(room).map(({ type, state_key, content, sender }) => ({ type, state_key, content, sender })) } };
        } else if (change.kind === "leave") {
            res.rooms.leave[change.roomId] = {};
        } else {
            const room = rooms.get(change.roomId);
            if (!room || room.members.get(ME) !== "join") continue;
            const slot = res.rooms.join[room.roomId] ??= { summary: roomSummary(room), state: { events: [] }, timeline: { events: [] } };
            if (change.event) slot.timeline.events.push(change.event);
            if (change.joined) {
                slot.state.events = stateList(room);
                slot.timeline.events = room.events.slice(-20);
                slot.timeline.limited = room.events.length > 20;
                slot.timeline.prev_batch = room.events.length > 20 ? `b${room.events.length - 20}` : undefined;
            }
        }
    }
    return res;
}

function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
    res.end(JSON.stringify(body));
}

const readBody = req => new Promise(resolve => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
});

function findRoom(id) {
    return rooms.get(id) ?? invites.get(id);
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("GET", /^\/_matrix\/client\/versions$/, () => [200, { versions: ["v1.11"] }]);

route("POST", /^\/_matrix\/client\/v3\/login$/, (_m, body) => {
    const user = body.identifier?.user ?? body.user ?? "";
    const qualified = /^@[^:]+:.+$/.test(user);
    if (!qualified && (user.includes(":") || user.startsWith("@"))) return [400, { errcode: "M_INVALID_USERNAME", error: "User ID is malformed" }];
    const local = user.replace(/^@/, "").split(":")[0];
    if (local !== "tester") return [404, { errcode: "M_NOT_FOUND", error: "This account does not exist." }];
    if (body.password !== PASSWORD) return [403, { errcode: "M_FORBIDDEN", error: "Invalid username or password." }];
    const token = `tok${++tokenSeq}`;
    tokens.set(token, { device: `DEV${tokenSeq}`, name: body.initial_device_display_name });
    return [200, { user_id: ME, access_token: token, device_id: `DEV${tokenSeq}` }];
});

route("POST", /^\/_matrix\/client\/v3\/logout$/, (_m, _b, auth) => { tokens.delete(auth); return [200, {}]; });

route("GET", /^\/_matrix\/client\/v3\/sync$/, async (_m, _b, _a, query) => {
    const filter = (() => { try { return JSON.parse(query.get("filter") ?? "{}"); } catch { return {}; } })();
    const since = query.get("since");
    if (!since) return [200, initialSync(filter.room?.timeline?.limit ?? 20)];
    const timeout = Math.min(Number(query.get("timeout") ?? 0), 30000);
    if (Number(since.slice(1)) >= timeline.length && timeout > 0) {
        await new Promise(resolve => {
            const timer = setTimeout(resolve, timeout);
            waiters.add(() => { clearTimeout(timer); resolve(); });
        });
    }
    return [200, incrementalSync(since)];
});

route("GET", /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/messages$/, (m, _b, _a, query) => {
    const room = findRoom(decodeURIComponent(m[1]));
    if (!room || room.members.get(ME) !== "join") return [403, { errcode: "M_FORBIDDEN", error: "Not in room" }];
    const limit = Number(query.get("limit") ?? 10);
    const from = query.get("from");
    const end = from ? Number(from.slice(1)) : room.events.length;
    const start = Math.max(0, end - limit);
    const chunk = room.events.slice(start, end).reverse();
    return [200, { chunk, start: from ?? `b${room.events.length}`, end: start > 0 ? `b${start}` : undefined, state: [] }];
});

route("PUT", /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/, (m, body) => {
    const room = rooms.get(decodeURIComponent(m[1]));
    if (!room || room.members.get(ME) !== "join") return [403, { errcode: "M_FORBIDDEN", error: "Not in room" }];
    const ev = append(room, event(room.roomId, ME, decodeURIComponent(m[2]), body));
    sentLog.push({ roomId: room.roomId, type: ev.type, content: body, event_id: ev.event_id });
    return [200, { event_id: ev.event_id }];
});

route("PUT", /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/redact\/([^/]+)\/([^/]+)$/, (m, body) => {
    const room = rooms.get(decodeURIComponent(m[1]));
    const target = decodeURIComponent(m[2]);
    const ev = append(room, event(room.roomId, ME, "m.room.redaction", body, { redacts: target }));
    sentLog.push({ roomId: room.roomId, type: "m.room.redaction", redacts: target });
    return [200, { event_id: ev.event_id }];
});

route("GET", /^\/_matrix\/client\/v3\/profile\/([^/]+)$/, m => {
    const profile = profiles[decodeURIComponent(m[1])];
    return profile ? [200, profile] : [404, { errcode: "M_NOT_FOUND", error: "Profile not found" }];
});

route("POST", /^\/_matrix\/client\/v3\/createRoom$/, (_m, body) => {
    const peer = body.invite?.[0];
    const room = createRoom({ members: [ME], direct: false, encrypted: true });
    append(room, memberEvent(room.roomId, ME, peer, "invite"), false);
    timeline.push({ pos: timeline.length + 1, roomId: room.roomId, kind: "join", joined: true });
    sentLog.push({ createRoom: body });
    // The invited user accepts a moment later.
    setTimeout(() => {
        append(room, memberEvent(room.roomId, peer, peer, "join"));
    }, 1500);
    return [200, { room_id: room.roomId }];
});

route("GET", /^\/_matrix\/client\/v3\/user\/([^/]+)\/account_data\/([^/]+)$/, m => {
    const type = decodeURIComponent(m[2]);
    return accountData.has(type) ? [200, accountData.get(type)] : [404, { errcode: "M_NOT_FOUND", error: "Account data not found" }];
});

route("PUT", /^\/_matrix\/client\/v3\/user\/([^/]+)\/account_data\/([^/]+)$/, (m, body) => {
    accountData.set(decodeURIComponent(m[2]), body);
    timeline.push({ pos: timeline.length + 1, kind: "account" });
    wake();
    return [200, {}];
});

route("POST", /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/join$/, m => {
    const roomId = decodeURIComponent(m[1]);
    const room = invites.get(roomId);
    if (!room) return [404, { errcode: "M_NOT_FOUND", error: "No invite" }];
    invites.delete(roomId);
    rooms.set(roomId, room);
    append(room, memberEvent(roomId, ME, ME, "join"), false);
    timeline.push({ pos: timeline.length + 1, roomId, kind: "join", joined: true });
    wake();
    sentLog.push({ join: roomId });
    return [200, { room_id: roomId }];
});

route("POST", /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/leave$/, m => {
    const roomId = decodeURIComponent(m[1]);
    invites.delete(roomId);
    const room = rooms.get(roomId);
    if (room) append(room, memberEvent(roomId, ME, ME, "leave"), false);
    timeline.push({ pos: timeline.length + 1, roomId, kind: "leave" });
    wake();
    sentLog.push({ leave: roomId });
    return [200, {}];
});

route("GET", /^\/_matrix\/client\/v1\/media\/download\/([^/]+)\/([^/]+)$/, m => {
    const color = COLORS[decodeURIComponent(m[2])];
    return color ? ["png", png(color)] : [404, { errcode: "M_NOT_FOUND", error: "Media not found" }];
});

// Test controls.
const named = name => `@${name}:${SERVER}`;
const roomWith = name => [...rooms.values()].find(r => r.members.has(named(name)) && r.members.size === 2);

route("POST", /^\/_mock\/say$/, (_m, body) => {
    const room = roomWith(body.from);
    const ev = say(room, named(body.from), body.body);
    return [200, { event_id: ev.event_id, room_id: room.roomId }];
});
route("POST", /^\/_mock\/edit$/, (_m, body) => {
    const room = roomWith(body.from);
    const ev = append(room, event(room.roomId, named(body.from), "m.room.message", {
        msgtype: "m.text", body: `* ${body.body}`,
        "m.new_content": { msgtype: "m.text", body: body.body },
        "m.relates_to": { rel_type: "m.replace", event_id: body.event_id },
    }));
    return [200, { event_id: ev.event_id }];
});
route("POST", /^\/_mock\/redact$/, (_m, body) => {
    const room = roomWith(body.from);
    append(room, event(room.roomId, named(body.from), "m.room.redaction", {}, { redacts: body.event_id }));
    return [200, {}];
});
route("POST", /^\/_mock\/invite$/, (_m, body) => [200, { room_id: invite(named(body.from), body.body).roomId }]);
route("POST", /^\/_mock\/profile$/, (_m, body) => {
    const user = named(body.user);
    Object.assign(profiles[user], body.profile);
    for (const room of rooms.values()) {
        if (room.members.get(user) === "join") append(room, memberEvent(room.roomId, user, user, "join"));
    }
    return [200, {}];
});
route("GET", /^\/_mock\/state$/, () => [200, {
    sent: sentLog,
    rooms: [...rooms.values()].map(r => ({ roomId: r.roomId, members: Object.fromEntries(r.members), events: r.events.length })),
    invites: [...invites.keys()],
    direct: accountData.get("m.direct"),
    sessions: [...tokens.values()],
}]);

createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const body = await readBody(req);
    const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    for (const { method, pattern, handler } of routes) {
        const match = req.method === method && pattern.exec(url.pathname);
        if (!match) continue;
        const open = url.pathname.startsWith("/_mock") || /\/(login|versions)$/.test(url.pathname);
        if (!open && !tokens.has(auth)) return json(res, 401, { errcode: "M_UNKNOWN_TOKEN", error: "Unknown token" });
        const [status, payload] = await handler(match, body, auth, url.searchParams);
        if (status === "png") {
            res.writeHead(200, { "Content-Type": "image/png", "Content-Length": payload.length });
            return res.end(payload);
        }
        return json(res, status, payload);
    }
    json(res, 404, { errcode: "M_UNRECOGNIZED", error: "Unrecognized request" });
}).listen(PORT, "127.0.0.1", () => console.log(`Mock homeserver on http://127.0.0.1:${PORT} (user ${ME}, password ${PASSWORD})`));
