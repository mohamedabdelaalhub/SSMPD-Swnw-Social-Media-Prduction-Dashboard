# portal.swnwclinics.com on the website IIS server

Use an independent IIS static site. Keep the existing GitHub dashboard and portal URL working. No CNAME is added to the dashboard repository.

## Deploy the package
1. Download `patient-portal-iis` from the successful `Patient portal IIS package` GitHub Actions run. Extract the ZIP contents into a directory dedicated to the portal, for example `C:\Sites\SwnwPatientPortal`. `index.html` and `web.config` must be at the site's physical root. This package contains the existing portal and its required assets, plus public Supabase URL/anon key only.
2. In IIS create a separate site named `SwnwPatientPortal`, physical path above, application pool with **No Managed Code**, and Static Content enabled. Give its app pool read permission on the directory. Do not change the public website's root or bindings.
3. Add an HTTPS binding for `portal.swnwclinics.com` on port 443, with SNI and a valid certificate covering this hostname. Use the server's current certificate process to issue/renew it. Do not enable an unencrypted portal login.
4. In the domain's DNS provider create an A record named `portal` pointing to the public IP of that IIS server. Obtain the IP from the website deployment owner, not a guessed address. If the website uses a proxy/load balancer, configure its portal hostname and TLS routing too. Do not change the apex, www, studio, MX or other existing records.
5. Test `https://portal.swnwclinics.com/?view=login`, `?view=activate`, `?view=reset`. Test login with an approved test account and confirm the requested patient account/files still enforce their existing Supabase permissions. Changing hostname does not transfer a session from GitHub; users log in on the new hostname.

## Switch password reset after HTTPS works
In Supabase Authentication URL Configuration add exactly:
- `https://portal.swnwclinics.com/?reset=1`
- Keep the existing GitHub portal reset URL allowed while the old portal remains supported.

Set the Edge Function secret `PATIENT_PORTAL_BASE_URL` to `https://portal.swnwclinics.com/`, then redeploy `patient-portal-self-service`. Do not change the project's global Site URL as an incidental portal change; other dashboard auth flows share the project.

The function retains the GitHub reset URL until this variable is set. It rejects invalid/unapproved destinations. Recovery on the new domain still uses Supabase's existing password recovery event and screen. Do not switch recovery email links before the hostname, certificate and allowed redirect are tested.

Set public website links to:
- login: `https://portal.swnwclinics.com/?view=login&returnUrl=https%3A%2F%2Fswnwclinics.com%2F`
- activation: `https://portal.swnwclinics.com/?view=activate`
- reset request: `https://portal.swnwclinics.com/?view=reset`

For staging, use the same login URL with an encoded `https://staging.swnwclinics.com/` returnUrl. Only the two previously configured website origins are permitted. Do not embed the portal in an iframe. Do not pass passwords, Supabase session tokens or patient details in website URLs.

## Updates and rollback
The package workflow rebuilds when portal/shared assets/public config change. Download and deploy the new package to this IIS site to update it. This is a build artifact, not automatic IIS deployment. Keep the previous package to roll back files. If the domain fails, clear `PATIENT_PORTAL_BASE_URL` and redeploy the self-service function to restore GitHub reset links. Keep DNS and TLS cleanup separate from application rollback.

## Checks performed in development
Node fixture test verifies both entry-point assets, unchanged portal files, sanitized public config, rejection of a service-role key, and refusal to overwrite existing output. The self-service TypeScript source is compiled for syntax validation. GitHub Actions builds the package from actual repository files. Windows IIS, DNS, certificate, Supabase redirect settings and real recovery emails require testing after deployment.
