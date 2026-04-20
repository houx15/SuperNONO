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

  it('applies amplitude scale when amplitude prop provided', () => {
    const { container } = render(<Orb state="activated" amplitude={0.5} />);
    const root = container.querySelector('.orb');
    expect(root?.getAttribute('style') ?? '').toMatch(/--amplitude:\s*0?\.5/);
  });

  it('falls back to timer animation when amplitude undefined', () => {
    const { container } = render(<Orb state="activated" />);
    const root = container.querySelector('.orb');
    expect(root?.getAttribute('style') ?? '').not.toMatch(/--amplitude/);
  });
});
