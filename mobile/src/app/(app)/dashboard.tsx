import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { hasModule, money } from "@/lib/api";
import { useStaff } from "@/lib/auth";
import { useLive } from "@/lib/hooks";
import { C, Card, Empty, s } from "@/components/ui";

interface Kpi { net_sales: number; orders: number; avg_order: number; tips: number; tax: number; discounts: number; refunds: number }
interface Summary { current: Kpi; previous: Kpi; labels: string[]; series: number[]; payment_mix: Record<string, number>; channels: Record<string, number> }
interface Items { items: { name: string; qty: number; net_sales: number }[] }
interface Location { id: string; name: string; location_name: string; city: string; currency: "INR" | "USD"; net_sales: number; orders: number; open_checks: number }
interface Locations { locations: Location[]; total: { net_sales: number; orders: number } | null }
interface TableRow { order_id: string | null; total: number }

const isoDay = (back: number) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
const startOf = (k: string) => isoDay({ today: 0, "7d": 6, "30d": 29 }[k] ?? 0);
const RANGES: [string, string][] = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]];
const CHANNEL: Record<string, string> = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery", catering: "Events", swiggy: "Swiggy", zomato: "Zomato", doordash: "DoorDash", ubereats: "Uber Eats", website: "Website" };
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", tap: "Tap", online: "Online", other: "Other", split: "Split", comp: "Comp", points: "Points" };

