import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/api";

/** Send everyone to the right place: sign in, pick yourself, or your role's home screen. */
export default function Index() {
  const { device, staff } = useAuth();
  if (!device) return <Redirect href="/login" />;
  if (!staff) return <Redirect href="/pin" />;
  // Waiters land on the floor; managers and owners who don't serve land on today's numbers.
  return <Redirect href={can(staff.user, "floor") && !["owner", "manager"].includes(staff.user.role) ? "/floor" : can(staff.user, "reports") ? "/dashboard" : "/floor"} />;
}
