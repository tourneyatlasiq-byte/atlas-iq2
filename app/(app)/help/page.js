import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { HelpHome } from "../../../components/HelpCenter";
import { helpAccess } from "./access";
import { helpProgress } from "./progress";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help & Getting Started · Season Tempo" };

/**
 * Help & Getting Started (V1, 2026-11): "How can we help?". Signed-in only
 * (inside the app shell) and read-only. ?q= opens a search, ?a= a direct
 * answer, ?view=guides the full guide list; ?from= is where Back returns.
 */
export default async function HelpPage({ searchParams }) {
  const ctx = await getContext();
  const params = await searchParams;
  const access = helpAccess(ctx);
  const progress = await helpProgress(createClient(), ctx, { qab: access.qab });
  const str = (v) => (typeof v === "string" ? v : null);

  return (
    <HelpHome
      progress={progress}
      access={access}
      from={str(params?.from)}
      query={str(params?.q) ?? ""}
      answer={str(params?.a)}
      showGuides={params?.view === "guides"}
    />
  );
}
