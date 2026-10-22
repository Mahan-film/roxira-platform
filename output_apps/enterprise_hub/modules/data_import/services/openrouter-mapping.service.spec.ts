import {
  buildMappingRequestBody,
  parseMappingContent,
  readCheapModelId,
  readRoleModelId,
  truncateCell,
} from './openrouter-mapping.service';

describe('truncateCell', () => {
  it('truncates to 40 characters by default', () => {
    expect(truncateCell('x'.repeat(100)).length).toBe(40);
    expect(truncateCell('short')).toBe('short');
    expect(truncateCell(null)).toBe('');
  });
});

describe('buildMappingRequestBody', () => {
  const headers = ['name', 'email', 'phone'];
  const rows = Array.from({ length: 10 }, (_, index) => [
    `name-${index}`,
    'a'.repeat(80),
    `0912${index}`,
  ]);

  it('sends at most 5 sample rows and truncates every cell to 40 chars', () => {
    const body = buildMappingRequestBody('deepseek/cheap-model', headers, rows);

    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.model).toBe('deepseek/cheap-model');

    const userMessage = JSON.parse(body.messages[1].content) as {
      columns: string[];
      sampleRows: string[][];
    };
    expect(userMessage.columns).toEqual(headers);
    expect(userMessage.sampleRows).toHaveLength(5);
    for (const row of userMessage.sampleRows) {
      for (const cell of row) {
        expect(cell.length).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('parseMappingContent', () => {
  it('keeps only known headers and allowed fields', () => {
    const content =
      '```json\n{"name":"fullName","email":"email","weird":"hacker","phone":"nope"}\n```';
    expect(parseMappingContent(content, ['name', 'email', 'phone'])).toEqual({
      name: 'fullName',
      email: 'email',
    });
  });

  it('throws when the model returns no JSON object', () => {
    expect(() => parseMappingContent('sorry, no mapping', ['name'])).toThrow();
  });
});

describe('readCheapModelId', () => {
  const yamlFixture = [
    'roles:',
    '  free:',
    '    models:',
    '      - id: qwen/qwen3.8-27b:free',
    '  cheap:',
    '    description: default chat',
    '    data_policy: standard',
    '    models:',
    '      # owner mandated primary',
    '      - id: deepseek/deepseek-v4.1-flash',
    '      - id: deepseek/deepseek-v4-flash-0731',
    '  strong:',
    '    models:',
    '      - id: deepseek/deepseek-v4-pro',
  ].join('\n');

  it('returns the first model id under the cheap role', () => {
    expect(readCheapModelId(yamlFixture)).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('returns null when the cheap role is absent', () => {
    expect(readCheapModelId('roles:\n  free:\n    models:\n      - id: x')).toBe(
      null,
    );
  });
});

describe('readRoleModelId', () => {
  const yamlFixture = [
    'roles:',
    '  cheap:',
    '    models:',
    '      - id: deepseek/deepseek-v4.1-flash',
    '  vision:',
    '    data_policy: standard',
    '    models:',
    '      - id: google/gemini-3.8-flash',
  ].join('\n');

  it('returns the first model id under any role', () => {
    expect(readRoleModelId(yamlFixture, 'vision')).toBe(
      'google/gemini-3.8-flash',
    );
    expect(readRoleModelId(yamlFixture, 'cheap')).toBe(
      'deepseek/deepseek-v4.1-flash',
    );
  });

  it('returns null for an unknown role', () => {
    expect(readRoleModelId(yamlFixture, 'nope')).toBeNull();
  });
});
