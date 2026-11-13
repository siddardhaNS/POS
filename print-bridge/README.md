# Tiffin print bridge

Prints Tiffin's kitchen tickets, bills and receipts on **network** printers (they have an IP address) and on
**shared Windows** printers. USB and serial printers plugged into a POS tablet or PC don't need the bridge; they
print straight from Chrome or Edge on that device.

## Set up

1. In Tiffin, open **Settings → Printers**, add your printers, and create a **bridge key** (it's shown once).
2. On a computer at the restaurant that stays on during service, install [Node.js](https://nodejs.org) 18 or newer.
3. Copy `tiffin-print-bridge.mjs` to that computer and run it:

   ```bash
   # macOS / Linux
   TIFFIN_URL=https://tiffinpos.vercel.app/api TIFFIN_PRINT_KEY=tpk_your_key node tiffin-print-bridge.mjs
   ```

   ```powershell
   # Windows PowerShell
   $env:TIFFIN_URL="https://tiffinpos.vercel.app/api"; $env:TIFFIN_PRINT_KEY="tpk_your_key"; node tiffin-print-bridge.mjs
   ```

   It prints one line per job, and Settings → Printers shows the bridge as **Running**.

## Printers

- **Network printer:** enter its IP address in Tiffin (port 9100 is assumed). Print the printer's self-test page
  (hold the feed button while switching it on) to find the IP, and give it a fixed IP in your router.
- **USB printer on a Windows PC:** in Windows, share the printer and set its driver to **Generic / Text Only**, then
  add it in Tiffin as a *Shared Windows printer* with the path `\\localhost\<share name>`.

## Start it with the computer (Windows)

Create `tiffin-print-bridge.cmd` next to the script:

```bat
@echo off
set TIFFIN_URL=https://tiffinpos.vercel.app/api
set TIFFIN_PRINT_KEY=tpk_your_key
node "%~dp0tiffin-print-bridge.mjs"
```

Press `Win + R`, type `shell:startup`, and put a shortcut to that `.cmd` file in the folder that opens.

## Notes

- One bridge per restaurant is enough; it serves every network and shared printer.
- If it stops, waiting jobs stay queued and print when it comes back. Jobs that fail three times show up under
  **Didn't print** in Settings → Printers, where you can retry them or send them to another printer.
- Creating a new key in Settings stops any bridge still using the old one.
