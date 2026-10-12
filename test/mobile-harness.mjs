// Runs the built Revenge plugin (dist/index.js) in Node against the mock homeserver, with
// just enough of the Revenge and Discord APIs emulated to exercise every patch.
//
// Usage: npm test   (builds, then runs this against a fresh mock homeserver)
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const MOCK_PORT = 18448;
const MOCK = process.env.MOCK_URL ?? `http://127.0.0.1:${MOCK_PORT}`;
const server = process.env.MOCK_URL ? null : spawn(process.execPath, [fileURLToPath(new URL("mock-homeserver.mjs", import.meta.url)), String(MOCK_PORT)], { stdio: "ignore" });
for (let i = 0; i < 50; i++) {
    if (await fetch(`${MOCK}/_matrix/client/versions`).then(r => r.ok, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
async function step(name, fn) {
    try {
        await fn();
        results.push(`ok   ${name}`);
    } catch (error) {
        results.push(`FAIL ${name}: ${error.message}`);
    }
}

// Discord stand-ins.
const dispatched = [];
const listeners = new Map();
const channels = new Map();
const users = new Map();
const FluxDispatcher = {
    dispatch(action) {
        dispatched.push(action);
        if (action.type === "CHANNEL_CREATE") channels.set(action.channel.id, action.channel);
        if (action.type === "CHANNEL_UPDATES") for (const c of action.channels) channels.set(c.id, c);
        if (action.type === "CHANNEL_DELETE") channels.delete(action.channel.id);
        if (action.type === "USER_UPDATE") users.set(action.user.id, action.user);
        for (const fn of listeners.get(action.type) ?? []) fn(action);
    },
    subscribe: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    unsubscribe: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn)),
};
class UserRecord {
    constructor(data) { Object.assign(this, data); }
    getAvatarURL() { return "discord-default-avatar"; }
    getAvatarSource() { return { uri: "discord-default-avatar" }; }
}
const me = new UserRecord({ id: "100", username: "me", globalName: "Me", avatar: null });
const network = [];
const http = Object.fromEntries(["get", "post", "put", "patch", "del"].map(m => [m, (...args) => {
    network.push(`${m} ${typeof args[0] === "string" ? args[0] : args[0]?.url}`);
    return Promise.resolve({ ok: true, status: 200, body: {} });
}]));
const original = name => (...args) => { network.push(`${name}(${JSON.stringify(args[0])?.slice(0, 60)})`); return Promise.resolve(); };
const MessageActions = Object.fromEntries(["sendMessage", "fetchMessages", "editMessage", "deleteMessage", "fetchLocalMessages"].map(n => [n, original(n)]));
// Closing the edit box is local UI state, not a request.
MessageActions.endEditMessage = () => { };
const MessageRequestActions = Object.fromEntries(["acceptMessageRequest", "rejectMessageRequest", "rejectMessageRequestBatch"].map(n => [n, original(n)]));
class RowManager { generate(row) { return row; } }
let selected = null;
const notifications = [];
const cacheDir = await mkdtemp(join(tmpdir(), "mxcord-"));

const modules = {
    "sendMessage,fetchMessages": MessageActions,
    createChannelRecordFromServer: { createChannelRecordFromServer: raw => ({ ...raw, recipients: raw.recipients.map(u => u.id), rawRecipients: raw.recipients }) },
    selectPrivateChannel: { selectPrivateChannel: id => { selected = id; } },
    "jsx,jsxs": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "openAlert,dismissAlert": { openAlert() { }, dismissAlert() { } },
    "AlertModal,AlertActions": { AlertModal() { }, AlertActions() { }, AlertActionButton() { } },
    "TextInput,TextArea": { TextInput() { } },
    "GuildTagBadge,BaseGuildTagChiplet": { default: { type: () => "tag" } },
    "getGuildTagBadgeUrl,getUserPrimaryGuild": { getGuildTagBadgeUrl: () => "badge-url" },
    "getUserAvatarURL,getUserAvatarSource": { getUserAvatarURL: () => "default-url", getUserAvatarSource: () => ({ uri: "default-url" }) },
    "acceptMessageRequest,rejectMessageRequest": MessageRequestActions,
};
const stores = {
    UserStore: { getCurrentUser: () => me, getUser: id => users.get(id) },
    ChannelStore: { getChannel: id => channels.get(id) },
    SelectedChannelStore: { getChannelId: () => selected },
};

// A patcher with Revenge's semantics.
function patch(kind, name, obj, cb) {
    const orig = obj[name];
    obj[name] = function (...args) {
        if (kind === "instead") return cb.call(this, args, orig.bind(this));
        if (kind === "before") cb.call(this, args);
        const ret = orig.apply(this, args);
        return kind === "after" ? cb.call(this, args, ret) ?? ret : ret;
    };
    return () => { obj[name] = orig; };
}
const patcher = {
    instead: (n, o, cb) => patch("instead", n, o, cb),
    before: (n, o, cb) => patch("before", n, o, cb),
    after: (n, o, cb) => patch("after", n, o, cb),
};

const storage = {};
const toasts = [];
const vendetta = {
    metro: {
        common: { FluxDispatcher, React: { createElement: () => null, useState: v => [v, () => { }], useReducer: () => [0, () => { }], useEffect() { } }, ReactNative: { AppState: { currentState: "background" }, Image() { }, ScrollView() { } } },
        findByStoreName: name => stores[name],
        findByProps: (...props) => modules[props.join(",")] ?? modules[props[0]],
        findByPropsAll: () => [http],
        findByName: name => (name === "RowManager" ? RowManager : undefined),
    },
    patcher,
    plugin: { storage },
    logger: { error() { }, warn() { }, log() { } },
    ui: { components: { Forms: {} }, toasts: { showToast: text => toasts.push(text) } },
    storage: { useProxy() { } },
};
globalThis.nativeModuleProxy = {
    PushNotificationAndroid: { presentLocalNotification: n => notifications.push(n) },
    DCDNotificationManager: { clearNotificationsForChannel() { } },
    NativeFileModule: {
        getConstants: () => ({ CacheDirPath: cacheDir }),
        fileExists: path => stat(path).then(() => true, () => false),
        async writeFile(_where, path, data) {
            const full = join(cacheDir, path);
            await mkdir(dirname(full), { recursive: true });
            await writeFile(full, Buffer.from(data, "base64"));
            return full;
        },
    },
};

const js = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
const plugin = new Function("vendetta", `return ${js}`)(vendetta);
const unpatched = { sendMessage: MessageActions.sendMessage, get: http.get, generate: RowManager.prototype.generate };
const mx = () => globalThis.__mxcord;
const bridgedChannels = () => [...mx().debug.roomByChannel.keys()];
const peerOf = channelId => mx().store.rooms[mx().debug.roomByChannel.get(channelId)]?.peer;
const channelFor = peer => bridgedChannels().find(id => peerOf(id) === peer);
const mock = (path, body) => fetch(`${MOCK}/_mock/${path}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());

await step("plugin loads", async () => {
    assert.deepEqual(Object.keys(plugin), ["onLoad", "onUnload", "settings"]);
    plugin.onLoad();
    assert.ok(mx(), "debug handle missing");
    assert.notEqual(MessageActions.sendMessage, unpatched.sendMessage);
});

await step("login with a partial ID is normalised", async () => {
    storage.homeserver = MOCK;
    await mx().login("tester:mock.test", "tester-password");
    assert.equal(storage.session.userId, "@tester:mock.test");
    await wait(2500);
    assert.match(mx().status(), /Connected as @tester:mock\.test/);
});

await step("1:1 rooms become DMs, bridged and group rooms are skipped", async () => {
    const peers = bridgedChannels().map(peerOf).sort();
    assert.ok(peers.includes("@alice:mock.test") && peers.includes("@bob:mock.test"), peers.join());
    assert.ok(!peers.some(p => p.startsWith("@discord_")), "discord_ peer injected");
    for (const id of bridgedChannels()) assert.ok(channels.has(id), `channel ${id} not in store`);
});

await step("bridged peers carry the Matrix guild tag", async () => {
    const alice = channels.get(channelFor("@alice:mock.test"));
    assert.equal(alice.rawRecipients[0].primary_guild?.tag, "MTRX");
});

await step("avatars are cached to files and served by the patched getters", async () => {
    await wait(1000);
    const alice = channels.get(channelFor("@alice:mock.test"));
    const peerId = alice.recipients[0];
    const url = new UserRecord({ id: peerId }).getAvatarURL();
    assert.match(url, /^file:\/\//);
    assert.ok(await stat(url.slice(7)).then(() => true), "avatar file missing");
    assert.equal(storage.avatarFiles["mxc://mock.test/alice"], url);
    const AvatarUtils = modules["getUserAvatarURL,getUserAvatarSource"];
    assert.equal(AvatarUtils.getUserAvatarSource({ id: peerId }).uri, url);
});

await step("chat rows get the Matrix badge", async () => {
    const alice = channels.get(channelFor("@alice:mock.test"));
    const row = new RowManager().generate({ message: { authorId: alice.recipients[0] } });
    assert.equal(row.message.roleIcon?.name, "Matrix (Mxcord)");
});

await step("Find Your Friends becomes Add by Matrix", async () => {
    const el = modules["jsx,jsxs"].jsx("Row", { label: "Find Your Friends", trailing: 1 });
    assert.equal(el.props.label, "Add by Matrix");
});

await step("history pages through Matrix", async () => {
    const channelId = channelFor("@alice:mock.test");
    dispatched.length = 0;
    await MessageActions.fetchMessages({ channelId, limit: 50 });
    const first = dispatched.find(a => a.type === "LOAD_MESSAGES_SUCCESS");
    const oldest = first.messages.at(-1).id;
    await MessageActions.fetchMessages({ channelId, before: oldest, limit: 50 });
    const second = dispatched.filter(a => a.type === "LOAD_MESSAGES_SUCCESS").at(-1);
    assert.ok(second.messages.some(m => m.content === "History message 1"), "oldest message not loaded");
});

await step("send, reply, edit and delete go to Matrix, not Discord", async () => {
    const channelId = channelFor("@bob:mock.test");
    network.length = 0;
    await MessageActions.sendMessage(channelId, { content: "From the phone" }, true, {});
    const sent = dispatched.filter(a => a.type === "MESSAGE_CREATE").at(-1).message;
    await MessageActions.sendMessage(channelId, { content: "A reply" }, true, { messageReference: { message_id: sent.id } });
    await MessageActions.editMessage(channelId, sent.id, { content: "From the phone, edited" });
    await MessageActions.deleteMessage(channelId, sent.id);
    assert.deepEqual(network, [], `leaked to Discord: ${network.join()}`);
    const state = await fetch(`${MOCK}/_mock/state`).then(r => r.json());
    const mine = state.sent.slice(-4);
    assert.equal(mine[0].content.body, "From the phone");
    assert.ok(mine[1].content["m.relates_to"]?.["m.in_reply_to"], "reply relation missing");
    assert.equal(mine[2].content["m.relates_to"]?.rel_type, "m.replace");
    assert.equal(mine[3].type, "m.room.redaction");
});

await step("Discord API calls naming a bridged chat are contained", async () => {
    const channelId = channelFor("@bob:mock.test");
    network.length = 0;
    await assert.rejects(http.get({ url: `/channels/${channelId}/messages` }));
    await http.post({ url: `/channels/${channelId}/typing` });
    await http.get({ url: "/users/@me" });
    assert.deepEqual(network, ["get /users/@me"]);
    const peer = channels.get(channelId).recipients[0];
    const profile = await http.get({ url: `/users/${peer}/profile` });
    assert.equal(profile.body.user_profile.bio, "Matrix: @bob:mock.test");
});

await step("incoming messages notify by display name", async () => {
    notifications.length = 0;
    await mock("say", { from: "alice", body: "Ping from Alice" });
    await wait(1500);
    const created = dispatched.filter(a => a.type === "MESSAGE_CREATE").at(-1).message;
    assert.equal(created.content, "Ping from Alice");
    assert.equal(notifications.at(-1)?.alertTitle, "Alice");
});

await step("message requests: invite, accept with first message, decline", async () => {
    notifications.length = 0;
    await mock("invite", { from: "dave", body: "Hello from Dave" });
    await wait(1500);
    const dave = channelFor("@dave:mock.test");
    assert.equal(channels.get(dave)?.is_message_request, true);
    assert.equal(notifications.at(-1)?.alertTitle, "Message request");
    await MessageRequestActions.acceptMessageRequest(dave);
    await wait(2500);
    assert.equal(channels.get(dave)?.is_message_request, false);
    await MessageActions.fetchMessages({ channelId: dave, limit: 50 });
    const page = dispatched.filter(a => a.type === "LOAD_MESSAGES_SUCCESS" && a.channelId === dave).at(-1);
    assert.ok(page.messages.some(m => m.content === "Hello from Dave"), "first invite message missing");
    assert.ok(!notifications.some(n => n.alertBody === "Hello from Dave"), "accepted history should not notify");
    await mock("invite", { from: "carol", body: "Another invite" });
    await wait(1500);
    const carol = bridgedChannels().filter(id => peerOf(id) === "@carol:mock.test").find(id => channels.get(id)?.is_message_request);
    await MessageRequestActions.rejectMessageRequest(carol);
    assert.ok(!channels.has(carol), "declined request still listed");
});

await step("Discord's reset actions do not lose DMs", async () => {
    const before = bridgedChannels().length;
    for (const id of bridgedChannels()) channels.delete(id);
    FluxDispatcher.dispatch({ type: "CONNECTION_OPEN" });
    await wait(50);
    assert.equal(bridgedChannels().filter(id => channels.has(id)).length, before);
});

await step("logout and unload restore everything", async () => {
    await mx().logout();
    assert.equal(storage.session, undefined);
    assert.equal(bridgedChannels().length, 0);
    plugin.onUnload();
    assert.equal(MessageActions.sendMessage, unpatched.sendMessage);
    assert.equal(http.get, unpatched.get);
    assert.equal(RowManager.prototype.generate, unpatched.generate);
    assert.equal(globalThis.__mxcord, undefined);
});

console.log(results.join("\n"));
const failed = results.filter(r => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
server?.kill();
process.exit(failed ? 1 : 0);
