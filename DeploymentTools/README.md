# Task Management website deployment

Default deployment URL: **https://app.parallelsystems.com.au/task-management/**.
The SSH upload target remains `ubuntu@3.24.250.195`; the public site uses the domain.
Read-only EC2 checks on 2026-10-25 confirmed that this HTTPS origin serves all three
apps and API health. Requests using the old HTTP IP origin returned 404 before
release activation because it does not select the configured domain site.

Timesheet stays at `/`, Receipts at `/receipts/`, and the shared API at `/api`.
Task Management uses `/api/task-management` and its separate login cookie.

## Before deployment

- Deploy the updated `ParallelSystems.Server` using its existing deployment tools.
  This frontend launcher checks that the Task Management session endpoint exists;
  it does not deploy/restart the API or run SQL migrations.
- Commit all intended Task Management changes, including `DeploymentTools`.
  The launcher requires a clean Git repository, including untracked files.
  Keep unrelated archives outside this repository.
- Windows needs Git, Node.js 22.12+, npm, OpenSSH (`ssh`/`scp`) and curl.
- EC2 needs Nginx, Python 3.9+, Bash, unzip, curl, sha256sum, realpath, flock,
  systemctl and standard GNU file utilities. The SSH user needs sudo access.
- The default staging directory is `/home/ubuntu`. The default private-key path
  follows the existing Timesheet/Receipts tools; check the launcher's `KeyPath`
  parameter or provide your own. The key is not packaged or copied to EC2.
- Timesheet and `/health` must already work on the selected origin. If Receipts
  has an existing release, its route must also serve that release successfully.

## Deploy from Windows

Double-click `Deploy-ParallelSystems-TaskManagement.cmd`. Check the displayed
target, then type `YES` to deploy. Other answers cancel before any build/upload.

The launcher installs locked dependencies with `npm ci`, runs `npm test`, builds
with `--base=/task-management/`, then packages only compiled `dist` contents into
the sibling `Deployment/ParallelSystems.Web.TaskManagement.zip`. Source files,
environment files, credentials and `node_modules` are excluded. Small deployment
helpers are uploaded separately. The archive SHA-256 is checked before extraction.

The SSH command uses a Base64-encoded Bash wrapper to preserve quoting through
Windows PowerShell's native argument handling. The decoded wrapper enables
`set -Eeuo pipefail`, so a missing script, failed CRLF reader or remote deployment
failure stops the launcher. Older versions could print `sed` help and incorrectly
report success without installing the release; commit this fix before retrying.

For overrides, run from this folder:

```powershell
.\Deploy-ParallelSystems-TaskManagement.ps1 -SiteUrl https://app.parallelsystems.com.au
# For a custom origin that selects the existing domain-named Nginx site:
.\Deploy-ParallelSystems-TaskManagement.ps1 -SiteUrl https://YOUR_SITE_HOST -NginxHost app.parallelsystems.com.au
# Optional: -Server ubuntu@YOUR_EC2_HOST -KeyPath C:\path\to\key.pem
```

`SiteUrl` is the existing site origin, optionally ending in `/task-management/`.
`NginxHost` defaults to its hostname. Checks send that Host header to select the
existing Nginx virtual host. The build itself contains no EC2 hostname or IP.
Use the HTTPS origin if HTTP redirects to HTTPS. This tool uses the existing TLS
configuration and does not provision certificates. Use HTTPS for production login.

## EC2 layout and routing

```text
/var/www/parallel-systems-timesheet/current       existing Timesheet
/var/www/parallel-systems-receipts/current        existing Receipts
/var/www/parallel-systems-task-management/
  releases/<timestamp>-<unique-id>/task-management/
  current -> releases/<timestamp>-<unique-id>
/etc/nginx/snippets/parallel-systems-task-management.conf
/var/backups/parallel-systems-task-management/<release>/nginx/
```

The first deployment discovers active Nginx files with `nginx -T` and adds:

```nginx
include /etc/nginx/snippets/parallel-systems-task-management.conf;
```

It is inserted inside matching content-serving `server` blocks with the selected
`server_name` and root `/var/www/parallel-systems-timesheet/current`. A single
unambiguous unnamed default Timesheet configuration is also supported. Redirect-only
servers are skipped. Existing root, API/health proxies, Receipts include, and TLS
settings are preserved. Subsequent deployments do not duplicate the include.
Discovery reads externally included configuration, including Certbot's
`/etc/letsencrypt/options-ssl-nginx.conf`, without modifying it. Every planned
configuration write and rollback target must resolve inside `/etc/nginx`.
Conflicting Task Management locations or ambiguous sites cause the tool to stop.

For attachments, automatic setup also copies the existing direct `/api/` proxy
settings into a more specific `/api/task-management/` location in the managed
snippet. It sets `client_max_body_size 12m`, `client_body_timeout 180s`,
`proxy_read_timeout 180s` and `proxy_send_timeout 180s`, preserving upstream and
proxy headers. The file limit in the API remains 10 MiB; the extra request space
allows multipart overhead. The shared API location and other apps keep their
existing settings. Custom proxy rewrites, variable/custom URI targets, nested
locations or differing selected upstreams require manual setup before any write.

