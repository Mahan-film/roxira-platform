import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface InteractionToolCall {
  name: string;
  arguments: Record<string, unknown>;
  ok?: boolean;
  error?: string | null;
}

@Entity('ai_interactions')
export class AiInteractionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'question_hash', type: 'character varying', length: 64 })
  questionHash: string;

  @Column({ name: 'tools_and_args', type: 'jsonb', default: () => "'[]'::jsonb" })
  toolsAndArgs: InteractionToolCall[];

  @Column({ type: 'character varying', length: 128 })
  model: string;

  @Column({ name: 'prompt_tokens', type: 'integer', default: 0 })
  promptTokens: number;

  @Column({ name: 'completion_tokens', type: 'integer', default: 0 })
  completionTokens: number;

  @Column({ name: 'total_tokens', type: 'integer', default: 0 })
  totalTokens: number;

  @Column({ name: 'cost_minor', type: 'bigint', default: 0 })
  costMinor: string;

  @Column({ name: 'latency_ms', type: 'integer', default: 0 })
  latencyMs: number;

  @Column({ name: 'validator_verdict', type: 'character varying', length: 32 })
  validatorVerdict: string;

  @Column({ name: 'customer_data_fallback', type: 'boolean', default: false })
  customerDataFallback: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
