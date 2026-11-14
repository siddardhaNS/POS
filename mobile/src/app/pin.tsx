import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Btn, C, Empty, s } from "@/components/ui";

interface StaffTile { id: string; name: string; role: string }
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** Who's using the phone: pick your name, type your 4-digit PIN. */
export default function Pin() {
  const { device, pinIn, signOut } = useAuth();
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [who, setWho] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!device) return;
    api<StaffTile[]>("/pos/staff", { token: device.token }).then(setStaff).catch((e) => setError((e as Error).message));
  }, [device]);

  async function press(k: string) {
    if (busy || !who) return;
    void Haptics.selectionAsync().catch(() => {});
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (!k) return;
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      setError("");
      try {
        await pinIn(who.id, next);
        router.replace("/");
      } catch (e) {
        setError((e as Error).message);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setPin("");
      }
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={{ padding: 20, paddingBottom: 8 }}>
        <Text style={s.muted}>{device?.tenant?.name}{device?.tenant?.location_name ? ` · ${device.tenant.location_name}` : ""}</Text>
        <Text style={s.h}>{who ? `Hi ${who.name.split(" ")[0]}` : "Who's working?"}</Text>
      </View>
      {!who ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
          {!staff ? <Empty text={error || "Loading staff…"} loading={!error} /> : staff.length === 0 ? <Empty text="No staff with a PIN yet. Add PINs under Staff & roles in the POS." /> : staff.map((u) => (
            <Pressable key={u.id} onPress={() => { setWho(u); setPin(""); setError(""); }}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line }, pressed && { opacity: 0.8 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.soft, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "700", color: C.ink }}>{u.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</Text>
              </View>
              <View><Text style={{ fontSize: 17, fontWeight: "600", color: C.ink }}>{u.name}</Text><Text style={[s.muted, { textTransform: "capitalize" }]}>{u.role}</Text></View>
            </Pressable>
          ))}
          <Btn title="Sign this phone out" kind="soft" onPress={signOut} style={{ marginTop: 20 }} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 20, justifyContent: "center", gap: 22 }}>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 16 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: i < pin.length ? C.ink : C.line }} />
            ))}
          </View>
          {!!error && <Text style={{ color: C.chili, textAlign: "center" }}>{error}</Text>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, width: 280, alignSelf: "center" }}>
            {KEYS.map((k, i) => (
              <Pressable key={i} onPress={() => press(k)} disabled={!k}
                style={({ pressed }) => ({ width: 84, height: 72, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: k ? (pressed ? C.line : C.card) : "transparent", borderWidth: k ? 1 : 0, borderColor: C.line })}>
                <Text style={{ fontSize: 26, fontWeight: "600", color: C.ink }}>{k}</Text>
              </Pressable>
            ))}
          </View>
          <Btn title="Not you?" kind="soft" onPress={() => { setWho(null); setPin(""); setError(""); }} />
        </View>
      )}
    </SafeAreaView>
  );
}
