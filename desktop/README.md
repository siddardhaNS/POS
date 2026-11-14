# Tiffin Counter (desktop)

The counter billing app for Windows and Mac. Built for quick service and takeaway: tap dishes, take cash / UPI /
card (split if needed), hand over a token, print the receipt (and a kitchen ticket if you like). It **keeps billing
when the internet drops**: the menu, prices and tax rules are stored on the computer, sales are saved locally with a
token number and sent to the server when the connection is back (sending twice never creates two bills).

## How it works

- **Online:** the window shows the full Tiffin POS (tables, kitchen, online orders, reports, inventory, everything),
  always the latest version. Receipts and kitchen tickets print straight to the printer, no dialog.
- **Offline:** if the server can't be reached for about 30 seconds, the app switches to quick billing (packaged with
  the app). It uses the sign-in, staff, menu, prices and taxes it saved while online.
- **Back online:** offline sales are sent first; then (with no bill half-done) the full POS opens again by itself.

There is no server address to type: it is built into the app (`electron/config.cjs`). Restaurants install, open and
sign in exactly as on the web. The app must have been signed in once while online before it can bill offline.

Keyboard in quick billing: **F2** pay, **Esc** clear search.

## How offline works

- Every 10 s the app checks the server and sends waiting sales; every 5 min it downloads the menu again.
- The header shows *Online* / *Offline: still billing* and how many sales are waiting.
- Sales reach the server as paid takeaway checks (kitchen tickets already marked done), with invoice numbers,
  loyalty points and stock deducted as usual. If a sale doesn't add up on the server (e.g. prices changed), it stays
  open with a note in the activity log for a manager.
- Cancelling: a sale not yet sent can be cancelled on the counter (it reaches the server as void). After it's on the
  server, refund it from Order history in the POS.
- Not available offline: switching staff by PIN, online / QR orders, shared tables.

## Develop

```bash
cd desktop
npm install
npm run dev           # full mode against the local stack (web :3100, API :8010)
npm run dev:counter   # just the quick-billing screen, with live reload
npm run build         # type-check and build
npm run dist          # Windows installer in release/
```

Set `TIFFIN_WEB_URL` / `TIFFIN_API_URL` to point a build at another server.
