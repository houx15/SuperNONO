import { describe, it, expect, vi } from 'vitest';
import { WakeWordMatcher, buildNeedles, normalize } from './WakeWordMatcher';
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
  });

  it('matches ASR output without space: "嘿Nono"', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿Nono 帮我总结'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('fires on a partial as soon as the phrase is heard (no wait for definite)', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿 Nono,帮我查一下', false));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire within the cooldown window for follow-up partials', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿 Nono 帮我', false));
    m.observe(u('嘿 Nono 帮我总结', false));
    m.observe(u('嘿 Nono 帮我总结会议', true));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('hey nono', hit);
    m.observe(u('Hey  Nono , search this'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('accepts common alternate Chinese attention-getters', () => {
    // Fresh matcher per phrase so the 3 s cooldown doesn't swallow
    // back-to-back hits — this test is about variant coverage, not dedup.
    for (const phrase of ['嗨 Nono 帮我总结', '你好 Nono 现在几点了', '喂 Nono 查天气']) {
      const hit = vi.fn();
      const m = new WakeWordMatcher('嘿 Nono', hit);
      m.observe(u(phrase));
      expect(hit).toHaveBeenCalledTimes(1);
    }
  });

  it('accepts bare name once user has a prefix-style wake', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('Nono 帮我总结'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('punctuation inside the phrase does not block matching', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿，Nono，帮我看一下'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('does not fire on an unrelated long utterance', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('我们今天的议题是 Q2 的产品规划，重点在用户留存，需要讨论北极星指标的更新。'));
    expect(hit).not.toHaveBeenCalled();
  });

  it('updates wake word on setWakeWord', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('old', hit);
    m.setWakeWord('new');
    m.observe(u('say new please'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('buildNeedles expands 嘿 Nono into the expected variants', () => {
    const ns = buildNeedles('嘿 Nono');
    expect(ns).toContain('嘿nono');
    expect(ns).toContain('嗨nono');
    expect(ns).toContain('你好nono');
    expect(ns).toContain('喂nono');
    expect(ns).toContain('nono');
    // ASR sometimes transcribes the name as Chinese 诺诺 — these
    // needles must trigger too, or users whose ASR prefers pinyin
    // wouldn't be able to summon Nono at all.
    expect(ns).toContain('嘿诺诺');
    expect(ns).toContain('嗨诺诺');
    expect(ns).toContain('诺诺');
  });

  it('fires when ASR writes the name in Chinese (嘿 诺诺 / 诺诺)', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('嘿 诺诺，帮我查一下'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('fires on the bare Chinese name alone', () => {
    const hit = vi.fn();
    const m = new WakeWordMatcher('嘿 Nono', hit);
    m.observe(u('诺诺 今天的议题是什么'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('fires on "no no" and "NONO" (case + whitespace invariant)', () => {
    for (const variant of ['no no', 'NONO', 'No No']) {
      const hit = vi.fn();
      const m = new WakeWordMatcher('嘿 Nono', hit);
      m.observe(u(`嘿 ${variant}, 帮我查`));
      expect(hit).toHaveBeenCalledTimes(1);
    }
  });

  it('buildNeedles does NOT expand arbitrary phrases', () => {
    const ns = buildNeedles('open sesame');
    expect(ns).toEqual(['opensesame']);
  });

  it('normalize strips punctuation and whitespace', () => {
    expect(normalize('嘿， Nono！ ')).toBe('嘿nono');
    expect(normalize('Hey, Nono?')).toBe('heynono');
  });
});
