/**
 * IncidentFlowDiagram.test.tsx — the incident process diagram: every node and
 * edge renders, the current step is marked, a node opens its explanation (EN
 * and DE) and Escape closes it, the layout follows the container width
 * (ResizeObserver mocked) and falls back to matchMedia, and the section
 * remembers its collapsed state in localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FLOW_EDGES, FLOW_NODES, currentFlowStep } from '../../../lib/incidentFlow';
import { en } from '../../../i18n/en';
import { de } from '../../../i18n/de';
import { IncidentFlowDiagram } from '../IncidentFlowDiagram';
import { INCIDENT_FLOW_STORAGE_KEY, IncidentFlowSection } from '../IncidentFlowSection';

type Callback = (entries: Array<{ contentRect: { width: number } }>) => void;
let observers: Callback[] = [];

class FakeResizeObserver {
  constructor(cb: Callback) {
    observers.push(cb);
  }
  observe() {}
  disconnect() {}
}

function resizeTo(width: number) {
  act(() => {
    for (const cb of observers) cb([{ contentRect: { width } }]);
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IncidentFlowDiagram', () => {
  it('renders every node and edge, with the branch pills', () => {
    const { container } = renderWithProviders(<IncidentFlowDiagram />);
    for (const n of FLOW_NODES) {
      expect(container.querySelector(`[data-node="${n.id}"] button`)).not.toBeNull();
    }
    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(FLOW_EDGES.length);
    const pills = Array.from(container.querySelectorAll('[data-pill]')).map((p) => p.textContent);
    expect(pills).toEqual(['yes', 'no', '2/3', '1']);
    expect(container.querySelector('path[data-edge="monitoring-deadlines"]')).toHaveAttribute(
      'stroke-dasharray',
    );
    expect(screen.getByRole('group', { name: /Incident process/ })).toBeInTheDocument();
    expect(screen.getByText(/hash chain and the audit log/)).toBeInTheDocument();
  });

  it('marks only the current step', () => {
    const { container } = renderWithProviders(<IncidentFlowDiagram activeStep="suspend" />);
    const current = container.querySelectorAll('[data-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/Suspend site.*current step/);
    expect(screen.getAllByText('current step')).toHaveLength(1);
  });

  it('maps an incident state to its step', () => {
    expect(currentFlowStep('REPORTED', false, false)).toBe('assess');
    expect(currentFlowStep('CONFIRMED', false, false)).toBe('confirmed');
    expect(currentFlowStep('CONFIRMED', true, false)).toBe('suspend');
    expect(currentFlowStep('CONFIRMED', false, true)).toBe('restart');
    expect(currentFlowStep('CLOSED', false, true)).toBe('restart');
    expect(currentFlowStep('FALSE_ALARM', false, false)).toBe('falseAlarm');
  });

  it('opens the explanation of a node, names the next steps and closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentFlowDiagram />);
    const button = screen.getByRole('button', { name: /^Suspend site/ });
    await user.click(button);
    const panel = screen.getByTestId('incident-flow-panel');
    expect(within(panel).getByText(en.incidentFlow_suspend_text)).toBeInTheDocument();
    expect(within(panel).getByText(/Next: NIS2 deadlines/)).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('incident-flow-panel')).not.toBeInTheDocument();
    await user.click(button);
    await user.click(button);
    expect(screen.queryByTestId('incident-flow-panel')).not.toBeInTheDocument();
  });

  it('opens a node with the keyboard and lists the branches of the decision', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentFlowDiagram />);
    screen.getByRole('button', { name: /^confirmed\?/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(/Next: yes → Confirmed · no → False alarm/)).toBeInTheDocument();
  });

  it('explains the steps in German', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentFlowDiagram />, { lang: 'de' });
    await user.click(screen.getByRole('button', { name: /^Bewerten/ }));
    expect(screen.getByText(de.incidentFlow_assess_text)).toBeInTheDocument();
    expect(screen.getByText(/Jeder Schritt landet in der Hash-Kette/)).toBeInTheDocument();
  });

  it('has a text for every node in both languages', () => {
    for (const n of FLOW_NODES) {
      for (const part of ['label', 'sub', 'text'] as const) {
        const k = `incidentFlow_${n.id}_${part}` as keyof typeof en;
        expect(en[k]).toBeTruthy();
        expect(de[k]).toBeTruthy();
      }
    }
  });

  it('runs top to bottom below 720 px and left to right above', () => {
    const { container } = renderWithProviders(<IncidentFlowDiagram />);
    const group = screen.getByRole('group', { name: /Incident process/ });
    resizeTo(1000);
    expect(group).toHaveAttribute('data-layout', 'wide');
    const wideDecision = container.querySelector('[data-node="decision"] button') as HTMLElement;
    const wideRestart = container.querySelector('[data-node="restart"] button') as HTMLElement;
    expect(parseFloat(wideRestart.style.left)).toBeGreaterThan(parseFloat(wideDecision.style.left));
    resizeTo(400);
    expect(group).toHaveAttribute('data-layout', 'vertical');
    const narrowDecision = container.querySelector('[data-node="decision"] button') as HTMLElement;
    const narrowRestart = container.querySelector('[data-node="restart"] button') as HTMLElement;
    expect(narrowRestart.style.left).toBe(narrowDecision.style.left);
    expect(parseFloat(narrowRestart.style.top)).toBeGreaterThan(
      parseFloat(narrowDecision.style.top),
    );
  });

  it('falls back to the viewport media query before a width is known', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q }));
    renderWithProviders(<IncidentFlowDiagram />);
    expect(screen.getByRole('group', { name: /Incident process/ })).toHaveAttribute(
      'data-layout',
      'vertical',
    );
  });
});

describe('IncidentFlowSection', () => {
  it('is open by default without incidents and closed with incidents', () => {
    const { unmount } = renderWithProviders(<IncidentFlowSection defaultOpen />);
    expect(screen.getByRole('button', { name: 'How an incident is handled' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('incident-flow')).toBeInTheDocument();
    unmount();
    renderWithProviders(<IncidentFlowSection defaultOpen={false} />);
    expect(screen.getByRole('button', { name: 'How an incident is handled' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('incident-flow')).not.toBeInTheDocument();
  });

  it('remembers the choice and lets it win over the default', async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<IncidentFlowSection defaultOpen={false} />);
    await user.click(screen.getByRole('button', { name: 'How an incident is handled' }));
    expect(localStorage.getItem(INCIDENT_FLOW_STORAGE_KEY)).toBe('1');
    first.unmount();
    renderWithProviders(<IncidentFlowSection defaultOpen={false} />);
    expect(screen.getByTestId('incident-flow')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'How an incident is handled' }));
    expect(localStorage.getItem(INCIDENT_FLOW_STORAGE_KEY)).toBe('0');
  });

  it('still toggles when the store is blocked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentFlowSection defaultOpen={false} />);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await user.click(screen.getByRole('button', { name: 'How an incident is handled' }));
    expect(screen.getByTestId('incident-flow')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
