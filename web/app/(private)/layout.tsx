import type { ReactNode } from "react";
import { requireUser } from "@/lib/supabase/auth";
import { PrivateDashboardShell } from "@/components/private-dashboard-shell";

export const dynamic = "force-dynamic";

export default async function PrivateLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser();
  return <PrivateDashboardShell>{children}</PrivateDashboardShell>;
}
