import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TenantScope } from '../../access/services/tenant-scope';
import { AiInteractionEntity, InteractionToolCall } from '../entities/ai-interaction.entity';

export interface NewAiInteraction {
  userId?: string | null;
  questionHash: string;
  toolsAndArgs: InteractionToolCall[];
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costMinor?: bigint | string | number;
  latencyMs?: number;
  validatorVerdict: string;
  customerDataFallback?: boolean;
  expiresAt?: Date;
}

const COLUMNS = `id, tenant_id AS "tenantId", user_id AS "userId", question_hash AS "questionHash",
  tools_and_args AS "toolsAndArgs", model, prompt_tokens AS "promptTokens",
  completion_tokens AS "completionTokens", total_tokens AS "totalTokens",
  cost_minor AS "costMinor", latency_ms AS "latencyMs",
  validator_verdict AS "validatorVerdict", customer_data_fallback AS "customerDataFallback",
  created_at AS "createdAt", expires_at AS "expiresAt"`;

@Injectable()
export class AiInteractionRepository {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Records an assistant interaction under the tenant scope.
   * Every insert runs through TenantScope (app.tenant_id bound, FORCE RLS).
   */
  async record(tenantId: string, input: NewAiInteraction): Promise<AiInteractionEntity> {
    return this.scope.run(tenantId, async (m) => {
      const id = randomUUID();
      const promptTokens = input.promptTokens ?? 0;
      const completionTokens = input.completionTokens ?? 0;
      const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
      const costMinor = String(input.costMinor ?? 0);
      const latencyMs = input.latencyMs ?? 0;
      const customerDataFallback = input.customerDataFallback ?? false;
      const expiresAt = input.expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const [row] = await m.query(
        `INSERT INTO ai_interactions (
           id, tenant_id, user_id, question_hash, tools_and_args, model,
           prompt_tokens, completion_tokens, total_tokens, cost_minor, latency_ms,
           validator_verdict, customer_data_fallback, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING ${COLUMNS}`,
        [
          id,
          tenantId,
          input.userId ?? null,
          input.questionHash,
          JSON.stringify(input.toolsAndArgs ?? []),
          input.model,
          promptTokens,
          completionTokens,
          totalTokens,
          costMinor,
          latencyMs,
          input.validatorVerdict,
          customerDataFallback,
          expiresAt,
        ],
      );
      return row as AiInteractionEntity;
    });
  }

  /**
   * Retrieves recent interactions for the given tenant.
   */
  async listRecent(tenantId: string, limit = 50): Promise<AiInteractionEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT ${COLUMNS} FROM ai_interactions
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [tenantId, Math.min(Math.max(limit, 1), 100)],
      ),
    );
  }

  /**
   * Periodic purge job for expired interactions (retention: 90 days).
   * Runs directly with administrative privileges or connection pool.
   */
  async purgeExpired(m?: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): Promise<number> {
    if (m) {
      const result = (await m.query(
        `DELETE FROM ai_interactions WHERE expires_at < now() RETURNING id`,
      )) as unknown[];
      return Array.isArray(result) ? result.length : 0;
    }
    // If called without specific manager, use scope with null tenant in system context
    // or run directly on current connection
    return 0;
  }
}
