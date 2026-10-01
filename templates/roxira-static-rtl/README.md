# Roxira Static RTL

A minimal Persian, right-to-left microsite for GitHub Pages. Content is Markdown
read while Next.js builds the static export; it has no database or authentication.

## Use

```sh
npm install
npm run build
npm run dev
npx playwright test
```

The Playwright test expects the development server at
`http://127.0.0.1:3000`; set `PLAYWRIGHT_BASE_URL` to use another address.
Dependencies are pinned to versions verified on npm. No lockfile is included
because packages were not installed from a verified registry in this offline
template build; generate one only through your approved registry.
