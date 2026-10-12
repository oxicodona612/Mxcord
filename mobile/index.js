// Mxcord for Discord on Android (Revenge). Shows 1:1 Matrix rooms as Discord DMs.
// build.mjs bundles this with the shared core into the single file Revenge loads.
import { CHANNEL_RESET_ACTIONS, createBridge } from "../core/bridge.js";
import { LOGO_URI } from "../core/logo.js";

const { metro, patcher, plugin, logger, ui, storage: storageApi } = vendetta;
const { FluxDispatcher, React, ReactNative } = metro.common;
const { FormSection, FormInput, FormRow, FormText, FormDivider, FormSwitchRow } = ui.components.Forms;

const UserStore = metro.findByStoreName("UserStore");
const ChannelStore = metro.findByStoreName("ChannelStore");
const SelectedChannelStore = metro.findByStoreName("SelectedChannelStore");
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
const AvatarUtils = metro.findByProps("getUserAvatarURL", "getUserAvatarSource");
const MessageRequestActions = metro.findByProps("acceptMessageRequest", "rejectMessageRequest");
// Discord's push service never sees Matrix messages, so notifications are posted locally.
const PushNotifications = globalThis.nativeModuleProxy.PushNotificationAndroid;
const NotificationManager = globalThis.nativeModuleProxy.DCDNotificationManager;
const FileModule = globalThis.nativeModuleProxy.NativeFileModule
    ?? globalThis.nativeModuleProxy.RTNFileManager
    ?? globalThis.nativeModuleProxy.DCDFileManager;

// Bridged users get a guild tag pointing here so the DM list reserves a badge slot.
const MATRIX_TAG_GUILD_ID = String((3n << 22n) | 1n);
const LOGO_SIZE_DP = 18;
const LOGO_LINE_SP = 18;
const HOMESERVER_PLACEHOLDER = "https://matrix.example.com";
const CONSENT_ACCEPTED = 2;
// Matrix media needs an access token, which image views can't send, so avatars are
// downloaded once and served from Discord's cache directory.
const AVATAR_DIR = "mxcord/avatars";

const h = React.createElement;
const store = plugin.storage;
// Revenge storage can't hold null: unset values are deleted keys or empty strings.
store.avatarFiles ??= {};
// Restored from storage so avatars appear before the first sync.
const avatarFiles = new Map(Object.entries(store.avatarFiles));
const avatarFetches = new Map();
const unpatches = [];
const toast = text => ui.toasts.showToast(text);

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

