// Mxcord for Discord desktop (Vencord). Shows 1:1 Matrix rooms as Discord DMs.
import "./style.css";

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { find, findByCode, findByProps } from "@webpack";
import { ChannelStore, FluxDispatcher, MessageActions, Modal, NavigationRouter, openModal, SelectedChannelStore, showToast, TextInput, Tooltip, useEffect, UserStore, useState } from "@webpack/common";

import { CHANNEL_RESET_ACTIONS, createBridge } from "../core/bridge";
import { LOGO_URI } from "../core/logo";

const Native = VencordNative.pluginHelpers.Mxcord as PluginNative<typeof import("./native")>;
const logger = new Logger("Mxcord");

// Session and room state live in IndexedDB rather than Vencord settings, so the access
// token is never written to settings.json or uploaded by settings sync.
const STATE_KEY = "Mxcord_state";
const AVATARS_KEY = "Mxcord_avatars";
const AVATAR_SIZE_PX = 128;
const HTTP_METHODS = ["get", "post", "put", "patch", "del"] as const;
// Discord's message request consent status for an accepted request.
const CONSENT_ACCEPTED = 2;

type Bridge = ReturnType<typeof createBridge>;
let bridge: Bridge | null = null;
const readyListeners = new Set<() => void>();
const unpatches: Array<() => void> = [];
const avatars = new Map<string, string>();

function debounce(fn: () => void, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            fn();
        }, ms);
    };
    // Writes still pending when the plugin stops must not be lost.
    run.flush = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        fn();
    };
    return run;
}

// Writes are persisted whenever any nested property of the state changes.
function persistent<T extends object>(target: T, save: () => void): T {
    return new Proxy(target, {
        get(obj, key) {
            const value = Reflect.get(obj, key);
            return value && typeof value === "object" ? persistent(value, save) : value;
        },
        set(obj, key, value) {
            Reflect.set(obj, key, value);
            save();
            return true;
        },
        deleteProperty(obj, key) {
            Reflect.deleteProperty(obj, key);
            save();
            return true;
        },
    });
}

function instead<T extends object, K extends keyof T>(obj: T, key: K, replacement: (original: T[K], ...args: any[]) => any) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    const original = obj[key] as any;
    Object.defineProperty(obj, key, {
        configurable: true,
        writable: true,
        value(this: unknown, ...args: any[]) {
            return replacement(original.bind(this), ...args);
        },
    });
    unpatches.push(() => descriptor ? Object.defineProperty(obj, key, descriptor) : delete obj[key]);
}

async function shrinkAvatar(type: string, data: string) {
    const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type });
    try {
        const bitmap = await createImageBitmap(blob, { resizeWidth: AVATAR_SIZE_PX, resizeHeight: AVATAR_SIZE_PX, resizeQuality: "high" });
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = AVATAR_SIZE_PX;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        return canvas.toDataURL("image/png");
    } catch {
        return `data:${type};base64,${data}`;
    }
}

const saveAvatars = debounce(() => DataStore.set(AVATARS_KEY, Object.fromEntries(avatars)), 1000);
let saveState: ReturnType<typeof debounce> | null = null;

function openChannel(channelId: string) {
    NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
}

async function createDesktopBridge() {
    const saved = await DataStore.get(STATE_KEY) ?? {};
    for (const [mxc, uri] of Object.entries(await DataStore.get(AVATARS_KEY) ?? {})) avatars.set(mxc, uri as string);
    saveState = debounce(() => DataStore.set(STATE_KEY, saved), 500);
    const createChannelRecord = findByCode(".fromServer)(");

    return createBridge({
        store: persistent(saved, saveState),
        log: { error: (...args: any[]) => logger.error(...args), warn: (...args: any[]) => logger.warn(...args) },
        deviceName: "Discord Desktop (Mxcord)",
        consentAccepted: CONSENT_ACCEPTED,
        dispatch: (action: any) => FluxDispatcher.dispatch(action),
        getCurrentUser: () => UserStore.getCurrentUser(),
        getChannel: (id: string) => ChannelStore.getChannel(id),
        createChannelRecord,
        openChannel,
        isViewing: (channelId: string) => SelectedChannelStore.getChannelId() === channelId && document.hasFocus(),
        async request(method: string, url: string, { headers, body }: { headers: Record<string, string>; body?: string; }) {
            const res = await Native.request(method, url, headers, body);
            if (res.status === 0) throw new Error(res.text);
            let json = {};
            try {
                json = JSON.parse(res.text);
            } catch { }
            return { status: res.status, json };
        },
        avatars: {
            uri: (mxc: string) => avatars.get(mxc) ?? null,
            async load(mxc: string, url: string, accessToken: string) {
                const res = await Native.download(url, accessToken);
                if (res.status !== 200) throw new Error(`avatar ${res.status}`);
                avatars.set(mxc, await shrinkAvatar(res.type, res.data));
                saveAvatars();
            },
        },
        notify({ title, body, channelId, avatar }: { title: string; body: string; channelId: string; avatar?: string | null; }) {
            showNotification({ title, body, icon: avatar ?? LOGO_URI, onClick: () => openChannel(channelId) });
        },
    });
}

