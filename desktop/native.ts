// Runs in Discord's main process. Matrix requests are made here because the homeserver is
// chosen by the user, and Discord's content security policy blocks unknown hosts in the page.
import { IpcMainInvokeEvent } from "electron";

const isHttp = (url: string) => /^https?:\/\//.test(url);

export async function request(_: IpcMainInvokeEvent, method: string, url: string, headers: Record<string, string>, body?: string) {
    if (!isHttp(url)) return { status: 0, text: "Only http and https URLs are allowed" };
    try {
        const res = await fetch(url, { method, headers, body });
        return { status: res.status, text: await res.text() };
    } catch (error) {
        return { status: 0, text: String(error) };
    }
}

export async function download(_: IpcMainInvokeEvent, url: string, accessToken: string) {
    if (!isHttp(url)) return { status: 0, type: "", data: "" };
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return { status: res.status, type: "", data: "" };
        const data = Buffer.from(await res.arrayBuffer()).toString("base64");
        return { status: res.status, type: res.headers.get("content-type") ?? "application/octet-stream", data };
    } catch (error) {
        return { status: 0, type: "", data: String(error) };
    }
}
