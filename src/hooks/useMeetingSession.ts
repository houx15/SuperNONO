import { useCallback, useEffect, useRef, useState } from 'react';
import { MeetingSession } from '../logic/MeetingSession';
import { RealClock } from '../logic/clock';
import { AnswerAudioPlayer } from '../audio/AnswerAudioPlayer';
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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioPlayerRef = useRef<AnswerAudioPlayer | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [activeSummary] = useState<Summary | null>(null);
  const [currentExchange, setCurrentExchange] = useState<AiExchange | null>(null);
  /** Partial question / answer text while a Q&A turn is in progress.
   *  Surfaces in the UI so the user can see what Nono heard and what
   *  Nono is saying, instead of a silent orb. */
  const [liveQa, setLiveQa] = useState<{ question: string; answer: string }>({
    question: '',
    answer: '',
  });
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [liveText, setLiveText] = useState('');
  const [liveSpeaker, setLiveSpeaker] = useState<string | null>(null);
  /** Wall-clock ms of the last transcript event (partial or final). The UI
   *  uses this to surface a "stuck" warning if no activity for N seconds. */
  const [lastTranscriptAt, setLastTranscriptAt] = useState<number | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState<'idle' | 'listening' | 'reconnecting' | 'paused' | 'ended'>(
    'idle',
  );
  const [amplitude, setAmplitude] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const start = useCallback(
    async (title: string) => {
      // The AudioContext must be created inside a user gesture (Start
      // Meeting click); constructing it earlier can leave it suspended on
      // macOS WKWebView and the TTS playback will be silent. Keep one per
      // meeting and close it on stop.
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {});
      }
      audioPlayerRef.current = new AnswerAudioPlayer(audioCtxRef.current);

      const session = new MeetingSession({
        asr: deps.asr,
        e2e: deps.e2e,
        llm: deps.llm,
        persistence: deps.persistence,
        mic: deps.mic,
        clock: new RealClock(),
        config: { wakeWord: deps.wakeWord, lang: deps.lang },
        audioPlayer: audioPlayerRef.current,
      });
      sessionRef.current = session;

      session.on('transcript', (u) => {
        const ut = u as Utterance;
        setLiveText(ut.text);
        setLiveSpeaker(ut.speaker);
        setLastTranscriptAt(Date.now());
      });
      session.on('summary', (s) => setSummaries((prev) => [...prev, s as Summary]));
      session.on('qa', (x) => setCurrentExchange(x as AiExchange));
      session.on('qaLive', (l) => setLiveQa(l as { question: string; answer: string }));
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

      // Reset per-meeting state so a second meeting in the same app session
      // doesn't show the previous meeting's transcript.
      setLastTranscriptAt(null);
      setSummaries([]);
      setLiveText('');
      setLiveSpeaker(null);
      setLiveQa({ question: '', answer: '' });
      await session.start(title);
      setMeetingId(session.id);
      setElapsedSec(0);
      setStatus('listening');
    },
    [deps.asr, deps.e2e, deps.llm, deps.persistence, deps.mic, deps.wakeWord, deps.lang],
  );

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
    audioPlayerRef.current?.stop();
    audioPlayerRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
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

  const cancelQa = useCallback(() => {
    sessionRef.current?.cancelQa();
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
    cancelQa,
    meetingId,
    summaries,
    activeSummary,
    currentExchange,
    liveQa,
    orbState,
    liveText,
    liveSpeaker,
    lastTranscriptAt,
    elapsedSec,
    status,
    amplitude,
    lastError,
    setLastError,
  };
}
