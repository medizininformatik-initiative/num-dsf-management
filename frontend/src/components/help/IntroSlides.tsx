/**
 * IntroSlides.tsx – a five-slide intro deck at the top of the help page, used to
 * present the tool. One slide shows at a time; the track slides horizontally
 * (transform + opacity only, so Reduce Motion leaves just the opacity crossfade).
 * Navigation: prev/next buttons, clickable dots, ArrowLeft/ArrowRight while the deck
 * has focus, touch/pen swipe (50px threshold) and an optional fullscreen toggle.
 * Dependencies: i18n store, Button, Icon, slides (content).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { INTRO_SLIDES } from './slides';

const SWIPE_PX = 50;
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

export function IntroSlides() {
  const { t } = useI18n();
  const total = INTRO_SLIDES.length;
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const deckRef = useRef<HTMLElement>(null);
  const startX = useRef<number | null>(null);
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;

  const go = useCallback((i: number) => setIndex(Math.min(Math.max(i, 0), total - 1)), [total]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === deckRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void deckRef.current?.requestFullscreen?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    }
  }

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.pointerType === 'mouse') return;
    startX.current = e.clientX;
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
  }

  return (
    <section
      ref={deckRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('introRegionLabel')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`surface-card mb-8 overflow-hidden rounded-card ${FOCUS} ${
        fullscreen
          ? 'flex flex-col justify-center bg-[color:var(--bg-page)] p-6 sm:p-12 [&_h2]:text-2xl sm:[&_h2]:text-4xl [&_li]:text-base sm:[&_li]:text-xl'
          : ''
      }`}
    >
      <div
        className="touch-pan-y overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (startX.current = null)}
      >
        <div
          className="flex transition-transform duration-medium ease-spring"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {INTRO_SLIDES.map((slide, i) => {
            const active = i === index;
            // `inert` keeps hidden slides out of the tab order and the accessibility tree.
            const inert = active ? {} : ({ inert: '' } as Record<string, string>);
            return (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={t('introSlideLabel', { n: i + 1, total })}
                aria-hidden={active ? undefined : true}
                {...inert}
                className={`grid w-full shrink-0 items-center gap-6 p-5 transition-opacity duration-medium ease-standard sm:p-8 md:grid-cols-2 ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <div className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold text-[color:var(--text-primary)]">
                    {t(slide.titleKey)}
                  </h2>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                    {slide.bulletKeys.map((k) => (
                      <li key={k}>{t(k)}</li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0 py-2">
                  <slide.Art />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border)] px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('introPrev')}
          disabled={index === 0}
          onClick={() => go(index - 1)}
          className="!px-2"
        >
          <Icon name="chevron_left" size={20} />
        </Button>

        <div className="flex min-w-0 items-center gap-3">
          <ol className="flex items-center" aria-label={t('introRegionLabel')}>
            {INTRO_SLIDES.map((slide, i) => (
              <li key={slide.id}>
                <button
                  type="button"
                  aria-label={t('introGoTo', { n: i + 1 })}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                  className={`group flex h-8 w-6 items-center justify-center rounded-full ${FOCUS}`}
                >
                  <span
                    className={`block h-2 w-2 rounded-full transition-colors duration-short ${
                      i === index
                        ? 'bg-[color:var(--accent-solid)]'
                        : 'bg-[color:var(--border-strong)] group-hover:bg-[color:var(--text-muted)]'
                    }`}
                  />
                </button>
              </li>
            ))}
          </ol>
          <span aria-live="polite" className="text-xs tabular-nums text-[color:var(--text-muted)]">
            {t('introCounter', { n: index + 1, total })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {canFullscreen && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={fullscreen ? t('introExitFullscreen') : t('introFullscreen')}
              onClick={toggleFullscreen}
              className="!px-2"
            >
              <Icon name={fullscreen ? 'fullscreen_exit' : 'fullscreen'} size={20} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('introNext')}
            disabled={index === total - 1}
            onClick={() => go(index + 1)}
            className="!px-2"
          >
            <Icon name="chevron_right" size={20} />
          </Button>
        </div>
      </div>
    </section>
  );
}
