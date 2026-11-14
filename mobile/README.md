# Tiffin mobile (Expo)

One app for restaurant staff. What it shows depends on who signs in with their PIN:

| Role | Tabs |
|---|---|
| Captain / cashier (waiters) | Floor, My checks (take orders at the table, send to the kitchen), Me |
| Manager / owner | Business (sales, trend, best sellers, channels, locations), plus Floor and My checks, Me |

The phone is set up once with the owner's or a manager's email and password; after that staff pick their name and
type their 4-digit PIN, the same PINs as the POS.

## Run it on your phone (development)

1. Install **Expo Go** from the App Store / Play Store.
2. Start the API (`docker compose up -d` in the repo root).
3. Point the app at your computer's address on the Wi-Fi (a phone can't reach `localhost`):
   ```bash
   cd mobile
   npm install
   EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8010 npx expo start
   ```
   (Windows PowerShell: `$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:8010"; npx expo start`)
4. Scan the QR code shown in the terminal with the camera (iPhone) or Expo Go (Android).

`npx expo start --web` runs it in a browser too (add `http://localhost:8081` to the API's `CORS_ORIGINS`).

## Production

Set `EXPO_PUBLIC_API_URL` to the public site's API, e.g. `https://app.yourdomain.com/api`, and build with EAS
(`npx eas-cli@latest build`). The production site must be public (not behind Vercel Authentication) for phones to reach it.

## Checks

```bash
npx tsc --noEmit
npx eslint src
```

Crashes are reported to the admin console's Errors view (source "Mobile app").