Routing redirects `/task-management` to `/task-management/` and supports client-side
routes, including `/task-management/tasks/{guid}`. Missing assets return 404.
Hashed assets have a one-year cache lifetime; HTML and the logo require revalidation.
No service worker or offline behavior is added. Using `expires` keeps inherited
site security headers intact.

The deployment acquires Task Management and Receipts deployment locks, because both
tools can edit the same Nginx site. Do not deploy Timesheet or make unrelated Nginx
changes during this operation. Backups restore the affected site file as a whole.

## Verification and rollback

Before activation, the helper compares the Timesheet route to its active index,
does the same for an existing Receipts release, and checks `/health`.
Failed preflight HTTP requests identify the app, checked URL and Host header,
and explicitly report that no release was activated.
An unauthenticated `GET /api/task-management/auth/me` must return 401, not a redirect,
404, or SPA fallback. This uses no employee credentials and performs no account/task writes.

After an atomic release symlink switch and `nginx -t`/reload, the helper retries
the Task Management shell up to ten times and requires HTTP 200 plus the exact
uploaded HTML hash. It verifies task/dashboard/project/notification deep links,
the bare-path redirect, logo, initial JS/CSS assets, and a missing-asset 404.
Timesheet and existing Receipts HTML must remain unchanged; API checks run again.
The last readiness response is retained in the private release-specific
`validation/task-shell.body` backup directory for diagnosis.

If remote activation or validation fails, the previous Task Management symlink
and backed-up Nginx configuration are restored and Nginx is tested/reloaded.
On the first deployment, only the newly installed current symlink and configuration
changes are removed. Failed releases and backups remain for inspection.
Rollback failures explicitly print `ROLLBACK NEEDS ATTENTION`.

A final check runs from Windows and compares the returned HTML SHA-256 with the
exact local build. HTTP 200 from a Timesheet fallback is rejected. Failure of this Windows-only check
after successful EC2 validation does not roll back the active release. Old releases,
backups and timestamped uploads remain available; no automatic pruning occurs.

After deployment, sign in, open a real task link and refresh it. Confirm Timesheet
and Receipts still work. Static checks do not verify signed-in application workflows.

For an operator-directed rollback, identify the exact previous target printed by
the successful deployment. Verify the task index exists there before switching:

```bash
sudo test -f /var/www/parallel-systems-task-management/releases/EXACT_PREVIOUS_RELEASE/task-management/index.html
# Continue only after this check succeeds, using a Task Management release.
sudo ln -s /var/www/parallel-systems-task-management/releases/EXACT_PREVIOUS_RELEASE /var/www/parallel-systems-task-management/current.manual-rollback
sudo mv -Tf /var/www/parallel-systems-task-management/current.manual-rollback /var/www/parallel-systems-task-management/current
sudo nginx -t
sudo systemctl reload nginx
```

## Manual Nginx setup

If automatic discovery rejects a custom layout, back up the correct active site,
install `task-management.nginx.conf` at the snippet path above, and insert its
include inside the existing content-serving server block. Preserve the current
Timesheet, Receipts, API, health and TLS settings. Test with `sudo nginx -t` before
reloading.

The static snippet contains frontend routing only. For uploads, also add a
specific `/api/task-management/` proxy location by copying the current `/api/`
upstream, headers and TLS/proxy settings; add the 12m/180s directives above.
Preserve `/api/task-management/` at the API: an upstream `proxy_pass` without a
URI is unchanged, while an existing `/api/` URI suffix must become
`/api/task-management/` in this more specific location. Avoid duplicating an
existing task API location. `SkipNginxSetup` does not configure upload limits.

Then run:

```powershell
.\Deploy-ParallelSystems-TaskManagement.ps1 -SkipNginxSetup
```

Release, route, asset, other-app and API checks still apply in this mode. A failure
rolls back the release but leaves the manually installed Nginx configuration intact.

## Local checks without deploying

From the Task Management repository:

```powershell
npm test
npm run build
python -B -m unittest discover -s DeploymentTools/tests -p 'test_*.py'
# Bash syntax check (Git Bash on Windows, or Bash on Linux):
bash -n DeploymentTools/deploy_task_management.sh
```

Python tests need Python 3.9+ and Bash. They use disposable fixtures under the
ignored `test-results` directory, mock Nginx/network/system operations, and never
connect to EC2. Node tests also check Windows launcher syntax, cancellation and
unsafe-argument rejection; those launcher checks are skipped on non-Windows hosts.
No third-party Python packages or new application dependencies are required.

Actual Nginx syntax, permissions, SSH connectivity and deployed URLs are verified
only during an explicitly authorized EC2 deployment.

SSH transport correction (2026-10-13): 36 local deployment checks and 42 Node tests
passed, including the actual Windows PowerShell native argument boundary,
CRLF/argument preservation, missing script and upstream/remote failure exits,
and rejected Timesheet/missing public HTML. Read-only SSH probes on EC2 verified
the new wrapper's successful output and preserved exit code 7. The production
Task Management route still served Timesheet before this fix; no frontend release
or Task Management Nginx include was installed. This fix was not deployed and
does not restart the API. Re-run the launcher after committing the changes.