function patchDiscord(b: Bridge) {
    // Discord's API client, a plain object. findByProps would match superagent, which Discord
    // uses underneath and expects to return request builders.
    const http = find(m => m != null && typeof m === "object" && HTTP_METHODS.every(k => typeof m[k] === "function"));
    for (const method of HTTP_METHODS) {
        instead(http, method, (original, ...args) => b.contain(method, args, original));
    }

    instead(MessageActions, "fetchMessages", (original, options) =>
        b.isBridged(options?.channelId) ? b.fetchMessages(options).then(() => true) : original(options));
    for (const name of ["fetchLocalMessages", "fetchNewLocalMessages", "_tryFetchMessagesCached"]) {
        if (typeof MessageActions[name] !== "function") continue;
        instead(MessageActions, name, (original, ...args) =>
            b.isBridged(args[0]?.channelId ?? args[0]) ? Promise.resolve() : original(...args));
    }

    instead(MessageActions, "sendMessage", (original, channelId, message, ...rest) => {
        if (!b.isBridged(channelId)) return original(channelId, message, ...rest);
        const replyTo = rest[1]?.messageReference?.message_id;
        FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
        return b.sendMessage(channelId, message?.content ?? "", replyTo)
            .then(() => ({ ok: true }))
            .catch(error => {
                showToast(`Matrix send failed: ${error.message}`, "failure");
                logger.error("Send failed", error);
            });
    });
    instead(MessageActions, "editMessage", (original, channelId, messageId, message, ...rest) => {
        if (!b.isBridged(channelId)) return original(channelId, messageId, message, ...rest);
        MessageActions.endEditMessage(channelId);
        return b.editMessage(channelId, messageId, message?.content ?? "")
            .catch(error => showToast(`Matrix edit failed: ${error.message}`, "failure"));
    });
    instead(MessageActions, "deleteMessage", (original, channelId, messageId, ...rest) => {
        if (!b.isBridged(channelId)) return original(channelId, messageId, ...rest);
        return b.deleteMessage(channelId, messageId)
            .catch(error => showToast(`Matrix delete failed: ${error.message}`, "failure"));
    });

    patchUserAvatar(b);
    const IconUtils = findByProps("getUserAvatarURL", "getDefaultAvatarURL");
    instead(IconUtils, "getUserAvatarURL", (original, user, ...args) =>
        b.avatarForUser(user?.id) ?? original(user, ...args));
}

// getAvatarURL reads the user from `this`, which instead() doesn't pass on.
function patchUserAvatar(b: Bridge) {
    const proto = Object.getPrototypeOf(UserStore.getCurrentUser());
    const descriptor = Object.getOwnPropertyDescriptor(proto, "getAvatarURL")!;
    const original = descriptor.value;
    Object.defineProperty(proto, "getAvatarURL", {
        ...descriptor,
        value(this: { id: string; }, ...args: any[]) {
            return b.avatarForUser(this.id) ?? original.apply(this, args);
        },
    });
    unpatches.push(() => Object.defineProperty(proto, "getAvatarURL", descriptor));
}

function useBridge() {
    const [, rerender] = useState(0);
    useEffect(() => {
        const update = () => rerender(n => n + 1);
        readyListeners.add(update);
        const off = bridge?.onStatus(update);
        return () => {
            readyListeners.delete(update);
            off?.();
        };
    }, [bridge]);
    return bridge;
}

function MatrixBadge({ size }: { size: number; }) {
    return (
        <Tooltip text="Matrix (Mxcord)">
            {props => <img {...props} src={LOGO_URI} alt="Matrix" className="vc-mxcord-badge" style={{ width: size, height: size }} />}
        </Tooltip>
    );
}

function AddByMatrixModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [value, setValue] = useState("");
    const submit = () => {
        modalProps.onClose();
        bridge?.openMatrixDm(value).catch(error => {
            showToast(error.message, "failure");
            logger.error("Add by Matrix failed", error);
        });
    };
    return (
        <Modal
            {...modalProps}
            title="Add by Matrix"
            subtitle="Start a DM with a Matrix user."
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Start chat", variant: "primary", onClick: submit, disabled: !value.trim() },
            ]}
        >
            <form onSubmit={e => { e.preventDefault(); submit(); }}>
                <TextInput value={value} onChange={setValue} placeholder={`@name:${bridge?.homeserverName() ?? "server"}`} autoFocus />
            </form>
        </Modal>
    );
}

