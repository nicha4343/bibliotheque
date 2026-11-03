import { useEffect, useState } from 'preact/hooks';
import { fr } from '../textes/fr';

/*
 * TEMPORARY (3 November 2026): measurements showing why, on the user's Android phone, the installed
 * application is drawn taller than its window after a reload, the navigation bar hidden under the
 * phone's buttons until another application has been opened. To remove once understood.
 */

type MeasureKey = keyof typeof fr.displayDiagnostic.labels;
type Measures = Record<MeasureKey, string>;

/** Chromium's User-Agent Client Hints, absent from the DOM types. */
interface UserAgentData {
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{
    platformVersion?: string;
    model?: string;
    fullVersionList?: { brand: string; version: string }[];
  }>;
}

const UNSUPPORTED = 9999;

const round = (value: number) => String(Math.round(value));

/** A value computed by the browser on a hidden element: viewport units, env() variables. */
function probe(css: string, read: (element: HTMLElement) => number): number {
  const element = document.createElement('div');
  element.style.cssText = `position: fixed; top: 0; left: 0; width: 0; visibility: hidden; pointer-events: none; ${css}`;
  document.body.append(element);
  const value = read(element);
  element.remove();
  return value;
}

const height = (unit: string) => round(probe(`height: ${unit}`, (element) => element.getBoundingClientRect().height));

const inset = (variable: string) => {
  const value = probe(`height: 0; padding-bottom: env(${variable}, ${UNSUPPORTED}px)`, (element) =>
    parseFloat(getComputedStyle(element).paddingBottom),
  );
  return value === UNSUPPORTED ? '—' : round(value);
};

function measure(): Measures {
  const app = document.querySelector('.app')?.getBoundingClientRect();
  const nav = document.querySelector('.nav')?.getBoundingClientRect();
  return {
    window: `${round(window.innerWidth)} × ${round(window.innerHeight)}`,
    visualViewport: window.visualViewport ? round(window.visualViewport.height) : '—',
    clientHeight: round(document.documentElement.clientHeight),
    screen: `${round(screen.height)} / ${round(screen.availHeight)}`,
    vh: height('100vh'),
    svh: height('100svh'),
    lvh: height('100lvh'),
    dvh: height('100dvh'),
    safeTop: inset('safe-area-inset-top'),
    safeBottom: inset('safe-area-inset-bottom'),
    safeMaxBottom: inset('safe-area-max-inset-bottom'),
    app: app ? round(app.height) : '—',
    navBottom: nav ? round(nav.bottom) : '—',
    standalone: matchMedia('(display-mode: standalone)').matches ? fr.displayDiagnostic.yes : fr.displayDiagnostic.no,
    pixelRatio: String(window.devicePixelRatio),
  };
}

async function describeDevice(): Promise<string> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (!data) return navigator.userAgent;
  const values = await data.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']);
  const browsers = (values.fullVersionList ?? [])
    .filter(({ brand }) => !brand.includes('Brand'))
    .map(({ brand, version }) => `${brand} ${version}`);
  return [`${data.platform} ${values.platformVersion ?? ''}`, values.model, ...browsers].filter(Boolean).join(' · ');
}

/** Section of the Paramètres screen: the sizes the browser gives at load and now. */
export function DisplayDiagnostic() {
  const [first, setFirst] = useState<{ measures: Measures; at: number }>();
  const [now, setNow] = useState<Measures>();
  const [changes, setChanges] = useState(0);
  const [device, setDevice] = useState('');

  useEffect(() => {
    const measures = measure();
    setFirst({ measures, at: performance.now() });
    setNow(measures);
    const update = () => {
      setNow(measure());
      setChanges((count) => count + 1);
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    document.addEventListener('visibilitychange', update);
    describeDevice().then(setDevice, () => {
      setDevice(navigator.userAgent);
    });
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  if (!first || !now) return null;
  const texts = fr.displayDiagnostic;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '—';

  return (
    <section class="section" aria-labelledby="diagnostic-title">
      <h2 class="section__title" id="diagnostic-title">
        {texts.title}
      </h2>
      <div class="card">
        <p class="diagnostic__text">{texts.intro(round(first.at), changes)}</p>
        <table class="diagnostic">
          <thead>
            <tr>
              <th scope="col">{texts.measure}</th>
              <th scope="col">{texts.atLoad}</th>
              <th scope="col">{texts.now}</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(texts.labels) as MeasureKey[]).map((key) => (
              <tr key={key} class={first.measures[key] === now[key] ? undefined : 'diagnostic__changed'}>
                <th scope="row">{texts.labels[key]}</th>
                <td>{first.measures[key]}</td>
                <td>{now[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="diagnostic__text">{texts.viewport(viewport)}</p>
        <p class="diagnostic__text">{texts.device(device)}</p>
      </div>
    </section>
  );
}
