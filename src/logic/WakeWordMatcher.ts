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
/** Don't re-fire within this window of a hit. Volcano sends many
 *  partials per utterance (and, with result_type: "single", one final
 *  after 800 ms of silence). Without dedup we'd trigger Q&A repeatedly
 *  while the user is still saying the wake phrase. 3 s comfortably
 *  covers the time to utter "嘿 Nono" + the first half of the question
 *  before we lock out further triggers. */
const HIT_COOLDOWN_MS = 3000;

export class WakeWordMatcher {
  private needles: string[];
  private lastHitAt = 0;

  constructor(
    wakeWord: string,
    private onHit: (u: Utterance) => void,
  ) {
    this.needles = buildNeedles(wakeWord);
  }

  setWakeWord(w: string) {
    this.needles = buildNeedles(w);
  }

  /**
   * Observe every utterance — partial AND final.
   *
   * Historically we only matched on finals, but Volcano's definite
   * flag only flips after `end_window_size` ms of silence (800 ms).
   * If the user says "嘿 Nono" and then immediately continues the
   * question, the first partial of the whole sentence contains the
   * wake phrase but doesn't go definite for seconds — and the user
   * reported "nothing responds until I say it again." Firing on the
   * partial + a cooldown-based dedup closes that gap without causing
   * repeat triggers within a single wake event.
   */
  observe(u: Utterance) {
    const text = normalize(u.text);
    if (!text) return;
    for (const n of this.needles) {
      if (text.includes(n)) {
        const now = Date.now();
        if (now - this.lastHitAt < HIT_COOLDOWN_MS) return;
        this.lastHitAt = now;
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
 * Known spellings of the assistant's name, after normalize(): ASR
 * interchangeably returns "nono" / "NONO" / "no no" (normalized → "nono")
 * or the Chinese transliteration "诺诺". buildNeedles() treats any of
 * these as the same name so users who pronounce it slightly differently
 * (or whose ASR model prefers one writing) still trigger Q&A.
 */
const NAME_VARIANTS = ['nono', '诺诺'];

/**
 * Given a user-configured wake phrase, return a list of normalized patterns
 * to match against. If the user typed "嘿 Nono", we also accept
 *   嗨 Nono / 你好 Nono / 喂 Nono / plain Nono (on its own)
 * plus the same set with 诺诺 swapped in for Nono — so the app doesn't
 * fail to trigger because ASR heard "嗨" instead of "嘿" or transcribed
 * the name in pinyin rather than Latin letters.
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
      // If the name part of the canonical phrase matches one of the
      // known spellings, also generate needles for the other spellings
      // (so e.g. configured "嘿 Nono" also triggers on "嘿 诺诺").
      const names = NAME_VARIANTS.includes(rest) ? NAME_VARIANTS : [rest];
      for (const alt of prefixes) {
        for (const n of names) {
          set.add(normalize(alt) + n);
        }
      }
      // And the bare name, with no attention-getter — only if it's
      // non-trivial (avoid a single-char name matching everything).
      for (const n of names) {
        if (n.length >= 2) set.add(n);
      }
    }
  }

  return Array.from(set).filter((s) => s.length >= 2);
}
