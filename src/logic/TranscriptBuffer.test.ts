import { describe, it, expect } from 'vitest';
import { TranscriptBuffer } from './TranscriptBuffer';
import type { Utterance } from './types';

const u = (t: number, text: string, final = true, speaker = 'S1'): Utterance => ({
  t,
  speaker,
  text,
  final,
});

describe('TranscriptBuffer', () => {
  it('keeps finals in append order', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    expect(b.all().map((x) => x.text)).toEqual(['a', 'b']);
  });

  it('drops partials when a newer final arrives', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'hel', false));
    b.append(u(1200, 'hello', true));
    expect(b.all().map((x) => x.text)).toEqual(['hello']);
  });

  it('returns utterances since a timestamp', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    b.append(u(3000, 'c'));
    expect(b.sinceTimestamp(1500).map((x) => x.text)).toEqual(['b', 'c']);
  });

  it('returns text from the last N minutes', () => {
    const b = new TranscriptBuffer();
    b.append(u(0, 'old'));
    b.append(u(60_000 * 3, 'middle'));
    b.append(u(60_000 * 9, 'recent'));
    const out = b.lastNMinutes(2, 60_000 * 10);
    expect(out.map((x) => x.text)).toEqual(['recent']);
  });

  it('tracks last-summary-at watermark', () => {
    const b = new TranscriptBuffer();
    b.append(u(1000, 'a'));
    b.append(u(2000, 'b'));
    b.markSummarizedAt(1500);
    b.append(u(3000, 'c'));
    expect(b.sinceLastSummary().map((x) => x.text)).toEqual(['b', 'c']);
  });
});
