// Signs your own devices with your cross-signing key, so Element and other clients show them as verified.
//
// pantalaimon's encryption library has no cross-signing support, so its device can't be verified
// interactively. This script reads the self-signing key from secret storage using your recovery
// key or passphrase, signs the devices you pick and uploads the signatures. It logs in with a
// temporary session, signs it out when done, and stores nothing.
//
// Usage: node tools/verify-device.mjs <homeserver-url>
import { createInterface } from "node:readline";
import crypto from "node:crypto";

const homeserver = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/.+/.test(homeserver)) {
    console.error("Usage: node tools/verify-device.mjs <homeserver-url>");
    process.exit(1);
}

const SELF_SIGNING = "m.cross_signing.self_signing";
// PKCS#8 header for a raw 32-byte Ed25519 seed.
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
rl._writeToOutput = text => { if (!muted) process.stdout.write(text); };

async function ask(query, hidden = false) {
    process.stdout.write(query);
    muted = hidden;
    const { value = "" } = await lines.next();
    muted = false;
    if (hidden && process.stdin.isTTY) process.stdout.write("\n");
    return value;
}

let token = null;
async function api(method, path, body) {
    const res = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(`${method} ${path}: ${res.status} ${json.errcode ?? ""} ${json.error ?? ""}`.trim());
        error.status = res.status;
        throw error;
    }
    return json;
}

const unpadded = buf => buf.toString("base64").replace(/=+$/, "");

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function decodeBase58(text) {
    let n = 0n;
    for (const c of text) {
        const digit = BASE58.indexOf(c);
        if (digit < 0) return null;
        n = n * 58n + BigInt(digit);
    }
    const bytes = [];
    for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
    for (const c of text) {
        if (c !== "1") break;
        bytes.unshift(0);
    }
    return Buffer.from(bytes);
}

// A recovery key is 0x8B 0x01, the 32-byte key and a parity byte, in base58.
function parseRecoveryKey(text) {
    const bytes = decodeBase58(text.replace(/\s+/g, ""));
    if (bytes?.length !== 35 || bytes[0] !== 0x8b || bytes[1] !== 0x01) return null;
    if (bytes.reduce((parity, b) => parity ^ b, 0) !== 0) return null;
    return bytes.subarray(2, 34);
}

function deriveKeys(key, name) {
    const out = Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(32), name, 64));
    return { aesKey: out.subarray(0, 32), macKey: out.subarray(32) };
}

const mac = (macKey, data) => unpadded(crypto.createHmac("sha256", macKey).update(data).digest());

// Secret storage keys carry the MAC of 32 encrypted zero bytes, which confirms the key is right.
function keyMatches(key, description) {
    if (!description.iv || !description.mac) return true;
    const { aesKey, macKey } = deriveKeys(key, "");
    const cipher = crypto.createCipheriv("aes-256-ctr", aesKey, Buffer.from(description.iv, "base64"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.alloc(32)), cipher.final()]);
    return mac(macKey, ciphertext) === description.mac.replace(/=+$/, "");
}

function decryptSecret(key, name, encrypted) {
    const { aesKey, macKey } = deriveKeys(key, name);
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    if (mac(macKey, ciphertext) !== encrypted.mac.replace(/=+$/, "")) throw new Error(`${name} could not be decrypted`);
    const decipher = crypto.createDecipheriv("aes-256-ctr", aesKey, Buffer.from(encrypted.iv, "base64"));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function verifyDevices(userId, ownDeviceId) {
    const accountData = type => api("GET", `/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`)
        .catch(error => { if (error.status === 404) return null; throw error; });

    const keys = await api("POST", "/keys/query", { device_keys: { [userId]: [] } });
    const published = Object.values(keys.self_signing_keys?.[userId]?.keys ?? {})[0];
    if (!published) throw new Error("Cross-signing is not set up for this account. Set it up in Element first.");

    const keyName = (await accountData("m.secret_storage.default_key"))?.key;
    const description = keyName && await accountData(`m.secret_storage.key.${keyName}`);
    const encrypted = keyName && (await accountData(SELF_SIGNING))?.encrypted?.[keyName];
    if (!description || !encrypted) throw new Error("The self-signing key is not in secret storage. Set up recovery in Element first.");

    const secret = await ask("Recovery key or passphrase: ", true);
    let key = parseRecoveryKey(secret);
    const passphrase = description.passphrase;
    if (!key && passphrase?.algorithm === "m.pbkdf2") {
        key = crypto.pbkdf2Sync(secret, passphrase.salt, passphrase.iterations, (passphrase.bits ?? 256) / 8, "sha512");
    }
    if (!key || !keyMatches(key, description)) throw new Error("The recovery key or passphrase is not correct.");

    const seed = Buffer.from(decryptSecret(key, SELF_SIGNING, encrypted), "base64");
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
    const publicKey = unpadded(crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32));
    if (publicKey !== published) throw new Error("The stored self-signing key does not match the published one. Reset cross-signing in Element.");
    const keyId = `ed25519:${publicKey}`;

    const devices = Object.values(keys.device_keys?.[userId] ?? {})
        .filter(device => device.device_id !== ownDeviceId && !device.signatures?.[userId]?.[keyId]);
    if (!devices.length) {
        console.log("All devices with encryption keys are already verified.");
        return;
    }

    console.log("\nUnverified devices:");
    devices.forEach((device, i) => console.log(`  ${i + 1}. ${device.device_id}  ${device.unsigned?.device_display_name ?? ""}`));
    console.log("Only verify devices you recognise. Sessions without encryption keys can't be verified and are not listed.");
    const picked = (await ask("Devices to verify (for example 1,2; empty to cancel): "))
        .split(/[\s,]+/).filter(Boolean).map(n => devices[Number(n) - 1]);
    if (picked.includes(undefined)) throw new Error("Invalid selection.");
    if (!picked.length) return;

    const signed = {};
    for (const device of picked) {
        const { signatures, unsigned, ...content } = device;
        const signature = unpadded(crypto.sign(null, Buffer.from(canonicalJson(content)), privateKey));
        signed[device.device_id] = { ...content, signatures: { [userId]: { [keyId]: signature } } };
    }
    const result = await api("POST", "/keys/signatures/upload", { [userId]: signed });
    const failures = result.failures?.[userId] ?? {};
    for (const device of picked) {
        const failure = failures[device.device_id];
        console.log(failure ? `${device.device_id}: failed (${failure.errcode ?? ""} ${failure.error ?? ""})` : `${device.device_id}: verified`);
    }
}

try {
    let user = (await ask("Username: ")).trim();
    if (user.includes(":")) {
        if (!user.startsWith("@")) user = `@${user}`;
    } else {
        user = user.replace(/^@/, "");
    }
    const password = await ask("Password: ", true);
    const login = await api("POST", "/login", {
        type: "m.login.password",
        identifier: { type: "m.id.user", user },
        password,
        initial_device_display_name: "Mxcord verify (temporary)",
    });
    token = login.access_token;
    try {
        await verifyDevices(login.user_id, login.device_id);
    } finally {
        await api("POST", "/logout", {}).catch(() => {});
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    rl.close();
}
