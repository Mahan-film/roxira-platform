import 'reflect-metadata';
import { AiInteractionRepository } from './ai-interaction.repository';

describe('AiInteractionRepository', () => {
  const queryMock = jest.fn();
  const scopeMock = {
    run: jest.fn(async (_tenantId: string, fn: (em: any) => Promise<any>) => {
      return fn({ query: queryMock });
    }),
  };

  const repo = new AiInteractionRepository(scopeMock as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records an interaction and returns the row', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'mock-uuid',
        tenantId: 'tenant-123',
        questionHash: 'qhash',
        toolsAndArgs: [{ name: 'profit', arguments: {} }],
        model: 'model-a',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        costMinor: '0',
        latencyMs: 150,
        validatorVerdict: 'verified',
        customerDataFallback: false,
        createdAt: new Date(),
        expiresAt: new Date(),
      },
    ]);

    const result = await repo.record('tenant-123', {
      questionHash: 'qhash',
      toolsAndArgs: [{ name: 'profit', arguments: {} }],
      model: 'model-a',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      validatorVerdict: 'verified',
    });

    expect(scopeMock.run).toHaveBeenCalledWith('tenant-123', expect.any(Function));
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('mock-uuid');
    expect(result.validatorVerdict).toBe('verified');
  });

  it('lists recent interactions for a tenant', async () => {
    queryMock.mockResolvedValueOnce([
      { id: '1', questionHash: 'q1', model: 'm1' },
      { id: '2', questionHash: 'q2', model: 'm2' },
    ]);

    const rows = await repo.listRecent('tenant-123', 10);
    expect(scopeMock.run).toHaveBeenCalledWith('tenant-123', expect.any(Function));
    expect(rows).toHaveLength(2);
  });

  it('purges expired interactions with given manager', async () => {
    const manager = { query: jest.fn().mockResolvedValueOnce([{ id: '1' }, { id: '2' }]) };
    const count = await repo.purgeExpired(manager);
    expect(count).toBe(2);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ai_interactions WHERE expires_at < now()'),
    );
  });
});
