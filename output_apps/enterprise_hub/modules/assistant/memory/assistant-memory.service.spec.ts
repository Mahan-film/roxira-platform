import { BadRequestException } from '@nestjs/common';
import { AssistantMemoryRepository } from './assistant-memory.repository';
import { AssistantMemoryService } from './assistant-memory.service';

const T = '11111111-1111-4111-8111-111111111111';
const U = '99999999-9999-4999-8999-999999999999';

function make() {
  const repo = { remember: jest.fn().mockResolvedValue({ id: 'f' }), recall: jest.fn().mockResolvedValue([]), forget: jest.fn() };
  return { repo, service: new AssistantMemoryService(repo as unknown as AssistantMemoryRepository) };
}

describe('AssistantMemoryService', () => {
  it('stores a confirmed fact for the JWT tenant and user', async () => {
    const { repo, service } = make();
    await service.confirm(T, U, { subject: ' vat ', fact: ' 10 percent ' });
    expect(repo.remember).toHaveBeenCalledWith(T, expect.objectContaining({ subject: 'vat', fact: '10 percent', confirmedBy: U }));
  });

  it.each([['sk', 'or', 'v1', 'abcdefabcdefabcdefabcdef'].join('-'), 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'a'.repeat(40)])('refuses a secret-like fact (%s)', async (fact) => {
    const { repo, service } = make();
    expect(() => service.confirm(T, U, { subject: 's', fact })).toThrow(BadRequestException);
    expect(repo.remember).not.toHaveBeenCalled();
  });

  it('recall defaults to now and the current belief', async () => {
    const { repo, service } = make();
    await service.recall(T, {});
    expect(repo.recall).toHaveBeenCalledWith(T, expect.objectContaining({ knownAt: undefined, limit: 20 }));
  });

  it('forget of an unknown id is a 400', async () => {
    const { repo, service } = make();
    repo.forget.mockResolvedValue(false);
    await expect(service.forget(T, 'x')).rejects.toThrow(BadRequestException);
  });
});
