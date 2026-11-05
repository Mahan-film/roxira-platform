import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ProjectEntity } from '../entities/project.entity';
import { ProjectStatus } from '../enums/contracting.enum';

export interface ProjectInput {
  code: string;
  name: string;
  costCentreCode?: string | null;
  budget: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: ProjectStatus;
}

export interface ProjectPatch {
  name?: string;
  costCentreCode?: string | null;
  budget?: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: ProjectStatus;
}

export interface ProjectFilter {
  status?: ProjectStatus;
  search?: string;
  limit: number;
  offset: number;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class ProjectRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  list(tenantId: string, filter: ProjectFilter): Promise<{ rows: ProjectEntity[]; total: number }> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m
        .getRepository(ProjectEntity)
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId });
      if (filter.status) {
        qb.andWhere('p.status = :status', { status: filter.status });
      }
      if (filter.search) {
        qb.andWhere('(p.code ILIKE :pattern OR p.name ILIKE :pattern)', {
          pattern: `%${escapeLike(filter.search)}%`,
        });
      }
      const total = await qb.getCount();
      const rows = await qb.orderBy('p.code', 'ASC').limit(filter.limit).offset(filter.offset).getMany();
      return { rows, total };
    });
  }

  findByCode(tenantId: string, code: string): Promise<ProjectEntity | null> {
    return this.within(tenantId, undefined, (m) =>
      m.getRepository(ProjectEntity).findOne({ where: { tenantId, code } }),
    );
  }

  findById(tenantId: string, id: number): Promise<ProjectEntity | null> {
    return this.within(tenantId, undefined, (m) =>
      m.getRepository(ProjectEntity).findOne({ where: { tenantId, id } }),
    );
  }

  create(tenantId: string, input: ProjectInput): Promise<ProjectEntity> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(ProjectEntity);
      return repo.save(
        repo.create({
          ...input,
          status: input.status ?? ProjectStatus.ACTIVE,
          budget: input.budget ?? '0',
          tenantId,
        }),
      );
    });
  }

  async update(tenantId: string, id: number, patch: ProjectPatch): Promise<ProjectEntity | null> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(ProjectEntity);
      if (Object.keys(patch).length > 0) await repo.update({ id, tenantId }, patch);
      return repo.findOne({ where: { id, tenantId } });
    });
  }
}
