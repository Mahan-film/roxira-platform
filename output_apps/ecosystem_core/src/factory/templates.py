"""Production scaffold templates for the Roxira Software Foundry.

Each :class:`SandboxTemplate` describes a self-contained, minimal-but-runnable
project that the :class:`~output_apps.ecosystem_core.src.factory.ephemeral_runner.ComposeProjectGenerator`
materialises into a sandbox directory. Templates are plain text with ``{{key}}``
placeholders; rendering is a literal token replacement so JSON/JSX/Python braces
are never touched.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

__all__ = [
    "SandboxTemplate",
    "apply_context",
    "TEMPLATES",
    "FRAMEWORK_TEMPLATE_MAP",
    "select_template",
]


def apply_context(text: str, context: Mapping[str, str]) -> str:
    """Replace ``{{key}}`` tokens with their context value (literal, no format)."""
    for key, value in context.items():
        text = text.replace("{{" + key + "}}", value)
    return text


@dataclass(frozen=True)
class SandboxTemplate:
    template_id: str
    description: str
    container_port: int
    files: dict[str, str]

    def render(self, context: Mapping[str, str]) -> dict[str, str]:
        return {path: apply_context(content, context) for path, content in self.files.items()}


# ---------------------------------------------------------------------------
# 1) fastapi-microservice — lightweight REST service with health checks
# ---------------------------------------------------------------------------

_FASTAPI_MAIN = '''"""Generated FastAPI microservice (Roxira Software Foundry sandbox)."""

from __future__ import annotations

import os
import time

from fastapi import FastAPI

APP_ID = "{{app_id}}"
APP_NAME = "{{app_name_escaped}}"
BUILD_PROMPT = "{{prompt_escaped}}"
STARTED_AT = time.time()

app = FastAPI(title=APP_NAME or APP_ID, version="1.0.0")


@app.get("/health")
def health() -> dict:
    """Readiness/liveness payload used by the sandbox health probe."""
    return {
        "status": "healthy",
        "app_id": APP_ID,
        "uptime_seconds": round(time.time() - STARTED_AT, 3),
    }


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {
        "app_id": APP_ID,
        "app_name": APP_NAME,
        "prompt": BUILD_PROMPT,
        "runtime": os.getenv("ROXIRA_TEMPLATE", "fastapi-microservice"),
    }
'''

_FASTAPI_REQUIREMENTS = """fastapi==0.115.0
uvicorn[standard]==0.30.6
"""

_FASTAPI_DOCKERFILE = """FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE {{container_port}}
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "{{container_port}}"]
"""

FASTAPI_MICROSERVICE = SandboxTemplate(
    template_id="fastapi-microservice",
    description="Lightweight FastAPI REST microservice with /health and /healthz checks.",
    container_port=8000,
    files={
        "app/__init__.py": "",
        "app/main.py": _FASTAPI_MAIN,
        "requirements.txt": _FASTAPI_REQUIREMENTS,
        "Dockerfile": _FASTAPI_DOCKERFILE,
    },
)


# ---------------------------------------------------------------------------
# 2) nextjs-tailwind-landing — Next.js 16 standalone dark-mode landing
# ---------------------------------------------------------------------------

_NEXT_PACKAGE_JSON = """{
  "name": "{{app_id}}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "16.3.4",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
"""

_NEXT_CONFIG_TS = """import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
"""

_NEXT_TSCONFIG = """{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
"""

_NEXT_ENV_D_TS = """/// <reference types="next" />
/// <reference types="next/image-types/global" />
"""

_NEXT_POSTCSS = """const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
"""

_NEXT_GLOBALS_CSS = """@import "tailwindcss";
"""

_NEXT_LAYOUT = """import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "{{app_name_escaped}}",
  description: "{{prompt_escaped}}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
"""

_NEXT_PAGE = """export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.18),transparent_70%)]" />
      <section className="relative mx-auto flex max-w-4xl flex-col items-start gap-6 px-6 py-24">
        <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-semibold text-indigo-300">
          Generated by Roxira Software Foundry
        </span>
        <h1 className="text-4xl font-black leading-tight text-white">{{app_name}}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">{{prompt}}</p>
        <div className="flex flex-wrap gap-3">
          <a
            className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
            href="/api/health"
          >
            API Health
          </a>
          <a
            className="rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-slate-200"
            href="https://roxira.ir"
          >
            Roxira Enterprise OS
          </a>
        </div>
      </section>
    </main>
  );
}
"""

_NEXT_API_HEALTH = """import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "healthy", app_id: "{{app_id}}" });
}
"""

_NEXT_ROBOTS = """User-agent: *
Allow: /
"""

_NEXT_DOCKERIGNORE = """node_modules
.next
.git
"""

_NEXT_DOCKERFILE = """FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT={{container_port}}
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE {{container_port}}
CMD ["node", "server.js"]
"""

NEXTJS_TAILWIND_LANDING = SandboxTemplate(
    template_id="nextjs-tailwind-landing",
    description="Next.js 16 standalone boilerplate with a dark-mode Tailwind landing layout.",
    container_port=3000,
    files={
        "package.json": _NEXT_PACKAGE_JSON,
        "next.config.ts": _NEXT_CONFIG_TS,
        "tsconfig.json": _NEXT_TSCONFIG,
        "next-env.d.ts": _NEXT_ENV_D_TS,
        "postcss.config.mjs": _NEXT_POSTCSS,
        "app/globals.css": _NEXT_GLOBALS_CSS,
        "app/layout.tsx": _NEXT_LAYOUT,
        "app/page.tsx": _NEXT_PAGE,
        "app/api/health/route.ts": _NEXT_API_HEALTH,
        "public/robots.txt": _NEXT_ROBOTS,
        ".dockerignore": _NEXT_DOCKERIGNORE,
        "Dockerfile": _NEXT_DOCKERFILE,
    },
)


TEMPLATES: dict[str, SandboxTemplate] = {
    FASTAPI_MICROSERVICE.template_id: FASTAPI_MICROSERVICE,
    NEXTJS_TAILWIND_LANDING.template_id: NEXTJS_TAILWIND_LANDING,
}

FRAMEWORK_TEMPLATE_MAP: dict[str, str] = {
    "fastapi": "fastapi-microservice",
    "python": "fastapi-microservice",
    "nextjs": "nextjs-tailwind-landing",
    "next.js": "nextjs-tailwind-landing",
    "next": "nextjs-tailwind-landing",
    "react": "nextjs-tailwind-landing",
}

DEFAULT_TEMPLATE_ID = FASTAPI_MICROSERVICE.template_id


def select_template(target_framework: str | None) -> SandboxTemplate:
    """Resolve a target framework (or explicit template id) to a template."""
    key = (target_framework or "").strip().lower()
    if key in TEMPLATES:
        return TEMPLATES[key]
    return TEMPLATES[FRAMEWORK_TEMPLATE_MAP.get(key, DEFAULT_TEMPLATE_ID)]
