import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

/** Tiffin colours (same palette as the web POS). */
export const C = {
  bg: "#f6f3ee",
  card: "#ffffff",
  ink: "#1d1c1a",
  muted: "#77736b",
  line: "#e6e1d8",
  soft: "#efebe4",
  saffron: "#ec7a2c",
  saffronSoft: "#fbe6d4",
  saffronDeep: "#b4561a",
  leaf: "#2f9e5b",
  leafSoft: "#dcf1e4",
  chili: "#d64545",
  chiliSoft: "#fbe1e1",
  sky: "#2f7fd1",
  skySoft: "#e0edfa",
};

export function Btn({ title, onPress, kind = "primary", disabled, busy, style, small }: {
  title: string; onPress?: PressableProps["onPress"]; kind?: "primary" | "soft" | "ok" | "danger"; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const bg = { primary: C.ink, soft: C.soft, ok: C.leaf, danger: C.chili }[kind];
  const fg = kind === "soft" ? C.ink : "#fff";
  return (
    <Pressable onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Pill({ label, tone = "muted" }: { label: string; tone?: "muted" | "ok" | "warn" | "info" | "bad" }) {
  const [bg, fg] = { muted: [C.soft, C.muted], ok: [C.leafSoft, C.leaf], warn: [C.saffronSoft, C.saffronDeep], info: [C.skySoft, C.sky], bad: [C.chiliSoft, C.chili] }[tone];
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillText, { color: fg }]}>{label}</Text></View>;
}

export function Empty({ text, loading }: { text: string; loading?: boolean }) {
  return (
    <View style={s.empty}>
      {loading ? <ActivityIndicator color={C.muted} /> : <Text style={s.emptyText}>{text}</Text>}
    </View>
  );
}

export function H({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h, style]}>{children}</Text>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  btnSmall: { height: 38, borderRadius: 10, paddingHorizontal: 12 },
  btnText: { fontSize: 16, fontWeight: "600" },
  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.line },
  pill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: "700" },
  empty: { padding: 40, alignItems: "center" },
  emptyText: { color: C.muted, textAlign: "center", fontSize: 15, lineHeight: 21 },
  h: { fontSize: 22, fontWeight: "700", color: C.ink },
  muted: { color: C.muted, fontSize: 13 },
  mono: { fontVariant: ["tabular-nums"] },
  input: { height: 50, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 14, fontSize: 16, color: C.ink },
});
