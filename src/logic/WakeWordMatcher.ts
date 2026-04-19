import type { Utterance } from './types';

export class WakeWordMatcher {
  private needle: string;

  constructor(
    wakeWord: string,
    private onHit: (u: Utterance) => void,
  ) {
    this.needle = normalize(wakeWord);
  }

  setWakeWord(w: string) {
    this.needle = normalize(w);
  }

  observe(u: Utterance) {
    if (!u.final) return;
    if (normalize(u.text).includes(this.needle)) this.onHit(u);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
