SEASON BY TOURNAMENT + GAME DOTS (final package)

1. Unzip over your local atlas-iq2 folder (replace files when asked).
2. DELETE this file, which the ZIP cannot remove for you:
      components/reports/PrintTips.js
   (It held the "Before you print: turn off Headers and footers" tip. Nothing uses it now.
   If you forget, npm run check fails and names the file.)
3. In a terminal in the project folder:  npm run check   (expect no FAIL lines)

THREE DIFFERENT STEPS. Only the last one changes the live site.
  A. Local commit (GitHub Desktop > Commit to main): saves on YOUR computer only. Nothing is published.
  B. Push (GitHub Desktop > Push origin): sends the commit to GitHub. This project has a Vercel
     production setup tied to main, so a push to main will very likely START a production deployment.
  C. Deployment: Vercel builds and publishes to seasontempo.com. Watch it in Vercel until READY.
Commit freely. Push only when you want it live.
No database changes are included, so nothing needs to run in Supabase.
