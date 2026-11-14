import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { router } from "expo-router";
import { API_URL } from "@/lib/api";
import { useAuth, useStaff } from "@/lib/auth";
import { Btn, C, Card, s } from "@/components/ui";

/** Who's signed in, hand the phone to someone else, or sign the phone out of the restaurant. */
export default function More() {
  const { user, tenant } = useStaff();
  const { lock, signOut } = useAuth();
  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
        <Text style={s.h}>Me</Text>
        <Card style={{ gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: C.ink }}>{user.name}</Text>
          <Text style={[s.muted, { textTransform: "capitalize" }]}>{user.role} · {tenant?.name}{tenant?.location_name ? ` · ${tenant.location_name}` : ""}</Text>
        </Card>
        <Btn title="Lock · hand to someone else" onPress={async () => { await lock(); router.replace("/pin"); }} />
        <Btn title="Sign this phone out" kind="soft" onPress={() => Alert.alert("Sign this phone out?", "The owner or a manager will need to sign in again with email and password.", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: async () => { await signOut(); router.replace("/login"); } },
        ])} />
        <View style={{ gap: 2, marginTop: 20 }}>
          <Text style={[s.muted, { fontSize: 11 }]}>Tiffin {Constants.expoConfig?.version ?? ""}</Text>
          <Text style={[s.muted, { fontSize: 11 }]}>Server {API_URL}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
