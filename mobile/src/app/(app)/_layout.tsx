import { useEffect } from "react";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { can } from "@/lib/api";
import { useAuth, useStaff } from "@/lib/auth";
import { C } from "@/components/ui";

type Icon = React.ComponentProps<typeof Ionicons>["name"];
const icon = (name: Icon) => function TabIcon({ color, size }: { color: unknown; size: number }) {
  return <Ionicons name={name} color={(color as string | null) ?? undefined} size={size} />;
};

/** One app, shown by role: waiters get the floor and their checks, managers and owners get the business numbers. */
export default function AppTabs() {
  const { user } = useStaff();
  const { refresh } = useAuth();
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const waiter = can(user, "floor") && can(user, "order");
  const manager = can(user, "reports");
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: C.ink, tabBarInactiveTintColor: C.muted,
      tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line }, sceneStyle: { backgroundColor: C.bg },
    }}>
      <Tabs.Screen name="floor" options={{ title: "Floor", tabBarIcon: icon("grid-outline"), href: waiter ? undefined : null }} />
      <Tabs.Screen name="checks" options={{ title: "My checks", tabBarIcon: icon("receipt-outline"), href: waiter ? undefined : null }} />
      <Tabs.Screen name="dashboard" options={{ title: "Business", tabBarIcon: icon("stats-chart-outline"), href: manager ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: "Me", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
