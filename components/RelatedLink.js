"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { viewSeason } from "../lib/actions/seasons";

/**
 * A link to a related record.
 *
 * One treatment everywhere, so the same interaction means the same thing
 * across Atlas. Only names that are already displayed become links — this
 * never adds a column or an icon of its own.
 *
 * Actionable at rest, not on hover: hover does not exist on a phone, and a
 * coach at a field has to be able to see what is tappable.
 *
 * `season` is for destinations that live in a different season from the one
 * being viewed — facility history spans seasons. Switching happens on click
 * rather than on arrival, because cookies() is read-only during a page render,
 * so handling it at the destination would mean a redirect and a visible flash.
 * Viewing only: is_current is never touched.
 */
export function RelatedLink({ href, season, children, className = "", title }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const classes = `rel-link${className ? ` ${className}` : ""}`;

  // Inside a clickable row, the row's own drawer must not also open.
  const stop = (e) => e.stopPropagation();

  if (!season) {
    return (
      <Link href={href} className={classes} title={title} onClick={stop}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      title={title}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        startTransition(async () => {
          // An inaccessible or unknown season is ignored by the action, and
          // the destination then falls back to the normal view.
          await viewSeason(season);
          router.push(href);
        });
      }}
    >
      {children}
    </button>
  );
}
