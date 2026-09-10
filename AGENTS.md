# ROXIRA AUTONOMOUS ENGINEERING STANDARD (AGENTS.md)

## 1. System Architecture & Boundaries
- **AI Core Layer (Python / FastAPI)**: Strictly located under `output_apps/generated_modules/smartjudge/`. Handles NLP, Qdrant vectors, PostgreSQL LightRAG graph CTE, and legal inference. Exposes OpenAPI/REST.
- **Enterprise App Layer (NestJS / TypeScript)**: Strictly adheres to modular Controller-Service-DTO-Repository pattern.
- **UI/UX Layer**: Next.js App Router with Tailwind CSS and shadcn/ui composable components.

## 2. Mandatory NestJS Engineering Rules (agent-nestjs-skills)
1. **No Circular Dependencies**: Never import modules in a circular cycle; use forwardRef() only when strictly unavoidable.
2. **Strict DTO Validation**: Every HTTP endpoint must have a dedicated class with `class-validator` and `class-transformer` decorators.
3. **Repository Pattern**: Never query database directly from controllers. Business logic belongs to Services, persistence to Repositories.
4. **Contract-First Synchronization**: Always generate OpenAPI/Swagger schemas before writing client API hooks.
5. **Zero Hardware Waste**: Optimize asynchronous tasks using Redis Streams / BullMQ.

## 3. Tool & Model Orchestration
- **Architect/Planner**: `anthropic/claude-sonnet-5` (Deep system reasoning & schema design)
- **Fast Coder/Editor**: `deepseek/deepseek-v4-flash-0731` / `deepseek/deepseek-v4-pro`
- **Triage/Format Checker**: `google/gemini-3.5-flash-lite`
