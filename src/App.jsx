import { lazy, Suspense, useEffect, useState } from 'react';
import { localStorageGet, localStorageSet, StoreProvider, useStore } from './lib/store.jsx';
import DemoGuide from './components/DemoGuide.jsx';
import Explore from './pages/Explore.jsx';

const Insights = lazy(() => import('./pages/Insights.jsx'));
const Model = lazy(() => import('./pages/Model.jsx'));
const DataPage = lazy(() => import('./pages/Data.jsx'));
const Prepare = lazy(() => import('./pages/Prepare.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Track = lazy(() => import('./pages/Track.jsx'));

const NAV = [
  { to: '/', label: 'Map', icon: 'map' },
  { to: '/insights', label: 'Insights', icon: 'chart' },
  { to: '/model', label: 'Model', icon: 'layers' },
  { to: '/prepare', label: 'Prepare', icon: 'shield' },
  { to: '/sources', label: 'Data', icon: 'db' },
  { to: '/admin', label: 'Verify', icon: 'check' },
];

export function Icon({ name, size = 18 }) {
  const p = {
    map: <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20" />,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5 12 22l9-4.5" />,
    shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM8.5 12l2.5 2.5 4.5-5" />,
    db: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
    check: <path d="M20 6 9 17l-5-5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <path d="m21 21-4.5-4.5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    sun: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />,
    moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
    locate: <path d="M12 2v3m0 14v3M2 12h3m14 0h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0-3.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="M19 12H5m6 6-6-6 6-6" />,
    camera: <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
    info: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-9.5V7" />,
    play: <path d="M7 4v16l13-8z" />,
    flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  }[name];
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
  );
}

export function Link({ to, children, className, ...rest }) {
  const { route } = useStore();
  return (
    <a href={to} className={className} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      route.navigate(to);
    }} {...rest}>{children}</a>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="FloodSense home">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <path d="M4 21c3-2.2 5.3-2.2 8.2 0s5.4 2.2 8.2 0 5.3-2.2 7.6 0" fill="none" stroke="var(--river)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M7.5 15c2.8-5.6 14.2-5.6 17 0" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M11.5 11.4c1.8-2.4 7.2-2.4 9 0" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </svg>
      <span className="wm-text">Flood<b>Sense</b></span>
      <span className="wm-region">Ogun State · Pilot</span>
    </Link>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorageGet('fs.theme', window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f1ea' : '#0b1114');
    localStorageSet('fs.theme', theme);
    window.dispatchEvent(new Event('fs-theme'));
  }, [theme]);
  return [theme, setTheme];
}

function TopBar() {
  const { route, demo, setDemo } = useStore();
  const [theme, setTheme] = useTheme();
  const active = (to) => (to === '/' ? route.path === '/' || route.path === '/report' : route.path.startsWith(to));
  return (
    <header className="topbar">
      <Wordmark />
      <nav className="topnav" aria-label="Primary">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={active(n.to) ? 'active' : ''} aria-current={active(n.to) ? 'page' : undefined}>{n.label}</Link>
        ))}
      </nav>
      <div className="topbar-right">
        <Link to="/sources" className="proto-chip" title="What is real, what is illustrative">
          <span className="dot" />Prototype · not a warning system
        </Link>
        <button className={`btn btn-ghost sm demo-btn ${demo ? 'on' : ''}`} onClick={() => setDemo(demo ? null : { step: 0 })} aria-pressed={!!demo} title="Step-by-step presentation mode">
          <Icon name="play" size={14} /><span>Guided demo</span>
        </button>
        <button className="icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <Link to="/report" className="btn btn-accent report-cta"><Icon name="plus" size={16} />Report flooding</Link>
      </div>
    </header>
  );
}

function MobileNav() {
  const { route } = useStore();
  const [more, setMore] = useState(false);
  const items = [NAV[0], NAV[1], { to: '/report', label: 'Report', icon: 'plus', cta: true }, NAV[2]];
  const active = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
  return (
    <>
      <nav className="mobilenav" aria-label="Primary mobile">
        {items.map((n) => (
          <Link key={n.to} to={n.to} className={`${n.cta ? 'cta' : ''} ${active(n.to) ? 'active' : ''}`} onClick={() => setMore(false)}>
            <Icon name={n.icon} size={n.cta ? 22 : 20} /><span>{n.label}</span>
          </Link>
        ))}
        <button className={more ? 'active' : ''} onClick={() => setMore((m) => !m)} aria-expanded={more}><Icon name="menu" size={20} /><span>More</span></button>
      </nav>
      {more && (
        <div className="more-sheet" role="dialog" aria-label="More pages" onClick={() => setMore(false)}>
          <div className="more-inner" onClick={(e) => e.stopPropagation()}>
            {[NAV[3], NAV[4], NAV[5], { to: '/track', label: 'Track a report', icon: 'search' }].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMore(false)}><Icon name={n.icon} />{n.label}</Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return <div className={`toast toast-${toast.kind}`} role="status" key={toast.id}>{toast.msg}</div>;
}

function Shell() {
  const { route, loadError } = useStore();
  const p = route.path;
  let page;
  if (p === '/' || p === '/report') page = <Explore />;
  else if (p.startsWith('/insights')) page = <Insights />;
  else if (p.startsWith('/model')) page = <Model />;
  else if (p.startsWith('/sources')) page = <DataPage />;
  else if (p.startsWith('/prepare')) page = <Prepare />;
  else if (p.startsWith('/admin')) page = <Admin />;
  else if (p.startsWith('/track')) page = <Track />;
  else page = <div className="page"><div className="page-inner"><h1>Page not found</h1><p><Link to="/">Return to the map</Link></p></div></div>;
  const { setDemo } = useStore();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') setDemo({ step: 0 });
  }, [setDemo]);
  useEffect(() => {
    const titles = { '/': 'Map', '/report': 'Report flooding', '/insights': 'Insights', '/model': 'Susceptibility model', '/sources': 'Data & status', '/prepare': 'Prepare', '/admin': 'Verification', '/track': 'Track a report' };
    document.title = `${titles[p] || 'FloodSense'} · FloodSense Ogun`;
  }, [p]);
  return (
    <div className="app">
      <TopBar />
      {loadError && <div className="fatal" role="alert">Could not load the GIS layers: {loadError}. Reload the page to try again.</div>}
      <main className="main" id="main">
        <Suspense fallback={<div className="page-loading"><span className="spinner" />Loading…</div>}>{page}</Suspense>
      </main>
      <MobileNav />
      <DemoGuide />
      <Toast />
    </div>
  );
}

export default function App() {
  return <StoreProvider><Shell /></StoreProvider>;
}
