# ==============================================================================
# Roxira Enterprise Hub Frontend — Next.js Production Dockerfile (Multi-stage)
# UI/UX Layer — Next.js App Router (AGENTS.md بخش ۱)
# با خروجی standalone برای کمینه‌سازی حجم ایمیج نهایی.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — نصب کامل وابستگی‌ها برای مرحله بیلد
# ------------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 2: builder — بیلد پروداکشن Next.js با خروجی standalone
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# آدرس واقعی سرویس NestJS در زمان بیلد برای rewrites (قابل override در ران‌تایم)
ARG NEST_API_ORIGIN=http://roxira_enterprise_backend:3000
ENV NEST_API_ORIGIN=${NEST_API_ORIGIN}
# آدرس واقعی موتور قاضی هوشمند (AI Core Layer — FastAPI/Python)
ARG JUDGE_API_ORIGIN=http://roxira_app_prod:8000
ENV JUDGE_API_ORIGIN=${JUDGE_API_ORIGIN}
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: runner — ایمیج نهایی سبک، فقط شامل خروجی standalone
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs \
    && apk add --no-cache curl

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://127.0.0.1:3001/ -o /dev/null -s || exit 1

CMD ["node", "server.js"]
