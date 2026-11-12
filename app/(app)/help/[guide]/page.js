import { notFound } from "next/navigation";
import { getContext } from "../../../../lib/context";
import { findGuide } from "../../../../lib/help";
import { HelpGuide } from "../../../../components/HelpCenter";
import { helpAccess } from "../access";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const guide = findGuide((await params)?.guide);
  return { title: `${guide ? guide.title : "Help"} · Season Tempo` };
}

/** One Help & Getting Started guide. Read-only. */
export default async function HelpGuidePage({ params, searchParams }) {
  const guide = findGuide((await params)?.guide);
  if (!guide) notFound();

  const ctx = await getContext();
  const query = await searchParams;

  return (
    <HelpGuide
      guide={guide}
      access={helpAccess(ctx)}
      from={typeof query?.from === "string" ? query.from : null}
    />
  );
}
