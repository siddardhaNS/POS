import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Btn, C, s } from "@/components/ui";

/** Set up this phone for a restaurant: the owner or a manager signs in once; staff then use their PINs. */
export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      router.replace("/pin");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.saffron, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 20, color: C.ink }}>t</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: "700", color: C.ink }}>Tiffin</Text>
        </View>
        <Text style={{ fontSize: 28, fontWeight: "700", color: C.ink }}>Set up this phone</Text>
        <Text style={s.muted}>The owner or a manager signs in once. After that, staff pick their name and use their PIN.</Text>
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address"
          value={email} onChangeText={setEmail} placeholderTextColor={C.muted} />
        <TextInput style={s.input} placeholder="Password" secureTextEntry autoComplete="password" value={password}
          onChangeText={setPassword} onSubmitEditing={go} placeholderTextColor={C.muted} />
        {!!error && <Text style={{ color: C.chili }}>{error}</Text>}
        <Btn title="Sign in" onPress={go} busy={busy} disabled={!email || !password} />
        <Text style={[s.muted, { fontSize: 11, marginTop: 8 }]}>Server: {API_URL}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
