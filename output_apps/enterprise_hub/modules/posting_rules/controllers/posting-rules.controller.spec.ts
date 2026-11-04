import 'reflect-metadata';
import { validate } from 'class-validator';
import { SetRoleAccountDto } from '../dto/posting-rules.dto';
import { PostingRulesController } from './posting-rules.controller';

const T = '11111111-1111-4111-8111-111111111111';
const req = { user: { tenantId: T } } as never;

describe('PostingRulesController', () => {
  const service = { describe: jest.fn(async () => []), setMapping: jest.fn(), clearMapping: jest.fn() };
  const controller = new PostingRulesController(service as never);

  it('maps the "all" alias to the tenant-wide marker and uses the token tenant', async () => {
    await controller.set(req, 'all', 'bank', { accountCode: '1012' });
    await controller.clear(req, 'all', 'bank');
    await controller.set(req, 'payroll.run', 'bank', { accountCode: '1012' });
    expect(service.setMapping.mock.calls).toEqual([[T, '*', 'bank', '1012'], [T, 'payroll.run', 'bank', '1012']]);
    expect(service.clearMapping).toHaveBeenCalledWith(T, '*', 'bank');
  });

  it('the DTO rejects an empty or over-long account code', async () => {
    const dto = (accountCode: unknown) => Object.assign(new SetRoleAccountDto(), { accountCode });
    expect(await validate(dto('1012'))).toHaveLength(0);
    expect(await validate(dto(''))).not.toHaveLength(0);
    expect(await validate(dto('x'.repeat(33)))).not.toHaveLength(0);
    expect(await validate(dto(12))).not.toHaveLength(0);
  });
});
