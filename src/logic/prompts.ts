//! LLM prompt bundles for summaries, minutes extraction, and Q&A system
//! preamble. Two languages are defined here; default is Chinese (zh).
//! When we add a language setting later, the bundle can be picked at
//! runtime without touching the call sites.

import type { Summary } from './types';

export type PromptLang = 'zh' | 'en';

export interface PromptBundle {
  /** Prompt for the periodic rolling summary. Response must be JSON:
   *  { "topic": "...", "text": "...", "sameTopic": bool }. */
  buildSummaryPrompt(prev: Summary | null, recentTranscript: string): string;

  /** Prompt for final-minutes extraction. Response must be JSON:
   *  { "decisions": string[], "actions": [{owner, task, tag}] }. */
  buildMinutesExtractPrompt(summariesJoined: string, transcriptTail: string): string;

  /** Static system preamble for wake-word Q&A; followed by context + question. */
  qaSystemPreamble: string;
}

/* ------------------------------------------------------------------ */
/*                           CHINESE (default)                         */
/* ------------------------------------------------------------------ */

/** Shared boilerplate that tells the LLM how to interpret the word
 *  "Nono" in raw transcripts. Without this, summaries misread lines
 *  like "嘿 Nono，查一下价格" as a meeting attendee literally saying
 *  "no no" in English (user report: "有位会议者英文否定，说了nono,但
 *  是没有解释原因"). The transcript may contain the wake phrase and
 *  the question that followed because ASR captures everything; those
 *  turns are directed to the AI assistant and MUST NOT be treated as
 *  meeting content. */
const NONO_CONTEXT_ZH =
  '注意："Nono"（或 SuperNono、嘿 Nono、嗨 Nono、你好 Nono、喂 Nono）是本会议中 AI 助手的唤醒词，类似 "Hey Siri"。' +
  '任何以这些短语开头或包含它们的句子都是对 AI 助手的提问，不属于会议内容——请在摘要、决策、待办中忽略这类句子。';
const NONO_CONTEXT_EN =
  'Note: "Nono" (also SuperNono, "hey Nono", "hi Nono") is the wake word for this meeting\'s AI ' +
  'assistant, analogous to "Hey Siri". Any sentence starting with or containing these phrases is a ' +
  'question directed AT the assistant, not meeting content. Exclude such sentences from summaries, ' +
  'decisions, and action items.';

const PROMPTS_ZH: PromptBundle = {
  buildSummaryPrompt(prev, recent) {
    return [
      '你是会议助手，正在为一段持续进行中的会议生成滚动摘要。',
      NONO_CONTEXT_ZH,
      '基于下方的「上一段摘要」和「新增对话」，请以 **中文** 返回严格 JSON：',
      '{"topic": "本段主题 (≤15字)", "text": "2-4 句要点", "sameTopic": bool}',
      '若主题与上一段相同，则 sameTopic=true，调用方会把新内容并入旧摘要。',
      '严格输出 JSON，不要加注释或 markdown。',
      '---上一段摘要---',
      prev ? prev.topic + '\n' + prev.text : '（无）',
      '---新增对话---',
      recent,
    ].join('\n');
  },
  buildMinutesExtractPrompt(summariesJoined, transcriptTail) {
    return [
      '你是会议纪要助手，请从以下会议内容中抽取「决策」和「待办事项」。',
      NONO_CONTEXT_ZH,
      '请以 **中文** 返回严格 JSON：',
      '{"decisions": string[], "actions": [{"owner": string, "task": string, "tag": string}]}',
      '- decisions：本次会议达成的结论或决定（每条 ≤ 30 字）',
      '- actions：明确的待办事项。owner 是负责人（没有写"待定"），task 是具体动作，tag 是 1-2 字的分类标签（如"设计"、"工程"、"运营"）',
      '严格输出 JSON，不要加注释或 markdown。',
      '---各段摘要---',
      summariesJoined,
      '---对话尾段 (最近约 2000 字)---',
      transcriptTail,
    ].join('\n');
  },
  qaSystemPreamble:
    '你的名字叫 Nono（也叫 SuperNono）——一位参与本次会议的 AI 助手。当用户喊"嘿 Nono"' +
    '或直接叫你的名字，就是在和你说话。请用 **中文** 简洁回答，仅基于下方提供的会议上下文。' +
    '如上下文中没有答案，请如实说明"会议中暂未提及"。',
};

/* ------------------------------------------------------------------ */
/*                          ENGLISH (optional)                         */
/* ------------------------------------------------------------------ */

const PROMPTS_EN: PromptBundle = {
  buildSummaryPrompt(prev, recent) {
    return [
      'You are a meeting assistant summarising an ongoing segment.',
      NONO_CONTEXT_EN,
      'Given the PREVIOUS segment summary and the NEW transcript, return strict JSON:',
      '{"topic": "topic ≤15 chars", "text": "2-4 sentences", "sameTopic": bool}',
      'If the topic is unchanged, set sameTopic=true; the caller may merge.',
      'Return JSON only — no comments, no markdown.',
      '---PREVIOUS---',
      prev ? prev.topic + '\n' + prev.text : '(none)',
      '---NEW TRANSCRIPT---',
      recent,
    ].join('\n');
  },
  buildMinutesExtractPrompt(summariesJoined, transcriptTail) {
    return [
      'You are extracting meeting decisions and action items. Return strict JSON:',
      NONO_CONTEXT_EN,
      '{"decisions": string[], "actions": [{"owner": string, "task": string, "tag": string}]}',
      '- decisions: ≤ 30-char conclusions reached in the meeting',
      '- actions: specific follow-ups. owner = assignee (use "TBD" if unclear), task = concrete action, tag = 1-2 word category',
      'Return JSON only — no comments, no markdown.',
      '---SUMMARIES---',
      summariesJoined,
      '---TRANSCRIPT (last ~2000 chars)---',
      transcriptTail,
    ].join('\n');
  },
  qaSystemPreamble:
    'Your name is Nono (also SuperNono) — an AI assistant joining this meeting. When a user says ' +
    '"hey Nono" or calls you by name, they are talking to you. Answer concisely, in the same ' +
    'language as the question, based only on the discussion context below. If the context does not ' +
    'contain the answer, say so plainly.',
};

export const PROMPT_BUNDLES: Record<PromptLang, PromptBundle> = {
  zh: PROMPTS_ZH,
  en: PROMPTS_EN,
};

export const DEFAULT_PROMPT_LANG: PromptLang = 'zh';

/** Convenience: grab the currently-active bundle. */
export function activePrompts(lang: PromptLang = DEFAULT_PROMPT_LANG): PromptBundle {
  return PROMPT_BUNDLES[lang];
}