async function downloadAvatar(mxc, url, accessToken) {
    const absolute = `${FileModule.getConstants().CacheDirPath}/${avatarPath(mxc)}`;
    if (await FileModule.fileExists(absolute)) {
        rememberAvatar(mxc, `file://${absolute}`);
        return;
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`avatar ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = await FileModule.writeFile("cache", avatarPath(mxc), base64Encode(bytes), "base64");
    rememberAvatar(mxc, `file://${path}`);
}

const bridge = createBridge({
    store,
    log: logger,
    reservedIds: [MATRIX_TAG_GUILD_ID],
    consentAccepted: CONSENT_ACCEPTED,
    dispatch: action => FluxDispatcher.dispatch(action),
    getCurrentUser: () => UserStore.getCurrentUser(),
    getChannel: id => ChannelStore.getChannel(id),
    createChannelRecord: createChannelRecordFromServer,
    openChannel: channelId => ChannelSelect.selectPrivateChannel(channelId),
    isViewing: channelId => ReactNative.AppState.currentState === "active" && SelectedChannelStore.getChannelId() === channelId,
    decoratePeer: user => ({
        ...user,
        primary_guild: { identity_guild_id: MATRIX_TAG_GUILD_ID, identity_enabled: true, tag: "MTRX", badge: "mxcord" },
    }),
    async request(method, url, { headers, body, signal }) {
        const res = await fetch(url, { method, headers, body, signal });
        return { status: res.status, json: await res.json().catch(() => ({})) };
    },
    avatars: {
        uri: mxc => avatarFiles.get(mxc) ?? null,
        load(mxc, url, accessToken) {
            if (!avatarFetches.has(mxc)) {
                avatarFetches.set(mxc, downloadAvatar(mxc, url, accessToken).finally(() => avatarFetches.delete(mxc)));
            }
            return avatarFetches.get(mxc);
        },
    },
    notify({ title, body, channelId, messageId }) {
        PushNotifications?.presentLocalNotification?.({
            alertTitle: title,
            alertBody: body,
            silent: false,
            userInfo: messageId ? { channel_id: channelId, message_id: messageId } : { channel_id: channelId },
        });
    },
});

// Android may clear the cache directory between runs.
async function verifyAvatarFiles() {
    for (const [mxc, uri] of [...avatarFiles]) {
        if (await FileModule.fileExists(uri.replace(/^file:\/\//, ""))) continue;
        avatarFiles.delete(mxc);
        delete store.avatarFiles[mxc];
        bridge.forgetAvatar(mxc);
    }
}

const ADD_BY_MATRIX_ALERT = "mxcord-add-by-matrix";

function AddByMatrixAlert() {
    const [value, setValue] = React.useState("");
    const submit = () => {
        dismissAlert(ADD_BY_MATRIX_ALERT);
        bridge.openMatrixDm(value).catch(error => {
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
            placeholder: `@name:${bridge.homeserverName()}`,
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

function Settings() {
    storageApi.useProxy(store);
    const [, rerender] = React.useReducer(x => x + 1, 0);
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => bridge.onStatus(rerender), []);

    const doLogin = () => {
        if (busy || !username || !password) return;
        setBusy(true);
        bridge.login(username, password)
            .then(() => toast("Logged in to Matrix"))
            .catch(error => toast(`Login failed: ${error.message}`))
            .finally(() => {
                setPassword("");
                setBusy(false);
            });
    };

    const session = store.session;
    return h(ReactNative.ScrollView, { style: { flex: 1 } },
        h(FormSection, { title: "Status" }, h(FormText, null, bridge.status())),
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
                h(FormRow, { label: "Log out", onPress: () => bridge.logout().then(() => toast("Logged out of Matrix")) }))
            : h(FormSection, { title: "Log in" },
                h(FormInput, { title: "Username", value: username, onChange: setUsername, placeholder: "@you:server or you", autoCapitalize: "none", autoCorrect: false }),
                h(FormInput, { title: "Password", value: password, onChange: setPassword, secureTextEntry: true, autoCapitalize: "none", autoCorrect: false }),
                h(FormDivider),
                h(FormRow, { label: busy ? "Logging in…" : "Log in", onPress: doLogin })));
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
    if (!message || !bridge.isBridgedUser(message.authorId)) return;
    const avatar = bridge.avatarForUser(message.authorId);
    if (avatar) message.avatarURL = avatar;
    message.roleIcon = { name: "Matrix (Mxcord)", alt: "Matrix", source: LOGO_URI, size: LOGO_LINE_SP };
    message.clanTag = null;
    message.clanBadgeUrl = null;
    message.clanTagGuildId = null;
}

// Read acks for bridged chats are suppressed, so their notifications are cleared here.
function onChannelSelect(action) {
    if (bridge.isBridged(action.channelId)) NotificationManager?.clearNotificationsForChannel?.(action.channelId);
}

function subscribe(type, handler) {
    FluxDispatcher.subscribe(type, handler);
    unpatches.push(() => FluxDispatcher.unsubscribe(type, handler));
}

function load() {
    for (const mod of httpModules) {
        for (const method of HTTP_METHODS) {
            if (typeof mod[method] !== "function") continue;
            unpatches.push(patcher.instead(method, mod, (args, original) => bridge.contain(method, args, original)));
        }
    }

    for (const type of CHANNEL_RESET_ACTIONS) subscribe(type, bridge.onChannelReset);
    subscribe("CHANNEL_SELECT", onChannelSelect);

    for (const key of ["default", "GuildTagBadge"]) {
        const memo = GuildTagBadges?.[key];
        if (typeof memo?.type !== "function") continue;
        unpatches.push(patcher.instead("type", memo, (args, original) =>
            bridge.isBridgedUser(args[0]?.userId) ? renderLogo() : original(...args)));
    }
    const UserRecordProto = Object.getPrototypeOf(UserStore.getCurrentUser());
    unpatches.push(patcher.instead("getAvatarURL", UserRecordProto, function (args, original) {
        return bridge.avatarForUser(this?.id) ?? original.apply(this, args);
    }));
    unpatches.push(patcher.instead("getAvatarSource", UserRecordProto, function (args, original) {
        const uri = bridge.avatarForUser(this?.id);
        return uri ? { uri } : original.apply(this, args);
    }));
    unpatches.push(patcher.instead("getUserAvatarURL", AvatarUtils, (args, original) =>
        bridge.avatarForUser(args[0]?.id) ?? original(...args)));
    unpatches.push(patcher.instead("getUserAvatarSource", AvatarUtils, (args, original) => {
        const uri = bridge.avatarForUser(args[0]?.id);
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

    unpatches.push(patcher.instead("fetchMessages", MessageActions, (args, original) =>
        bridge.isBridged(args[0]?.channelId) ? bridge.fetchMessages(args[0]) : original(...args)));
    for (const name of ["fetchLocalMessages", "fetchNewLocalMessages", "_tryFetchMessagesCached"]) {
        if (typeof MessageActions[name] !== "function") continue;
        unpatches.push(patcher.instead(name, MessageActions, (args, original) =>
            bridge.isBridged(args[0]?.channelId ?? args[0]) ? Promise.resolve() : original(...args)));
    }

    unpatches.push(patcher.instead("sendMessage", MessageActions, (args, original) => {
        const [channelId, message, , options] = args;
        if (!bridge.isBridged(channelId)) return original(...args);
        return bridge.sendMessage(channelId, message?.content ?? "", options?.messageReference?.message_id)
            .then(() => ({ ok: true }))
            .catch(error => {
                toast(`Matrix send failed: ${error.message}`);
                logger.error("Matrix send failed", error);
            });
    }));
    unpatches.push(patcher.instead("editMessage", MessageActions, (args, original) => {
        const [channelId, messageId, message] = args;
        if (!bridge.isBridged(channelId)) return original(...args);
        MessageActions.endEditMessage?.(channelId);
        return bridge.editMessage(channelId, messageId, message?.content ?? "").catch(error => toast(`Matrix edit failed: ${error.message}`));
    }));
    unpatches.push(patcher.instead("deleteMessage", MessageActions, (args, original) => {
        const [channelId, messageId] = args;
        if (!bridge.isBridged(channelId)) return original(...args);
        return bridge.deleteMessage(channelId, messageId).catch(error => toast(`Matrix delete failed: ${error.message}`));
    }));

    unpatches.push(patcher.instead("acceptMessageRequest", MessageRequestActions, (args, original) =>
        bridge.isBridged(args[0]) ? bridge.acceptRequest(args[0]).catch(error => toast(`Matrix join failed: ${error.message}`)) : original(...args)));
    unpatches.push(patcher.instead("rejectMessageRequest", MessageRequestActions, (args, original) =>
        bridge.isBridged(args[0]) ? bridge.rejectRequest(args[0]).catch(error => toast(`Matrix decline failed: ${error.message}`)) : original(...args)));
    unpatches.push(patcher.instead("rejectMessageRequestBatch", MessageRequestActions, (args, original) => {
        const ids = Array.isArray(args[0]) ? args[0] : [];
        for (const channelId of ids.filter(bridge.isBridged)) {
            bridge.rejectRequest(channelId).catch(error => toast(`Matrix decline failed: ${error.message}`));
        }
        const rest = ids.filter(id => !bridge.isBridged(id));
        return rest.length ? original(rest, ...args.slice(1)) : Promise.resolve();
    }));

    // Exposed for debugging from a JS console.
    globalThis.__mxcord = { ...bridge, promptAddByMatrix };
    bridge.start();
    setTimeout(() => verifyAvatarFiles().catch(error => logger.warn("Avatar check failed", error)), 2000);
}

export default {
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
        bridge.stop();
        for (const unpatch of unpatches.splice(0)) unpatch();
        delete globalThis.__mxcord;
    },
    settings: Settings,
};
