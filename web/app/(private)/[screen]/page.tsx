import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/auth";
export const dynamic = "force-dynamic";
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!["today", "train", "recover", "progress", "insights"].includes(screen))
    notFound();
  await requireUser();
  // Validate each navigation even though the authenticated client shell persists.
  return null;
}
