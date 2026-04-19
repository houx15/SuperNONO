import { describe, it, expect } from 'vitest';
import { FakeLlmClient } from './FakeLlmClient';

describe('FakeLlmClient', () => {
  it('returns the first matching response', async () => {
    const llm = new FakeLlmClient([
      { match: (p) => p.includes('summarising'), text: 'SUMMARY_RESP' },
      { match: () => true, text: 'DEFAULT_RESP' },
    ]);
    const r = await llm.complete({ prompt: 'You are summarising...' });
    expect(r.text).toBe('SUMMARY_RESP');
    const r2 = await llm.complete({ prompt: 'something else' });
    expect(r2.text).toBe('DEFAULT_RESP');
  });

  it('errors if no match and no default', async () => {
    const llm = new FakeLlmClient([]);
    await expect(llm.complete({ prompt: 'x' })).rejects.toThrow();
  });
});
