/* GitHub Pages is for development only (owner, 2026-11-11). The live dashboard is https://dashboard.swnwclinics.com
   (same files, same database). Anyone who opens the github.io copy is sent to the same page on the server, so nobody
   keeps working on an old bookmark. Developers: open the github.io link once with ?dev=1 (remembered in that browser;
   ?dev=0 turns it off). Legal pages (privacy/terms/data-deletion) do not load this file and stay on github.io. */
(function () {
  try {
    if (!/\.github\.io$/i.test(location.hostname)) return;
    var q = new URLSearchParams(location.search);
    if (q.get('dev') === '1') localStorage.setItem('swnwDevPages', '1');
    if (q.get('dev') === '0') localStorage.removeItem('swnwDevPages');
    if (localStorage.getItem('swnwDevPages') === '1') return;
    var path = location.pathname.replace(/^\/SSMPD-Swnw-Social-Media-Prduction-Dashboard(?=\/|$)/i, '') || '/';
    location.replace('https://dashboard.swnwclinics.com' + path + location.search + location.hash);
  } catch (e) { /* never block the page */ }
})();
