import { describe, it, expect } from 'vitest';
import { isFinalUtterance, makeMeetingId } from './types';

describe('types helpers', () => {
  it('recognizes a final utterance', () => {
    expect(isFinalUtterance({ t: 1, speaker: 'S1', text: 'hi', final: true })).toBe(true);
    expect(isFinalUtterance({ t: 1, speaker: 'S1', text: 'hi', final: false })).toBe(false);
  });

  it('mints a meeting id of shape mtg_xxxxxxxx', () => {
    const id = makeMeetingId();
    expect(id).toMatch(/^mtg_[0-9a-f]{8}$/);
  });
});
