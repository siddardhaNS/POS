// Where Tiffin lives. Built into the app so restaurants never type a server address.
// Developers can point a copy at another server with TIFFIN_WEB_URL / TIFFIN_API_URL (e.g. a local stack).
const PRODUCTION_WEB = "https://pos-web-aurum-team.vercel.app"; // switch to the custom domain once it's live

const web = (process.env.TIFFIN_WEB_URL || PRODUCTION_WEB).replace(/\/+$/, "");
// In production the website forwards /api to the API, so one address serves both.
const api = (process.env.TIFFIN_API_URL || `${web}/api`).replace(/\/+$/, "");

module.exports = { web, api };
