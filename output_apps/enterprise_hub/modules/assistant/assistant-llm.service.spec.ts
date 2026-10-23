import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  AssistantLlmService,
  buildCandidates,
  readRoleModelIds,
  selectAttempts,
} from './services/assistant-llm.service';

const YAML = `
roles:
  free:
    description: x
    models:
      - id: vendor/free-a:free
        price_per_1m: { in: 0, out: 0 }
      - id: vendor/free-b:free
  cheap:
    models:
      - id: vendor/paid-a
      - id: vendor/free-b:free
  strong:
    models:
      - id: vendor/strong
other:
  - id: not/a-model
`;

describe('model registry roles', () => {
  it('reads every id of a role in file order', () => {
    expect(readRoleModelIds(YAML, 'free')).toEqual([
      'vendor/free-a:free',
      'vendor/free-b:free',
    ]);
    expect(readRoleModelIds(YAML, 'strong')).toEqual(['vendor/strong']);
  });

  it('puts free models first and paid as fallback, without duplicates', () => {
    expect(buildCandidates(YAML)).toEqual([
      { id: 'vendor/free-a:free', role: 'free' },
      { id: 'vendor/free-b:free', role: 'free' },
      { id: 'vendor/paid-a', role: 'cheap' },
    ]);
  });

  it('finds free and cheap models in the real config/models.yaml', () => {
    const text = fs.readFileSync(
      path.resolve(__dirname, '../../../../config/models.yaml'),
      'utf8',
    );
    const candidates = buildCandidates(text);
    expect(candidates[0].role).toBe('free');
    expect(candidates.some((c) => c.role === 'cheap')).toBe(true);
  });
});

describe('AssistantLlmService', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'assistant-'));
  const file = path.join(dir, 'models.yaml');
  fs.writeFileSync(file, YAML);

  const configWith = (values: Record<string, string>) =>
    ({
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    }) as never;

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('falls back from a failing free model to the paid one with data_collection deny', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.model !== 'vendor/paid-a') {
        return { ok: false, status: 429 } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'پاسخ', tool_calls: [] } }],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const service = new AssistantLlmService(
      configWith({ OPENROUTER_API_KEY: 'test', MODELS_CONFIG_PATH: file }),
    );
    const turn = await service.complete([{ role: 'user', content: 'x' }], []);

    expect(turn).toEqual({ model: 'vendor/paid-a', content: 'پاسخ', toolCalls: [] });
    expect(bodies.map((b) => b.model)).toEqual([
      'vendor/free-a:free',
      'vendor/free-b:free',
      'vendor/paid-a',
    ]);
    expect(bodies[0].provider).toBeUndefined();
    expect(bodies[2].provider).toEqual({ data_collection: 'deny' });
  });

  it('refuses without a server key and never calls the network', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new AssistantLlmService(configWith({ MODELS_CONFIG_PATH: file }));
    await expect(
      service.complete([{ role: 'user', content: 'x' }], []),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores tool calls when tool_choice is none', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'متن',
              tool_calls: [{ id: '1', type: 'function', function: { name: 'a', arguments: '{}' } }],
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;
    const service = new AssistantLlmService(
      configWith({ OPENROUTER_API_KEY: 'test', MODELS_CONFIG_PATH: file }),
    );
    const turn = await service.complete([{ role: 'user', content: 'x' }], [], 'none');
    expect(turn.toolCalls).toEqual([]);
  });

  it('never drops the paid fallback behind many free models', () => {
    const many = [
      ...['a', 'b', 'c', 'd', 'e'].map((n) => ({ id: `f/${n}:free`, role: 'free' })),
      { id: 'p/one', role: 'cheap' },
      { id: 'p/two', role: 'cheap' },
    ];
    expect(selectAttempts(many).map((c) => c.id)).toEqual([
      'f/a:free',
      'f/b:free',
      'f/c:free',
      'p/one',
      'p/two',
    ]);
  });

  it('stops trying models once the total deadline has passed', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new AssistantLlmService(
      configWith({ OPENROUTER_API_KEY: 'test', MODELS_CONFIG_PATH: file }),
    );
    await expect(
      service.complete([{ role: 'user', content: 'x' }], [], 'auto', Date.now() - 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
