import { useCallback, useEffect, useRef, useState } from 'react';
import { MeetingSession } from '../logic/MeetingSession';
import { RealClock } from '../logic/clock';
import type { AiExchange, OrbState, Summary, Utterance } from '../logic/types';
import type {
  AsrClient,
  E2eClient,
  LlmClient,
  MicCaptureHandle,
  Persistence,
} from '../logic/adapters';

export interface UseMeetingSessionDeps {
  asr: AsrClient;
  e2e: E2eClient;
  llm: LlmClient;
  persistence: Persistence;
  mic: MicCaptureHandle;
  wakeWord: string;
  lang: 'zh' | 'en';
}

export function useMeetingSession(deps: UseMeetingSessionDeps) {
  const sessionRef = useRef<MeetingSession | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [activeSummary] = useState<Summary | null>(null);
  const [currentExchange, setCurrentExchange] = useState<AiExchange | null>(null);
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [liveText, setLiveText] = useState('');
  const [liveSpeaker, setLiveSpeaker] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState<'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended'>(
    'idle',
  );
  const [amplitude, setAmplitude] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const start = useCallback(
    async (title: string) => {
      const session = new MeetingSession({
        asr: deps.asr,
        e2e: deps.e2e,
        llm: deps.llm,
        persistence: deps.persistence,
        mic: deps.mic,
        clock: new RealClock(),
        config: { wakeWord: deps.wakeWord, lang: deps.lang },
      });
      sessionRef.current = session;

      session.on('transcript', (u) => {
        const ut = u as Utterance;
        setLiveText(ut.text);
        setLiveSpeaker(ut.speaker);
      });
      session.on('summary', (s) => setSummaries((prev) => [...prev, s as Summary]));
      session.on('qa', (x) => setCurrentExchange(x as AiExchange));
      session.on('orbState', (s) => {
        // orbState events carry either an OrbState string (from QaHandoff)
        // or { amplitude: number } (from mic rms). Handle both.
        if (typeof s === 'string') {
          setOrbState(s as OrbState);
        } else if (s != null && typeof (s as { amplitude?: number }).amplitude === 'number') {
          setAmplitude((s as { amplitude: number }).amplitude);
        }
      });
      session.on('statusChange', (s) => {
        setStatus(s as 'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended');
      });
      session.on('error', (e) => {
        const err = e as { code?: string; message?: string } | null;
        setLastError(err?.code ?? err?.message ?? 'unknown');
      });

      await session.start(title);
      setMeetingId(session.id);
      setElapsedSec(0);
      setStatus('listening');
    },
    [deps.asr, deps.e2e, deps.llm, deps.persistence, deps.mic, deps.wakeWord, deps.lang],
  );

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
    setStatus('ended');
    setAmplitude(null);
  }, []);

  const resume = useCallback(async () => {
    const session = sessionRef.current;
    if (
      session &&
      typeof (session as unknown as { resume?: () => Promise<void> }).resume === 'function'
    ) {
      await (session as unknown as { resume: () => Promise<void> }).resume();
    }
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [meetingId]);

  return {
    start,
    stop,
    resume,
    meetingId,
    summaries,
    activeSummary,
    currentExchange,
    orbState,
    liveText,
    liveSpeaker,
    elapsedSec,
    status,
    amplitude,
    lastError,
    setLastError,
  };
}
