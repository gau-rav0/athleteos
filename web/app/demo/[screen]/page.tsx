import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function DemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { screen } = await params;
  if (!["today", "train", "recover", "progress", "insights"].includes(screen))
    notFound();
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
    const client = await supabaseServer();
    const { data } = await client.auth.getUser();
    if (data.user) redirect("/today");
  }
  const { state } = await searchParams;
  const mode = ["empty", "sparse", "partial", "error"].includes(state || "")
    ? state
    : "normal";
  return <Dashboard screen={screen} demo mode={mode} />;
}
