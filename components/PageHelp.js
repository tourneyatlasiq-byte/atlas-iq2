"use client";

import { HelpMenu } from "./HelpMenu";

/**
 * Help in the page header.
 *
 * The application previously carried a dedicated white bar holding nothing but
 * this control, which added a horizontal line at a height that matched nothing
 * else on screen. Same component, same behaviour — it just sits in the header
 * row that every page already renders.
 */
export function PageHelp() {
  return (
    <div className="page-help">
      <HelpMenu />
    </div>
  );
}
