import type { OrbState } from '../logic/types';

interface Props {
  displayText: string;
  speaker: string | null;
  state: OrbState;
}

export function LiveTranscript({ displayText, speaker, state }: Props) {
  const TAIL_LEN = 22;
  const isTailing = displayText.length > TAIL_LEN;
  const tailText = isTailing ? displayText.slice(-TAIL_LEN) : displayText;

  const label = (
    {
      idle: 'Live transcript',
      activated: 'Captured input',
      thinking: 'Processing',
      speaking: 'Speaking',
    } as const
  )[state];

  return (
    <div className="live-transcript">
      <div className="live-label">
        <span className="pip" />
        {label}
      </div>
      <div className="live-text">
        <span className="transcript-scroll">
          <span className="transcript-inner">
            {speaker && <span className="speaker-tag">{speaker}</span>}
            {isTailing && <span className="transcript-prefix">… </span>}
            <span>{tailText}</span>
            {state !== 'speaking' && <span className="cursor-bar" />}
          </span>
        </span>
      </div>
    </div>
  );
}
