import type { Summary, Utterance, MeetingMeta } from './types';
import { activePrompts } from './prompts';

export interface LlmMinimal {
  complete(req: { prompt: string }): Promise<{ text: string }>;
}

export interface RenderInput {
  meta: MeetingMeta;
  summaries: Summary[];
  transcript: Utterance[];
}

interface ExtractedSections {
  decisions: string[];
  actions: { owner: string; task: string; tag: string }[];
}

export class MinutesRenderer {
  constructor(private llm: LlmMinimal) {}

  async render(input: RenderInput): Promise<string> {
    const sections = await this.extract(input);
    return [
      `# ${input.meta.title}`,
      '',
      `- Duration: ${secondsToHms(input.meta.duration_sec ?? 0)}`,
      `- Speakers: ${input.meta.speaker_count}`,
      `- Tag: ${input.meta.tag}`,
      '',
      '## Agenda',
      ...input.summaries.map((s) => `- ${s.topic}`),
      '',
      '## Key decisions',
      ...(sections.decisions.length
        ? sections.decisions.map((d) => `- ${d}`)
        : ['- (minutes generation unavailable — summaries preserved below)']),
      '',
      '## Action items',
      ...(sections.actions.length
        ? sections.actions.map((a) => `- **[${a.tag}]** ${a.owner} — ${a.task}`)
        : ['- (none extracted)']),
      '',
      '## Summaries',
      ...input.summaries.flatMap((s) => [`### ${s.time} — ${s.topic}`, s.text, '']),
      '## Full transcript',
      ...input.transcript.map((u) => `- [${fmtT(u.t)}] **${u.speaker}:** ${u.text}`),
      '',
    ].join('\n');
  }

  private async extract(input: RenderInput): Promise<ExtractedSections> {
    if (input.summaries.length === 0 && input.transcript.length === 0) {
      return { decisions: [], actions: [] };
    }
    const summariesJoined = input.summaries.map((s) => `${s.topic}: ${s.text}`).join('\n');
    const transcriptTail = input.transcript
      .map((u) => `[${u.speaker}] ${u.text}`)
      .join('\n')
      .slice(-2000);
    const prompt = activePrompts().buildMinutesExtractPrompt(summariesJoined, transcriptTail);
    try {
      const resp = await this.llm.complete({ prompt });
      const parsed = JSON.parse(resp.text) as Partial<ExtractedSections>;
      // Defensive: LLMs occasionally omit fields or return an unexpected
      // shape. Normalize so downstream consumers can rely on arrays.
      return {
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch {
      return { decisions: [], actions: [] };
    }
  }
}

function secondsToHms(s: number): string {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtT(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}
