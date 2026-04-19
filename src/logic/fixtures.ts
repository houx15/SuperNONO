import type { Utterance } from './types';

export interface AsrFixtureEvent {
  atMs: number;
  speaker: string;
  text: string;
}

export interface AsrFixture {
  title: string;
  events: AsrFixtureEvent[];
  wakeWordAtEventIndex: number | null;
  qa?: { question: string; answer: string };
}

export interface DoubaoResponseRule {
  match: string;
  text: string;
}

export async function loadAsrFixture(name: string): Promise<AsrFixture> {
  const raw = await import(`../../fixtures/asr-transcripts/${name}.json`);
  return (raw.default ?? raw) as AsrFixture;
}

export async function loadDoubaoRules(): Promise<DoubaoResponseRule[]> {
  const raw = await import('../../fixtures/doubao-responses/default.json');
  return (raw.default ?? raw) as DoubaoResponseRule[];
}

export function utteranceFromEvent(e: AsrFixtureEvent, baseMs: number): Utterance {
  return { t: baseMs + e.atMs, speaker: e.speaker, text: e.text, final: true };
}