function promptAddByMatrix() {
    if (!bridge?.store.session) {
        showToast("Log in to Matrix first (Mxcord settings)", "failure");
        return;
    }
    openModal(props => <AddByMatrixModal modalProps={props} />);
}

function SettingsPanel() {
    const b = useBridge();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    // The store isn't React state, so inputs bound to it re-render explicitly.
    const [, rerender] = useState(0);
    if (!b) return <Paragraph>Loading…</Paragraph>;

    const { store } = b;
    const update = (apply: () => void) => {
        apply();
        rerender(n => n + 1);
    };
    const session = store.session;
    const doLogin = () => {
        if (busy || !username || !password) return;
        setBusy(true);
        b.login(username, password)
            .then(() => showToast("Logged in to Matrix", "success"))
            .catch(error => showToast(`Login failed: ${error.message}`, "failure"))
            .finally(() => {
                setPassword("");
                setBusy(false);
            });
    };

    return (
        <div className="vc-mxcord-settings">
            <Heading tag="h5">Status</Heading>
            <Paragraph className={Margins.bottom16}>{b.status()}</Paragraph>

            <Heading tag="h5">Homeserver URL</Heading>
            <Paragraph className={Margins.bottom8}>Use your pantalaimon address for encrypted chats.</Paragraph>
            <div className={Margins.bottom16}>
                <TextInput
                    value={store.homeserver}
                    onChange={(value: string) => update(() => { store.homeserver = value.trim(); })}
                    placeholder="https://matrix.example.com"
                    disabled={!!session}
                />
            </div>

            {session ? (
                <>
                    <Heading tag="h5">Account</Heading>
                    <Paragraph>{session.userId}</Paragraph>
                    <Paragraph className={Margins.bottom8}>Device {session.deviceId}</Paragraph>
                    <div className="vc-mxcord-buttons">
                        <Button onClick={promptAddByMatrix}>Add by Matrix</Button>
                        <Button variant="dangerPrimary" onClick={() => b.logout().then(() => showToast("Logged out of Matrix"))}>Log out</Button>
                    </div>
                </>
            ) : (
                <form onSubmit={e => { e.preventDefault(); doLogin(); }}>
                    <Heading tag="h5">Username</Heading>
                    <div className={Margins.bottom8}>
                        <TextInput value={username} onChange={setUsername} placeholder="@you:server or you" />
                    </div>
                    <Heading tag="h5">Password</Heading>
                    <div className={Margins.bottom8}>
                        <TextInput type="password" value={password} onChange={setPassword} />
                    </div>
                    <Button type="submit" disabled={busy || !username || !password}>{busy ? "Logging in…" : "Log in"}</Button>
                </form>
            )}

            <Divider className={Margins.top20} />
            <FormSwitch
                title="Notify for Matrix messages"
                description="Shown while Discord is running and the chat isn't open"
                value={store.notifications}
                onChange={value => update(() => { store.notifications = value; })}
            />
        </div>
    );
}

const settings = definePluginSettings({
    account: {
        type: OptionType.COMPONENT,
        component: SettingsPanel,
    },
});

export default definePlugin({
    name: "Mxcord",
    description: "Matrix direct messages inside Discord, with support for end-to-end encryption, avatars, message requests and notifications.",
    authors: [{ name: "oxicodona612", id: 0n }],
    dependencies: ["MessageDecorationsAPI", "MemberListDecoratorsAPI"],
    settings,

    flux: Object.fromEntries(CHANNEL_RESET_ACTIONS.map(type => [type, (action: any) => { bridge?.onChannelReset(action); }])),

    toolboxActions: {
        "Add by Matrix": promptAddByMatrix,
    },

    renderMessageDecoration: ({ message }) =>
        bridge?.isBridgedUser(message.author.id) ? <MatrixBadge size={18} /> : null,

    renderMemberListDecorator: ({ type, user }) =>
        type === "dm" && bridge?.isBridgedUser(user?.id) ? <MatrixBadge size={18} /> : null,

    async start() {
        bridge = await createDesktopBridge();
        patchDiscord(bridge);
        bridge.start();
        for (const listener of readyListeners) listener();
        (window as any).__mxcord = bridge;
    },

    stop() {
        bridge?.stop();
        bridge = null;
        saveState?.flush();
        saveAvatars.flush();
        for (const unpatch of unpatches.splice(0).reverse()) unpatch();
        delete (window as any).__mxcord;
    },
});
