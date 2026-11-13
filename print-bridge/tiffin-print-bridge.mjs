#!/usr/bin/env node
// Tiffin print bridge: prints Tiffin's queued tickets and receipts on network and shared Windows printers.
//
// Browsers can't talk to printers on the local network, so this small program runs on any computer at the
// restaurant, asks Tiffin for print jobs every couple of seconds, and sends them to the printers.
// No dependencies: Node.js 18 or newer.
//
//   TIFFIN_URL=https://tiffinpos.vercel.app/api TIFFIN_PRINT_KEY=tpk_... node tiffin-print-bridge.mjs
//
// Network printers: raw ESC/POS on TCP port 9100 (the address set in Settings → Printers).
// Shared Windows printers: the bytes are written to the share path, e.g. \\localhost\POS80. Share the printer
// in Windows with the "Generic / Text Only" driver so the bytes reach it untouched.

import { writeFile } from "node:fs/promises";
import net from "node:net";

const URL_ = (process.env.TIFFIN_URL || "").replace(/\/+$/, "");
const KEY = process.env.TIFFIN_PRINT_KEY || "";
const EVERY_MS = Number(process.env.TIFFIN_POLL_MS || 2000);
const TIMEOUT_MS = 8000;

if (!URL_ || !KEY.startsWith("tpk_")) {
  console.error("Set TIFFIN_URL (e.g. https://tiffinpos.vercel.app/api) and TIFFIN_PRINT_KEY (from Settings → Printers).");
  process.exit(1);
}

const stamp = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(stamp(), ...a);

async function call(path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(URL_ + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-print-key": KEY },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const err = new Error(data?.detail || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function sendTcp(address, bytes) {
  const [host, port = "9100"] = address.split(/:(?=\d+$)/);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: Number(port) });
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.setTimeout(TIMEOUT_MS, () => fail(new Error(`No answer from ${address}`)));
    sock.on("error", (e) => fail(new Error(e.code === "ECONNREFUSED" ? `${address} refused the connection` : e.message)));
    sock.on("connect", () => sock.end(bytes));
    sock.on("close", (hadError) => { if (!hadError) resolve(); });
  });
}

async function deliver(job) {
  const bytes = Buffer.from(job.escpos, "base64");
  if (job.connection === "network") return sendTcp(job.address, bytes);
  if (job.connection === "windows") return writeFile(job.address, bytes);
  throw new Error(`The bridge can't print to ${job.connection} printers`);
}

let lastState = "";
function state(s) {
  if (s !== lastState) { log(s); lastState = s; }
}

async function tick() {
  let res;
  try {
    res = await call("/print/bridge/claim");
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      console.error(stamp(), e.message);
      process.exit(2);
    }
    state(`Can't reach Tiffin (${e.message}). Retrying…`);
    return;
  }
  state(`Connected to ${res.restaurant} · ${res.printers} printer${res.printers === 1 ? "" : "s"} on the bridge`);
  for (const job of res.jobs) {
    try {
      await deliver(job);
      await call(`/print/bridge/jobs/${job.id}/result`, { ok: true });
      log(`Printed  ${job.title} → ${job.printer}`);
    } catch (e) {
      log(`FAILED   ${job.title} → ${job.printer}: ${e.message}`);
      await call(`/print/bridge/jobs/${job.id}/result`, { ok: false, error: e.message }).catch(() => {});
    }
  }
}

log("Tiffin print bridge starting");
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, EVERY_MS));
}
