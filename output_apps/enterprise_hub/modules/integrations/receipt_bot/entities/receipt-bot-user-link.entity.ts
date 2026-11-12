import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('receipt_bot_user_links')
export class ReceiptBotUserLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'telegram_user_id', type: 'varchar', length: 64, unique: true })
  telegramUserId: string;

  @Column({ name: 'telegram_username', type: 'varchar', length: 128, nullable: true })
  telegramUsername: string | null;

  @Column({ name: 'default_kind', type: 'varchar', length: 32, default: 'petty_cash' })
  defaultKind: 'petty_cash' | 'purchase';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
