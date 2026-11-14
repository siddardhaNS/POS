import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import { api, money } from "@/lib/api";
import { useStaff } from "@/lib/auth";
import { useLive } from "@/lib/hooks";
import { Btn, C, Empty, Pill, s } from "@/components/ui";

interface Opt { id: string; name: string; price: number; available?: boolean }
interface Group { id: string; name: string; min: number; max: number; options: Opt[] }
interface Item { id: string; category_id: string; name: string; price: number; is_veg: boolean; available: boolean; modifiers: Group[]; channels?: string[]; allergens?: string[] }
interface Cat { id: string; name: string; open_now?: boolean; schedule_label?: string; items: Item[] }
interface Line {
  id: string; menu_item_id: string | null; name: string; qty: number; note: string; modifiers: { name: string }[]; line_total: number;
  sent: boolean; done: boolean; comp_reason: string; seat: number; course: number;
}
interface Order {
  id: string; number: number; table: string | null; channel: string; status: string; guests: number; items: Line[];
  subtotal: number; tax: number; due: number; paid: number; balance: number; tax_inclusive?: boolean;
  discount: { amount: number }; promotion?: { name: string; amount: number } | null; tax_breakdown?: { name: string; rate: number; tax: number }[];
}

/** Take an order at the table: pick dishes (with options and notes), adjust quantities, send to the kitchen. */
export default function CheckScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { tenant } = useStaff();
  const fmt = (v: number) => money(v, tenant?.currency);
  const { data: order, setData: setOrder, reload } = useLive<Order>(`/orders/${id}`, 10000);
  const { data: menu } = useLive<Cat[]>(order ? `/menu?channel=${order.channel === "takeaway" ? "takeaway" : "dine_in"}` : null, 0);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Item | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [tab, setTab] = useState<"menu" | "check">("menu");
  const [busy, setBusy] = useState(false);

  const activeCat = cat ?? menu?.[0]?.id ?? null;
  const items = useMemo(() => {
    if (!menu) return [];
    const all = menu.flatMap((c) => c.items);
    if (q.trim()) return all.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
    return menu.find((c) => c.id === activeCat)?.items ?? [];
  }, [menu, activeCat, q]);
  const closed = new Set((menu ?? []).filter((c) => c.open_now === false).map((c) => c.id));

  if (!order) return <View style={s.screen}><Stack.Screen options={{ title: title ?? "Check" }} /><Empty text="Loading check…" loading /></View>;
  const open = order.status === "open";
  const unsent = order.items.filter((l) => !l.sent).reduce((a, l) => a + l.qty, 0);
  const count = order.items.reduce((a, l) => a + l.qty, 0);
  const qtyOf = (mid: string) => order.items.filter((l) => l.menu_item_id === mid).reduce((a, l) => a + l.qty, 0);

  async function add(m: Item, modifier_ids: string[] = [], note = "", qty = 1) {
    if (!open) return;
    if (!m.available) return Alert.alert(`${m.name} is sold out`);
    if (closed.has(m.category_id)) return Alert.alert("Not serving this now", menu?.find((c) => c.id === m.category_id)?.schedule_label ?? "");
    if (!modifier_ids.length && m.modifiers.length && !pick) return setPick(m);
    try {
      const o = await api<Order>(`/orders/${order!.id}/items`, { body: { menu_item_id: m.id, modifier_ids, note, qty } });
      setOrder(o);
      setPick(null);
      void Haptics.selectionAsync().catch(() => {});
    } catch (e) { Alert.alert("Couldn't add it", (e as Error).message); }
  }

  async function send() {
    setBusy(true);
    try {
      const r = await api<{ kot_number: number; order: Order }>(`/orders/${order!.id}/kot`, { method: "POST" });
      setOrder(r.order);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(`KOT ${r.kot_number} sent`, `${unsent} item${unsent === 1 ? "" : "s"} on the way to the kitchen.`);
    } catch (e) { Alert.alert("Couldn't send", (e as Error).message); }
    setBusy(false);
  }

  async function setGuests(n: number) {
    try { setOrder(await api<Order>(`/orders/${order!.id}`, { method: "PATCH", body: { guests: Math.max(0, n) } })); } catch (e) { Alert.alert("", (e as Error).message); }
  }

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <Stack.Screen options={{ title: `${title ?? "Check"} · #${order.number}` }} />
      <View style={{ flexDirection: "row", padding: 12, gap: 8 }}>
        {(["menu", "check"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: tab === t ? C.ink : C.card, borderWidth: 1, borderColor: tab === t ? C.ink : C.line }}>
            <Text style={{ color: tab === t ? "#fff" : C.ink, fontWeight: "600" }}>{t === "menu" ? "Menu" : `Check · ${count}`}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "menu" ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 12, gap: 8 }}>
            <TextInput value={q} onChangeText={setQ} placeholder="Search dishes" placeholderTextColor={C.muted} style={[s.input, { height: 44 }]} />
            {!q && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {(menu ?? []).map((c) => (
                  <Pressable key={c.id} onPress={() => setCat(c.id)} style={{ paddingHorizontal: 14, height: 38, justifyContent: "center", borderRadius: 12, backgroundColor: activeCat === c.id ? C.ink : C.card, borderWidth: 1, borderColor: activeCat === c.id ? C.ink : C.line, opacity: c.open_now === false ? 0.5 : 1 }}>
                    <Text style={{ color: activeCat === c.id ? "#fff" : C.ink, fontWeight: "600" }}>{c.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {!menu ? <Empty text="Loading menu…" loading /> : items.map((m) => {
              const n = qtyOf(m.id);
              const off = !m.available || closed.has(m.category_id);
              return (
                <Pressable key={m.id} onPress={() => add(m)} disabled={!open}
                  style={({ pressed }) => ({ width: "48%", minHeight: 92, borderRadius: 16, padding: 12, backgroundColor: C.card, borderWidth: n ? 2 : 1, borderColor: n ? C.ink : C.line, opacity: off ? 0.45 : pressed ? 0.85 : 1 })}>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: m.is_veg ? C.leaf : C.chili }} />
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>{m.name}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto", paddingTop: 8 }}>
                    <Text style={[s.muted, s.mono]}>{!m.available ? "Sold out" : closed.has(m.category_id) ? "Not now" : fmt(m.price)}{m.modifiers.length ? " +" : ""}</Text>
                    {n > 0 && <View style={{ minWidth: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>{n}</Text></View>}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.line }}>
            <Text style={{ fontWeight: "600", color: C.ink }}>Guests</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Btn title="−" kind="soft" small onPress={() => setGuests(order.guests - 1)} disabled={!open} />
              <Text style={[s.mono, { fontSize: 18, fontWeight: "700", minWidth: 22, textAlign: "center" }]}>{order.guests}</Text>
              <Btn title="+" kind="soft" small onPress={() => setGuests(order.guests + 1)} disabled={!open} />
            </View>
          </View>
          {order.items.length === 0 ? <Empty text="Nothing yet. Add dishes from the Menu tab." /> : order.items.map((l) => (
            <Pressable key={l.id} onPress={() => open && setLine(l)}
              style={{ flexDirection: "row", gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.line, opacity: l.sent ? 0.75 : 1 }}>
              <Text style={[s.mono, { fontWeight: "700", width: 26, color: C.ink }]}>{l.qty}×</Text>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontWeight: "600", color: C.ink, textDecorationLine: l.comp_reason ? "line-through" : "none" }}>{l.name}</Text>
                {l.modifiers.length > 0 && <Text style={{ color: C.saffronDeep, fontSize: 12 }}>{l.modifiers.map((m) => m.name).join(" · ")}</Text>}
                {!!l.note && <Text style={[s.muted, { fontStyle: "italic" }]}>“{l.note}”</Text>}
                <Pill label={l.sent ? (l.done ? "Ready" : "In kitchen") : "Not sent"} tone={l.sent ? (l.done ? "ok" : "warn") : "info"} />
              </View>
              <Text style={[s.mono, { color: C.ink }]}>{l.comp_reason ? "—" : fmt(l.line_total)}</Text>
            </Pressable>
          ))}
          {order.items.length > 0 && (
            <View style={{ gap: 4, paddingTop: 8 }}>
              <Row l={order.tax_inclusive ? "Value before tax" : "Subtotal"} v={fmt(order.subtotal)} />
              {order.promotion && <Row l={`Offer · ${order.promotion.name}`} v={`−${fmt(order.promotion.amount)}`} />}
              {order.discount.amount > 0 && <Row l="Discount" v={`−${fmt(order.discount.amount)}`} />}
              {(order.tax_breakdown?.length ? order.tax_breakdown.filter((t) => t.tax) : [{ name: tenant?.tax_label ?? "Tax", rate: 0, tax: order.tax }])
                .map((t) => <Row key={t.name + t.rate} l={t.rate ? `${t.name} ${t.rate}%` : t.name} v={fmt(t.tax)} />)}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink }}>{order.paid ? "Balance" : "Total"}</Text>
                <Text style={[s.mono, { fontSize: 22, fontWeight: "700", color: C.ink }]}>{fmt(order.balance)}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {open ? (
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
          <Btn title={unsent ? `Send to kitchen · ${unsent}` : "Nothing new to send"} onPress={send} busy={busy} disabled={!unsent} />
        </View>
      ) : <Text style={[s.muted, { textAlign: "center", padding: 14 }]}>This check is {order.status}.</Text>}

      {pick && <OptionsSheet item={pick} fmt={fmt} onClose={() => setPick(null)} onAdd={(ids, note, qty) => add(pick, ids, note, qty)} />}
      {line && <LineSheet order={order} line={line} onClose={() => setLine(null)} onDone={(o) => { setOrder(o); setLine(null); }} reload={reload} />}
    </SafeAreaView>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={s.muted}>{l}</Text><Text style={[s.muted, s.mono]}>{v}</Text></View>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} />
      <View style={{ maxHeight: "85%", backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: C.ink }}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

function OptionsSheet({ item, fmt, onClose, onAdd }: { item: Item; fmt: (v: number) => string; onClose: () => void; onAdd: (ids: string[], note: string, qty: number) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const toggle = (g: Group, o: Opt) => setChosen((c) => {
    const cur = c[g.id] ?? [];
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max === 1) return { ...c, [g.id]: [o.id] };
    if (g.max && cur.length >= g.max) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });
  const missing = item.modifiers.filter((g) => (chosen[g.id]?.length ?? 0) < g.min);
  const extra = item.modifiers.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id))).reduce((a, o) => a + o.price, 0);
  return (
    <Sheet title={item.name} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: 14 }}>
        {item.modifiers.map((g) => (
          <View key={g.id} style={{ gap: 8 }}>
            <Text style={{ fontWeight: "700", color: C.ink }}>{g.name} <Text style={s.muted}>{g.min ? "required" : "optional"}{g.max > 1 ? ` · up to ${g.max}` : ""}</Text></Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id);
                return (
                  <Pressable key={o.id} onPress={() => toggle(g, o)} disabled={o.available === false}
                    style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: on ? C.ink : C.card, borderWidth: 1, borderColor: on ? C.ink : C.line, opacity: o.available === false ? 0.4 : 1 }}>
                    <Text style={{ color: on ? "#fff" : C.ink, fontWeight: "600" }}>{o.name}{o.available === false ? " · sold out" : o.price ? ` +${fmt(o.price)}` : ""}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <TextInput value={note} onChangeText={setNote} placeholder="Note for the kitchen (no onion…)" placeholderTextColor={C.muted} maxLength={200} style={s.input} />
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Btn title="−" kind="soft" small onPress={() => setQty(Math.max(1, qty - 1))} />
        <Text style={[s.mono, { fontSize: 18, fontWeight: "700", minWidth: 24, textAlign: "center" }]}>{qty}</Text>
        <Btn title="+" kind="soft" small onPress={() => setQty(Math.min(99, qty + 1))} />
        <Btn title={missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add · ${fmt((item.price + extra) * qty)}`} disabled={missing.length > 0}
          onPress={() => onAdd(Object.values(chosen).flat(), note.trim(), qty)} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}

function LineSheet({ order, line, onClose, onDone, reload }: { order: Order; line: Line; onClose: () => void; onDone: (o: Order) => void; reload: () => void }) {
  const [qty, setQty] = useState(line.qty);
  const [note, setNote] = useState(line.note);
  async function save(body: Record<string, unknown>) {
    try { onDone(await api<Order>(`/orders/${order.id}/items/${line.id}`, { method: "PATCH", body })); } catch (e) { Alert.alert("", (e as Error).message); reload(); }
  }
  return (
    <Sheet title={line.name} onClose={onClose}>
      {line.sent && <Text style={s.muted}>Already in the kitchen. Only a cashier or manager can reduce it.</Text>}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Text style={{ flex: 1, fontWeight: "600", color: C.ink }}>Quantity</Text>
        <Btn title="−" kind="soft" small onPress={() => setQty(Math.max(1, qty - 1))} />
        <Text style={[s.mono, { fontSize: 18, fontWeight: "700", minWidth: 24, textAlign: "center" }]}>{qty}</Text>
        <Btn title="+" kind="soft" small onPress={() => setQty(Math.min(99, qty + 1))} />
      </View>
      {!line.sent && <TextInput value={note} onChangeText={setNote} placeholder="Note for the kitchen" placeholderTextColor={C.muted} maxLength={200} style={s.input} />}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn title="Remove" kind="danger" onPress={() => save({ qty: 0 })} style={{ flex: 1 }} />
        <Btn title="Save" onPress={() => save({ qty, ...(line.sent ? {} : { note: note.trim() }) })} style={{ flex: 2 }} />
      </View>
    </Sheet>
  );
}
