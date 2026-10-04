// useScrollEdges.test.tsx – edge attributes follow scroll position (jsdom).
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScrollEdges } from '../useScrollEdges';

function Box() {
  const ref = useScrollEdges<HTMLDivElement>();
  return <div ref={ref} data-testid="box" />;
}

function setMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

describe('useScrollEdges', () => {
  it('fades only the bottom at the start, both in the middle, only the top at the end', () => {
    const { getByTestId } = render(<Box />);
    const el = getByTestId('box');
    setMetrics(el, 1000, 400);
    el.scrollTop = 0;
    fireEvent.scroll(el);
    expect(el).not.toHaveAttribute('data-edge-top');
    expect(el).toHaveAttribute('data-edge-bottom');

    el.scrollTop = 300;
    fireEvent.scroll(el);
    expect(el).toHaveAttribute('data-edge-top');
    expect(el).toHaveAttribute('data-edge-bottom');

    el.scrollTop = 600;
    fireEvent.scroll(el);
    expect(el).toHaveAttribute('data-edge-top');
    expect(el).not.toHaveAttribute('data-edge-bottom');
  });

  it('sets no edge when the content fits', () => {
    const { getByTestId } = render(<Box />);
    const el = getByTestId('box');
    setMetrics(el, 300, 400);
    fireEvent.scroll(el);
    expect(el).not.toHaveAttribute('data-edge-top');
    expect(el).not.toHaveAttribute('data-edge-bottom');
  });
});
