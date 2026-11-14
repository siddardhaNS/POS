# Tiffin Counter (desktop)

The counter billing app for Windows and Mac. Built for quick service and takeaway: tap dishes, take cash / UPI /
card (split if needed), hand over a token, print the receipt (and a kitchen ticket if you like). It **keeps billing
when the internet drops**: the menu, prices and tax rules are stored on the computer, sales are saved locally with a
token number and sent to the server when the connection is back (sending twice never creates two bills).

## Use it

1. Install and open Tiffin Counter.
2. First run: enter the server address and sign in with the owner's or a manager's email (needs the internet once).
3. Staff pick their name and type their PIN (also needs the internet; when it's down, the last person signed in can
   carry on).
4. Settings: pick the receipt printer, paper width (80 / 58 mm), and whether to print a kitchen ticket.

Keyboard: **F2** pay, **Esc** clear search; PIN digits can be typed.

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
npm run dev        # the screen (Vite on :5174) inside the Electron window
npm run build      # type-check and build
npm run dist       # Windows installer in release/
```

During development the API must allow `http://localhost:5174` in `CORS_ORIGINS` only when you open the screen in a
normal browser; inside Electron all requests go through the app itself.
