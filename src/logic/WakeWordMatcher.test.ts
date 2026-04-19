import { describe, it, expect, vi } from 'vitest';
import { WakeWordMatcher } from './WakeWordMatcher';
import type { Utterance } from './types';

const u = (text: string, final = true): Utterance => ({ t: 0, speaker: 'S1', text, final });

describe('WakeWordMatcher', () => {
  it('fires when the wake word appears in a final utterance', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('今天天气不错'));
    expect(hit).not.toHaveBeenCalled();
    m.observe(u('嘿 Nono,帮我查一下'));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0].text).toContain('嘿 Nono');
  });

  it('ignores partials', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿 Nono,帮我查一下', false));
    expect(hit).not.toHaveBeenCalled();
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('hey nono', hit);
    m.observe(u('Hey  Nono , search this'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('updates wake word on setWakeWord', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('old', hit);
    m.setWakeWord('new');
    m.observe(u('say new please'));
    expect(hit).toHaveBeenCalledTimes(1);
  });
});
