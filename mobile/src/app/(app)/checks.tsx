import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { money } from "@/lib/api";
import { useStaff } from "@/lib/auth";
import { useLive } from "@/lib/hooks";
import { C, Empty, Pill, s } from "@/components/ui";
import type { TableRow } from "./floor";

/** Open checks at a glance: tables with something on them, unsent items first. */
export default function Checks() {
  const { tenant } = useStaff();
  const { data, error, loading, reload } = useLive<TableRow[]>("/tables", 6000);
  const open = (data ?? []).filter((t) => t.order_id).sort((a, b) => b.unsent - a.unsent || (a.opened_at ?? "").localeCompare(b.opened_at ?? ""));
  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 10 }}><Text style={s.h}>Open checks</Text></View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 0, gap: 10 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
        {!data ? <Empty text={error || "Loading…"} loading={!error} /> : open.length === 0 ? <Empty text="No open checks. Seat a table from the Floor." /> : open.map((t) => (
          <Pressable key={t.id} onPress={() => router.push({ pathname: "/check/[id]", params: { id: t.order_id!, title: `Table ${t.name.replace(/^T/, "")}` } })}
            style={({ pressed }) => ({ backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: C.ink, width: 56 }}>{t.name}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.muted}>{t.items} items{t.guests ? ` · ${t.guests} guests` : ""}</Text>
              {t.unsent > 0 ? <Pill label={`${t.unsent} not sent to kitchen`} tone="info" /> : <Pill label={t.state === "kitchen" ? "In kitchen" : "Served"} tone={t.state === "kitchen" ? "warn" : "ok"} />}
            </View>
            <Text style={[s.mono, { fontSize: 16, fontWeight: "600", color: C.ink }]}>{money(t.total, tenant?.currency)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
