# Zero-cost research stack

On the Hetzner host, create and export a SearXNG secret (do not commit it):

```sh
export SEARXNG_SECRET="$(openssl rand -hex 32)"
```

Start the stack from this directory:

```sh
docker compose up -d
```

Smoke-check the loopback-only endpoint:

```sh
curl -s '127.0.0.1:8888/search?q=test&format=json' | head -c 200
```

Set `SEARXNG_BASE_URL=http://127.0.0.1:8888` and `CRAWL4AI_BASE_URL=http://127.0.0.1:11235` for the application.
