import { useEffect } from "react";
import { Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { reportError } from "@/lib/api";
import { Btn, C } from "./ui";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { reportError(error, "screen"); }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: C.ink }}>Something went wrong on this screen</Text>
      <Text style={{ color: C.muted, textAlign: "center" }}>It has been reported to the Tiffin team. Checks and payments are saved on the server.</Text>
      <Btn title="Try again" onPress={retry} style={{ alignSelf: "stretch" }} />
    </View>
  );
}
