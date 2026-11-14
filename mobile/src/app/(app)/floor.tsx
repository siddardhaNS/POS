import { useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, money } from "@/lib/api";
import { useStaff } from "@/lib/auth";
import { useLive } from "@/lib/hooks";
import { C, Empty, s } from "@/components/ui";

export interface TableRow {
  id: string; name: string; seats: number; section: string; state: "free" | "unsent" | "kitchen" | "served";
  order_id: string | null; total: number; guests: number; items: number; unsent: number; opened_at: string | null;
}

const STATE: Record<TableRow["state"], { bg: string; fg: string; label: string }> = {
  free: { bg: C.card, fg: C.muted, label: "Free" },
  unsent: { bg: C.skySoft, fg: C.sky, label: "Not sent" },
  kitchen: { bg: C.saffronSoft, fg: C.saffronDeep, label: "In kitchen" },
  served: { bg: C.leafSoft, fg: C.leaf, label: "Served" },
};

const mins = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

/** The floor: every table by section with its state. Tap a table to open (or start) its check. */
export default function Floor() {
  const { tenant } = useStaff();
  const { data, error, loading, reload } = useLive<TableRow[]>("/tables", 6000);
  const [section, setSection] = useState<string | null>(null);
  const sections = useMemo(() => [...new Set((data ?? []).map((t) => t.section))], [data]);
  const shown = (data ?? []).filter((t) => !section || t.section === section);
  const busy = (data ?? []).filter((t) => t.order_id).length;

  async function open(t: TableRow) {
    try {
      const o = t.order_id ? { id: t.order_id } : await api<{ id: string }>(`/tables/${t.id}/order`, { method: "POST" });
      router.push({ pathname: "/check/[id]", params: { id: o.id, title: `Table ${t.name.replace(/^T/, "")}` } });
    } catch (e) {
      Alert.alert("Couldn't open the table", (e as Error).message);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 }}>
        <Text style={s.muted}>{tenant?.name}{tenant?.location_name ? ` · ${tenant.location_name}` : ""}</Text>
        <Text style={s.h}>Floor <Text style={{ color: C.muted, fontWeight: "500", fontSize: 16 }}>{busy} of {data?.length ?? 0} seated</Text></Text>
      </View>
      {sections.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 8, paddingBottom: 8 }} style={{ flexGrow: 0 }}>
          {[null, ...sections].map((sec) => (
            <Pressable key={sec ?? "all"} onPress={() => setSection(sec)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: section === sec ? C.ink : C.card, borderWidth: 1, borderColor: section === sec ? C.ink : C.line }}>
              <Text style={{ color: section === sec ? "#fff" : C.ink, fontWeight: "600" }}>{sec ?? "All"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
        {!data ? <Empty text={error || "Loading tables…"} loading={!error} /> : shown.length === 0 ? <Empty text="No tables yet. Draw them in Floor plan on the POS." /> : shown.map((t) => {
          const st = t.order_id && t.state === "free" ? { ...STATE.free, bg: C.soft, label: "Seated" } : STATE[t.state];
          return (
            <Pressable key={t.id} onPress={() => open(t)}
              style={({ pressed }) => ({ width: "47%", minHeight: 108, borderRadius: 18, padding: 14, backgroundColor: st.bg, borderWidth: 1, borderColor: t.order_id ? "transparent" : C.line, borderStyle: t.order_id ? "solid" : "dashed", opacity: pressed ? 0.85 : 1 })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 22, fontWeight: "700", color: C.ink }}>{t.name}</Text>
                <Text style={{ fontSize: 12, color: st.fg, fontWeight: "700" }}>{st.label}</Text>
              </View>
              {t.order_id ? (
                <>
                  <Text style={[s.mono, { fontSize: 17, fontWeight: "600", color: C.ink, marginTop: 8 }]}>{money(t.total, tenant?.currency)}</Text>
                  <Text style={s.muted}>{t.items} items · {mins(t.opened_at)} min{t.unsent ? ` · ${t.unsent} not sent` : ""}</Text>
                </>
              ) : <Text style={[s.muted, { marginTop: 8 }]}>{t.seats} seats · tap to seat</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
