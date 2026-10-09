import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/auth";
import { createHash } from "node:crypto";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!["today", "train", "recover", "progress", "insights"].includes(screen))
    notFound();
  const { user } = await requireUser();
  // Send only an opaque session discriminator, never the raw account identity.
  // Each validated leaf binds retained private state to its current account.
  const accountKey = createHash("sha256")
    .update(`athleteos-dashboard:${user.id}`)
    .digest("hex");
  return (
    <Dashboard
      key={`${accountKey}:${screen}`}
      accountKey={accountKey}
      screen={screen}
      demo={false}
    />
  );
}
