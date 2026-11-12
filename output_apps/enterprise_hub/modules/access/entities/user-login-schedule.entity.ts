import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export interface LoginTimeWindow {
  /** Day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday */
  dayOfWeek: number;
  /** Start time in minutes from midnight (0..1439) */
  startMinute: number;
  /** End time in minutes from midnight (0..1439) */
  endMinute: number;
}

@Entity('user_login_schedules')
@Unique(['tenantId', 'userId'])
export class UserLoginScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'timezone', type: 'varchar', length: 64, default: 'Asia/Tehran' })
  timezone: string;

  @Column({ name: 'enforce_schedule', type: 'boolean', default: true })
  enforceSchedule: boolean;

  @Column({ name: 'windows', type: 'jsonb', default: () => "'[]'" })
  windows: LoginTimeWindow[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
