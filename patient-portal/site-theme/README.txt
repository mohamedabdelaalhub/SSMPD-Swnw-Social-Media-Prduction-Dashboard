SWNW site theme for the patient portal
======================================

What it is
  swnw-site-theme.css   Website palette, IBM Plex Sans Arabic, pill buttons, card/field styling,
                        plus styles for the site header/footer. Restyle only; no layout logic.
  swnw-site-chrome.js   Inserts the website header (logo, links back to the site, booking button)
                        and footer around the portal. Presentational only: no portal logic,
                        storage or network calls.
  swnw-logo-white.png   Logo used by the header.
  fonts/                IBM Plex Sans (Arabic + Latin, 400-700), SIL Open Font License (OFL.txt).

How to install in the portal repository
  1. Copy this whole folder into patient-portal/ as  patient-portal/site-theme/
  2. In patient-portal/index.html add, AFTER the last existing stylesheet:
        <link rel="stylesheet" href="site-theme/swnw-site-theme.css?v=1">
     and AFTER the last existing script:
        <script src="site-theme/swnw-site-chrome.js?v=1" data-site="https://swnwclinics.com" defer></script>
     data-site decides where the header/footer links go. While the portal is not open to patients it may
     point to https://staging.swnwclinics.com (owner's choice, 2026-10-09). BEFORE patients get access it
     must point to the live website: the staging site books into a test database.
     The attribute  data-schedule  adds the "جدول العيادات" link; only use it when data-site is a website
     that has /User/Schedule (the redesigned one).
  3. Do not copy web.config; it only exists so the files can be previewed from the staging site.

Verified
  Sign-in, activation-request and activation-code screens at 1440px and 390px (theme injected
  into the live portal page in a test browser only).
Not verified
  Screens behind sign-in (profile, files, visits, medications, nutrition, family). They use the
  same CSS variables and .btn/.field classes, so they pick up the palette and type, but they
  need a visual check with a test account after installing.
