# Publishing a Factory project to GitHub Pages

`.github/workflows/project-pages.yml` is the delivery step for a built static
Factory project (for example the #236 microsite). It builds one project under
`projects/<slug>/` and publishes its `out/` bundle to GitHub Pages. It runs on
GitHub Actions, never on the production server, and only on a manual dispatch.

## Owner one-time setup

1. In the repository, go to **Settings -> Pages -> Build and deployment** and set
   **Source** to **GitHub Actions**. No branch is published.
2. Mind the visibility: the repository is private, but **the published site is
   public** to anyone with the URL. Never publish a project that contains
   customer data, case data, or a service key.
3. Custom domain (optional): in **Settings -> Pages**, enter the domain, then add
   a DNS record at Cloudflare: a `CNAME` for the chosen host pointing to
   `mahan-films.github.io`, set to **DNS only** (grey cloud) so GitHub can issue
   its certificate; turn the Cloudflare proxy back on only after GitHub reports
   the domain verified.

## Running a deploy

**Actions -> Factory project pages -> Run workflow**, enter the project `slug`
(lowercase letters, digits, and hyphens only; the workflow rejects anything that
does not match `^[a-z0-9][a-z0-9-]{1,40}$`). The run:

- installs and builds `projects/<slug>/`, and fails if the build does not produce
  `projects/<slug>/out/index.html`;
- runs `python3 -m src.factory_pipeline.template_check projects/<slug>` as a
  report-only check (its findings never fail the run);
- uploads the `out/` directory as the Pages artifact, then deploys it.

The deployed URL is shown on the `deploy` job and in the **github-pages**
environment. Each dispatch replaces the whole published site, so only one project
is live at a time.

## Kill switches and access

- Set the repository variable `FACTORY_ENABLED` to anything other than `true` to
  disable every Factory workflow, including this one.
- Only actors listed in `AGENT_ALLOWED_ACTORS` (default `mahan-films`) may
  dispatch a run; the check runs in the job `if:` before any checkout.

## Unpublish

Set **Settings -> Pages -> Build and deployment -> Source** back to **None** to
remove the published site, and clear the custom domain if one was set. Dispatches
are also blocked as soon as `FACTORY_ENABLED` is no longer `true`.
