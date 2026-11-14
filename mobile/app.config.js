// Build-time settings on top of app.json.
// Android blocks plain http:// by default. Only a test build pointed at a computer on the local network
// (EXPO_PUBLIC_API_URL=http://192.168...) needs it allowed; production builds use https and keep the block.
module.exports = ({ config }) => {
  const api = process.env.EXPO_PUBLIC_API_URL || "";
  const plugins = [...(config.plugins || [])];
  if (api.startsWith("http://")) plugins.push(["expo-build-properties", { android: { usesCleartextTraffic: true } }]);
  return { ...config, plugins };
};
