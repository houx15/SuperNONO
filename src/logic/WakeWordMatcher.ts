import type { Utterance } from './types';

/**
 * Normalizes both the wake phrase and each utterance before comparing.
 *
 * Aggressive normalization:
 *   - lowercase
 *   - strip ALL whitespace (ASR often returns "嘿Nono" when user said "嘿 Nono")
 *   - strip common CJK punctuation
 *
 * The matcher always checks against a *list* of phrases. Callers pass one
 * canonical wake word and we automatically expand it into a small set of
 * common variants so ASR fuzz ("嗨 Nono", "你好 Nono") still triggers.
 */
export class WakeWordMatcher {
  private needles: string[];

  constructor(
    wakeWord: string,
    private onHit: (u: Utterance) => void,
  ) {
    this.needles = buildNeedles(wakeWord);
  }

  setWakeWord(w: string) {
    this.needles = buildNeedles(w);
  }

  observe(u: Utterance) {
    if (!u.final) return;
    const text = normalize(u.text);
    for (const n of this.needles) {
      if (text.includes(n)) {
        this.onHit(u);
        return;
      }
    }
  }
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,.!?;:，。！？；：、]/g, '')
    .trim();
}

/**
 * Given a user-configured wake phrase, return a list of normalized patterns
 * to match against. If the user typed "嘿 Nono", we also accept
 *   嗨 Nono / 你好 Nono / 喂 Nono / plain Nono (on its own)
 * so the app doesn't fail to trigger because ASR heard "嗨" instead of "嘿".
 *
 * If the phrase doesn't contain one of the common leading Chinese
 * attention-getters, we only use the phrase as-is.
 */
export function buildNeedles(wakeWord: string): string[] {
  const canonical = normalize(wakeWord);
  if (!canonical) return [];
  const set = new Set<string>([canonical]);

  // Common CJK attention-getters. If the canonical phrase starts with any
  // of these, add variants with the other options in front.
  const prefixes = ['嘿', '嗨', '喂', '你好'];
  for (const p of prefixes) {
    if (canonical.startsWith(normalize(p))) {
      const rest = canonical.slice(normalize(p).length);
      for (const alt of prefixes) {
        set.add(normalize(alt) + rest);
      }
      // And the bare name, with no attention-getter — only if it's
      // non-trivial (avoid a single-char name matching everything).
      if (rest.length >= 2) set.add(rest);
    }
  }

  return Array.from(set).filter((s) => s.length >= 2);
}