function delta(cur: number, prev: number) {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%`, up: d >= 0 };
}

/** The business on one screen: sales and checks for today / 7 / 30 days, the trend, what's selling, where it comes from. */
export default function Dashboard() {
  const { tenant } = useStaff();
  const fmt = (v: number) => money(v, tenant?.currency);
  const [range, setRangeKey] = useState("today");
  const [start, setStart] = useState(() => startOf("today"));
  const [end, setEnd] = useState(() => isoDay(0));
  const setRange = (k: string) => { setRangeKey(k); setStart(startOf(k)); setEnd(isoDay(0)); };
  const sum = useLive<Summary>(`/reports/summary?range=${range}`, 60000);
  const items = useLive<Items>(hasModule(tenant, "reports_plus") ? `/reports/items?start=${start}&end=${end}` : null, 120000);
  const locs = useLive<Locations>(hasModule(tenant, "locations") ? `/locations/summary?start=${start}&end=${end}` : null, 120000);
  const floor = useLive<TableRow[]>("/tables", 30000);
  const cur = sum.data?.current;
  const prev = sum.data?.previous;
  const open = (floor.data ?? []).filter((t) => t.order_id);
  const max = Math.max(1, ...(sum.data?.series ?? [0]));
  const channels = Object.entries(sum.data?.channels ?? {}).sort((a, b) => b[1] - a[1]);
  const chTotal = channels.reduce((a, [, v]) => a + v, 0) || 1;
  const reload = () => { sum.reload(); items.reload(); locs.reload(); floor.reload(); };

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }} refreshControl={<RefreshControl refreshing={sum.loading && !!sum.data} onRefresh={reload} />}>
        <View>
          <Text style={s.muted}>{tenant?.name}{tenant?.location_name ? ` · ${tenant.location_name}` : ""}</Text>
          <Text style={s.h}>Business</Text>
        </View>
        <View style={{ flexDirection: "row", backgroundColor: C.soft, borderRadius: 12, padding: 4 }}>
          {RANGES.map(([k, l]) => (
            <Pressable key={k} onPress={() => setRange(k)} style={{ flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: range === k ? C.card : "transparent" }}>
              <Text style={{ fontWeight: "600", color: range === k ? C.ink : C.muted }}>{l}</Text>
            </Pressable>
          ))}
        </View>

        {!cur ? <Empty text={sum.error || "Loading…"} loading={!sum.error} /> : (
          <>
            <Card style={{ gap: 4 }}>
              <Text style={s.muted}>Net sales</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
                <Text style={[s.mono, { fontSize: 34, fontWeight: "700", color: C.ink }]}>{fmt(cur.net_sales)}</Text>
                {prev && delta(cur.net_sales, prev.net_sales) && (
                  <Text style={{ fontWeight: "700", color: delta(cur.net_sales, prev.net_sales)!.up ? C.leaf : C.chili }}>{delta(cur.net_sales, prev.net_sales)!.text}</Text>
                )}
              </View>
              <Text style={s.muted}>vs the {range === "today" ? "day" : "period"} before · after discounts and refunds, before tax</Text>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 90, marginTop: 12 }}>
                {(sum.data?.series ?? []).map((v, i) => (
                  <View key={i} style={{ flex: 1, height: Math.max(2, (v / max) * 86), borderRadius: 3, backgroundColor: v ? C.saffron : C.line }} />
                ))}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={[s.muted, { fontSize: 11 }]}>{sum.data?.labels[0]}</Text>
                <Text style={[s.muted, { fontSize: 11 }]}>{sum.data?.labels[sum.data.labels.length - 1]}</Text>
              </View>
            </Card>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Tile label="Checks" value={String(cur.orders)} d={prev ? delta(cur.orders, prev.orders) : null} />
              <Tile label="Average check" value={fmt(cur.avg_order)} d={prev ? delta(cur.avg_order, prev.avg_order) : null} />
              <Tile label="Open now" value={String(open.length)} sub={fmt(open.reduce((a, t) => a + t.total, 0)) + " on tables"} />
              <Tile label={tenant?.market === "US" ? "Tips" : "Tax collected"} value={fmt(tenant?.market === "US" ? cur.tips : cur.tax)} />
              <Tile label="Discounts" value={fmt(cur.discounts)} warn={cur.discounts > 0} />
              <Tile label="Refunds" value={fmt(cur.refunds)} warn={cur.refunds > 0} />
            </View>

            {channels.length > 0 && (
              <Card style={{ gap: 10 }}>
                <Text style={{ fontWeight: "700", color: C.ink }}>Where sales come from</Text>
                {channels.map(([k, v]) => (
                  <View key={k} style={{ gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: C.ink }}>{CHANNEL[k] ?? k}</Text><Text style={[s.mono, { color: C.ink }]}>{fmt(v)}</Text></View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: C.soft }}><View style={{ height: 6, borderRadius: 3, width: `${(v / chTotal) * 100}%`, backgroundColor: C.ink }} /></View>
                  </View>
                ))}
                {Object.keys(sum.data?.payment_mix ?? {}).length > 0 && (
                  <Text style={s.muted}>Paid by {Object.entries(sum.data!.payment_mix).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${METHOD[k] ?? k} ${n}`).join(" · ")}</Text>
                )}
              </Card>
            )}
          </>
        )}

        {!!items.data?.items.length && (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontWeight: "700", color: C.ink }}>Best sellers</Text>
            {items.data.items.slice(0, 6).map((i, k) => (
              <View key={i.name} style={{ flexDirection: "row", gap: 10 }}>
                <Text style={[s.muted, { width: 18 }]}>{k + 1}</Text>
                <Text style={{ flex: 1, color: C.ink }}>{i.name}</Text>
                <Text style={[s.muted, s.mono]}>{i.qty}×</Text>
                <Text style={[s.mono, { color: C.ink, width: 86, textAlign: "right" }]}>{fmt(i.net_sales)}</Text>
              </View>
            ))}
          </Card>
        )}

        {(locs.data?.locations.length ?? 0) > 1 && (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontWeight: "700", color: C.ink }}>Locations</Text>
            {locs.data!.locations.map((l) => (
              <View key={l.id} style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ flex: 1, color: C.ink }}>{l.location_name || l.city || l.name}</Text>
                <Text style={[s.muted, s.mono]}>{l.orders} checks</Text>
                <Text style={[s.mono, { color: C.ink, width: 96, textAlign: "right" }]}>{money(l.net_sales, l.currency)}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value, sub, d, warn }: { label: string; value: string; sub?: string; d?: { text: string; up: boolean } | null; warn?: boolean }) {
  return (
    <View style={{ width: "48%", backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line, gap: 2 }}>
      <Text style={s.muted}>{label}</Text>
      <Text style={[s.mono, { fontSize: 20, fontWeight: "700", color: warn ? C.saffronDeep : C.ink }]}>{value}</Text>
      {d ? <Text style={{ fontSize: 12, fontWeight: "700", color: d.up ? C.leaf : C.chili }}>{d.text}</Text> : sub ? <Text style={[s.muted, { fontSize: 12 }]}>{sub}</Text> : null}
    </View>
  );
}
