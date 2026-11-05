import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PartyRole } from './enums/party-role.enum';
import { PartiesService } from './services/parties.service';

const T = '11111111-1111-4111-8111-111111111111';

function build(existing: Record<string, unknown> = {}) {
  const created: any[] = [];
  const repository: any = {
    list: jest.fn(async () => ({ rows: [], total: 0 })),
    findByCode: jest.fn(async (_t: string, code: string) => (code in existing ? { id: 9, code, name: 'قدیمی', role: 'customer', active: true } : null)),
    findById: jest.fn(async () => (existing['byId'] ? { id: 5, code: 'C5', name: 'قدیمی', role: 'customer', active: true } : null)),
    create: jest.fn(async (_t: string, input: any) => { const d = { id: 1, active: true, ...input }; created.push(d); return d; }),
    update: jest.fn(async (_t: string, id: number, patch: any) => ({ id, code: 'C5', ...patch })),
    findExistingCodes: jest.fn(async () => []),
    insertMany: jest.fn(async () => []),
    deleteByIds: jest.fn(async () => 0),
  };
  const service = new PartiesService(repository);
  return { service, repository, created };
}

describe('PartiesService.create', () => {
  it('trims code and name before insert', async () => {
    const { service, created } = build();
    await service.create(T, { code: ' C1 ', name: ' مشتری الف ', role: PartyRole.CUSTOMER } as never);
    expect(created[0]).toMatchObject({ code: 'C1', name: 'مشتری الف', active: true });
  });

  it('refuses a duplicate code with a Persian conflict message', async () => {
    const { service } = build({ C1: true });
    await expect(service.create(T, { code: 'C1', name: 'x', role: PartyRole.CUSTOMER } as never)).rejects.toThrow('کد طرف حساب تکراری است.');
  });
});

describe('PartiesService.getByCode', () => {
  it('throws NotFound with the Persian message when the code is unknown', async () => {
    const { service } = build();
    await expect(service.getByCode(T, 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getByCode(T, 'NOPE')).rejects.toThrow('طرف حساب یافت نشد.');
  });
});

describe('PartiesService.update', () => {
  it('throws NotFound when the party does not exist in this tenant', async () => {
    const { service } = build();
    await expect(service.update(T, 123, { name: 'x' } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it('passes the patch through and returns the updated row', async () => {
    const { service, repository } = build({ byId: true });
    const updated = await service.update(T, 5, { name: ' نو ', role: PartyRole.BOTH, active: false } as never);
    expect(repository.update.mock.calls[0]).toEqual([T, 5, { name: 'نو', role: PartyRole.BOTH, active: false }]);
    expect(updated).toMatchObject({ id: 5, name: 'نو', role: PartyRole.BOTH, active: false });
  });
});
