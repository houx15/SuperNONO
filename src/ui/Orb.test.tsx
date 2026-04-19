import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Orb } from './Orb';
import type { OrbState } from '../logic/types';

describe('Orb', () => {
  it('renders without crashing for each state', () => {
    (['idle', 'activated', 'thinking', 'speaking'] as const satisfies readonly OrbState[]).forEach(
      (s) => {
        const { container } = render(<Orb state={s} />);
        expect(container.querySelector('svg')).toBeTruthy();
      },
    );
  });
});
