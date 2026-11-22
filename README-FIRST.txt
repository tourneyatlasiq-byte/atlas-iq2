SMALL CLEANUP PACKAGE (built on main 78d85db). Not deployed.

What changed
  1. components/reports/PrintTips.js removed (unused). npm run check now passes with no FAIL lines.
  2. app/icon.svg: browser tab icon now the Volt mark (ink square, white dots, volt "next" dot).
  3. app/globals.css: the tracker Undo button is 44px tall (was 40px).

HOW TO APPLY
  1. Unzip over your local atlas-iq2 folder (replace files when asked).
  2. DELETE this file by hand, because a ZIP cannot remove files:
        components/reports/PrintTips.js
     (This ZIP does not contain it. If you leave it, npm run check fails and names it.)
  3. In GitHub Desktop, commit to main, then push when you are ready. Pushing starts a production
     deployment on Vercel. Nothing is published until you push.

After deploy: browsers cache tab icons for a long time. Hard refresh, or reopen the site in a new
window, before judging the new icon.
