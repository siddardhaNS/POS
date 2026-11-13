"use client";

/**
 * Direct printing from this device to USB / serial thermal printers (Chrome and Edge: WebUSB, Web Serial).
 *
 * Printers are set up once in Settings → Printers. Pairing a USB or serial printer with this device is remembered
 * here, per printer id, so the device can reconnect after a reload without asking again. The bytes themselves are
 * ESC/POS rendered by the API; this module only delivers them.
 */

export interface Printer {
  id: string;
  name: string;
  role: "receipt" | "kitchen";
  stations: string[];
  connection: "usb" | "serial" | "network" | "windows";
  address: string;
  width: 32 | 42 | 48;
  copies: number;
  cash_drawer: boolean;
  enabled: boolean;
  online: boolean;
  last_seen_at: string | null;
  last_error: string;
}

type UsbPairing = { kind: "usb"; vendorId: number; productId: number; serialNumber?: string; label: string };
type SerialPairing = { kind: "serial"; usbVendorId?: number; usbProductId?: number; baudRate: number; label: string };
export type Pairing = UsbPairing | SerialPairing;

const PAIRINGS = "tiffin.printers.paired";
const RECEIPT = "tiffin.printers.receipt";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage blocked: pairing lasts for this session only */ }
}

export const pairings = (): Record<string, Pairing> => read(PAIRINGS, {});
export const pairedIds = () => Object.keys(pairings());

function setPairing(printerId: string, p: Pairing | null) {
  const all = pairings();
  if (p) all[printerId] = p;
  else delete all[printerId];
  write(PAIRINGS, all);
  window.dispatchEvent(new Event("tiffin:printers"));
}

export const unpair = (printerId: string) => setPairing(printerId, null);

/** This device's receipt printer (each counter can print to the one next to it). */
export const deviceReceiptPrinter = (): string | null => read<string | null>(RECEIPT, null);
export const setDeviceReceiptPrinter = (id: string | null) => {
  write(RECEIPT, id);
  window.dispatchEvent(new Event("tiffin:printers"));
};

/* ---------- Browser support ---------- */

// Minimal typings for WebUSB / Web Serial (not in the default TS DOM lib).
interface UsbEndpoint { direction: "in" | "out"; type: string; endpointNumber: number }
interface UsbAlternate { endpoints: UsbEndpoint[] }
interface UsbInterface { interfaceNumber: number; alternate: UsbAlternate }
interface UsbConfiguration { interfaces: UsbInterface[] }
interface UsbDevice {
  vendorId: number; productId: number; serialNumber?: string; productName?: string; manufacturerName?: string;
  opened: boolean; configuration: UsbConfiguration | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
}
interface Usb { requestDevice(o: { filters: object[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> }
interface SerialPort {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>; close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface Serial { requestPort(): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> }

const nav = () => (typeof navigator === "undefined" ? undefined : (navigator as unknown as { usb?: Usb; serial?: Serial }));
export const supportsUsb = () => !!nav()?.usb;
export const supportsSerial = () => !!nav()?.serial;

/* ---------- Pairing ---------- */

/** Ask the browser for a USB or serial printer and remember it for this printer id. Must run from a click. */
export async function pairPrinter(p: Printer, baudRate = 9600): Promise<string> {
  if (p.connection === "usb") {
    const usb = nav()?.usb;
    if (!usb) throw new Error("This browser can't use USB printers. Use Chrome or Edge, or connect the printer through the print bridge.");
    const d = await usb.requestDevice({ filters: [] });
    const label = [d.manufacturerName, d.productName].filter(Boolean).join(" ") || "USB printer";
    setPairing(p.id, { kind: "usb", vendorId: d.vendorId, productId: d.productId, serialNumber: d.serialNumber, label });
    return label;
  }
  if (p.connection === "serial") {
    const serial = nav()?.serial;
    if (!serial) throw new Error("This browser can't use serial printers. Use Chrome or Edge, or connect the printer through the print bridge.");
    const port = await serial.requestPort();
    const info = port.getInfo();
    setPairing(p.id, { kind: "serial", usbVendorId: info.usbVendorId, usbProductId: info.usbProductId, baudRate, label: "Serial printer" });
    return "Serial printer";
  }
  throw new Error("Network and shared printers print through the print bridge, not this device.");
}

async function findUsb(pr: UsbPairing): Promise<UsbDevice> {
  const ds = (await nav()?.usb?.getDevices()) ?? [];
  const d = ds.find((x) => x.vendorId === pr.vendorId && x.productId === pr.productId && (!pr.serialNumber || x.serialNumber === pr.serialNumber))
    ?? ds.find((x) => x.vendorId === pr.vendorId && x.productId === pr.productId);
  if (!d) throw new Error("Printer not connected to this device (check the USB cable, or connect it again in Settings → Printers)");
  return d;
}

async function findSerial(pr: SerialPairing): Promise<SerialPort> {
  const ps = (await nav()?.serial?.getPorts()) ?? [];
  const p = ps.find((x) => { const i = x.getInfo(); return i.usbVendorId === pr.usbVendorId && i.usbProductId === pr.usbProductId; }) ?? (ps.length === 1 ? ps[0] : undefined);
  if (!p) throw new Error("Serial printer not connected to this device");
  return p;
}

/* ---------- Writing bytes ---------- */

const CHUNK = 4096;

async function writeUsb(pr: UsbPairing, bytes: Uint8Array) {
  const d = await findUsb(pr);
  if (!d.opened) await d.open();
  if (!d.configuration) await d.selectConfiguration(1);
  const iface = d.configuration!.interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
  if (!iface) throw new Error("This USB device doesn't look like a printer");
  const ep = iface.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk")!;
  try {
    await d.claimInterface(iface.interfaceNumber);
  } catch {
    throw new Error("The computer's printer driver is holding this USB printer. Use the print bridge, or switch the driver to WinUSB.");
  }
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const r = await d.transferOut(ep.endpointNumber, bytes.slice(i, i + CHUNK));
      if (r.status !== "ok") throw new Error(`USB write failed (${r.status})`);
    }
  } finally {
    await d.releaseInterface(iface.interfaceNumber).catch(() => {});
  }
}

async function writeSerial(pr: SerialPairing, bytes: Uint8Array) {
  const port = await findSerial(pr);
  await port.open({ baudRate: pr.baudRate || 9600 }).catch((e: Error) => {
    if (!/already open/i.test(e.message)) throw e;
  });
  try {
    const w = port.writable!.getWriter();
    try { await w.write(bytes); } finally { w.releaseLock(); }
  } finally {
    await port.close().catch(() => {});
  }
}

export function b64bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Send ESC/POS bytes to the printer paired with this device under that printer id. */
export async function sendToPrinter(printerId: string, bytes: Uint8Array) {
  const pr = pairings()[printerId];
  if (!pr) throw new Error("This printer isn't connected to this device");
  if (pr.kind === "usb") return writeUsb(pr, bytes);
  return writeSerial(pr, bytes);
}
