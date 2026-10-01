import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import GameApp from './GameApp';
import './game.css';

const Preview = import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === 'ui'
  ? lazy(() => import('./ui/DesignPreview')) : null;
const Activity = !Preview && (!import.meta.env.DEV || location.hostname.endsWith('.discordsays.com') ||
  new URLSearchParams(location.search).has('frame_id') || new URLSearchParams(location.search).has('instance_id'))
  ? lazy(() => import('./ActivityApp')) : null;
createRoot(document.getElementById('root')!).render(Preview
  ? <Suspense fallback={<p>正在准备界面预览</p>}><Preview /></Suspense>
  : Activity ? <Suspense fallback={<p>正在连接 Discord</p>}><Activity /></Suspense> : <GameApp />);
