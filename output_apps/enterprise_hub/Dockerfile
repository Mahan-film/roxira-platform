# ==============================================================================
# Roxira Enterprise Hub — NestJS Production Dockerfile (Multi-stage)
# Enterprise App Layer (Controller-Service-DTO-Repository) — AGENTS.md Rule #2
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: dependencies — نصب کامل وابستگی‌ها (dev + prod) برای مرحله بیلد
# ------------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 2: builder — کامپایل TypeScript به JavaScript (nest build)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY main.ts app.module.ts ./
COPY modules ./modules

RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: prod-deps — فقط وابستگی‌های Production (بدون devDependencies)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 4: runner — ایمیج نهایی سبک و ایمن برای اجرای پروداکشن
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S nestjs && adduser -S nestjs -G nestjs \
    && apk add --no-cache curl python3 git bash docker-cli

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json

# اجرا با کاربر root: اندپوینت‌های رادار فناوری اسکریپت‌های پایتونی را روی
# ریشه پروژه (bind mount شده) اجرا و فایل‌های گزارش را بازنویسی می‌کنند و
# اسکریپت ازدحام به git و Docker CLI نیاز دارد. علاوه بر این سوکت Docker
# نیز در همین کانتینر mount می‌شود.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://127.0.0.1:3000/docs -o /dev/null -s || exit 1

CMD ["node", "dist/main.js"]
