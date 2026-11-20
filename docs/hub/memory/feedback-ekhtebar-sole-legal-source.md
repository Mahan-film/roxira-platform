---
name: feedback-ekhtebar-sole-legal-source
description: Iranian legal content for Smart Judge comes from ekhtebar.ir AND nezamat.ir (both owner-approved authoritative sources) — not for anything else
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-21T22:30:40.383Z
---

Scope: for **Iranian legal content used by Smart Judge** (laws, articles, amendments, cabinet resolutions, circulars, rulings, procedure, legal news) the accepted sources are **ekhtebar.ir, nezamat.ir and qavanin.ir** (owner added nezamat.ir and then qavanin.ir on 2026-10-13: comprehensive, citable, up to date; all three answer only Iranian IPs, so fetch from the owner's Mac with VPN off). Spot-check samples across the three; if texts match, use them. Never bypass a JS challenge/CAPTCHA (qavanin served one to the sandbox before) — if blocked, use another of the three. rc.majlis.ir / dotic.ir are not primary sources.

Not a general rule: for non-legal facts (hosting, tools, tech) use any fitting source ([[feedback-rule-naomidi-always-fallback]]).

**Why:** owner repeated the source rule several times; lawyer accepted ekhtebar with an "unofficial source" label (2026-10-13).

**How to apply:** corpus fills, law watch, golden checks, legal answers → ekhtebar + nezamat. Groq API only from the server IP.

Update 2026-10-22: owner reviewed ekhtebar fully and calls it complete and trustworthy; anything missing from our corpus must be researched there (e.g. tags بخشنامه-بانک-مرکزی, بخشنامه-ثبتی). ekhtebar.com = same site as ekhtebar.ir. srv1 CAN reach www.ekhtebar.ir now, and it has a public WordPress REST API (/wp-json/wp/v2/posts?search=, tags, categories) — prefer it over page scraping (taskq 18 ekhtebar-api).
