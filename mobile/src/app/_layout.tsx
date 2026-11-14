import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { reportError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { C } from "@/components/ui";

function Routes() {
  const { ready, device, staff } = useAuth();
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={!device}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={!!device && !staff}>
        <Stack.Screen name="pin" />
      </Stack.Protected>
      <Stack.Protected guard={!!staff}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="check/[id]" options={{ headerShown: true, title: "Check", headerBackTitle: "Back" }} />
      </Stack.Protected>
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Crashes outside React rendering go to the admin console's error log.
    const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void } };
    const prev = g.ErrorUtils?.getGlobalHandler();
    g.ErrorUtils?.setGlobalHandler((e, fatal) => { reportError(e, fatal ? "fatal" : "global"); prev?.(e, fatal); });
  }, []);
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Routes />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/** A screen that crashes shows this instead of a blank app, and the crash is reported. */
export { ErrorBoundary } from "@/components/error-boundary";
