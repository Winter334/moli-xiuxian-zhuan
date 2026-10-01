import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { ArrowLeft, Check, Flag, House, LocateFixed, Map, Minus, Mountain, Plus, Swords, X } from 'lucide-react';
import { AREA_CENTERS, areaFor, knownAreas, mapPoint, prerequisite, type MapCamera, type MapPoint } from './world';
import { IconButton } from './common';
import { formatAmount } from '../format';
import type { ViewProps } from './types';

const DETAIL_SCALE = 0.5;
const MIN_SCALE = 0.085;
const MAX_SCALE = 1.6;

export function WorldView({ game, blocked, command, onArrive, camera }: ViewProps & {
  onArrive: () => void; camera: MutableRefObject<MapCamera | null>;
}) {
  const atlasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const moving = useRef(false);
  const touchGesture = useRef({ x: 0, y: 0, moved: false, until: 0 });
  const areas = knownAreas(game);
  const all = [...game.destinations, ...game.regions];
  const detailed = transform.k >= DETAIL_SCALE;
  const inspected = all.find(entry => entry.id === inspectedId);
  const inspectedRegion = game.regions.find(entry => entry.id === inspectedId);
  const overview = (width: number, height: number) => {
    const points = areas.map(area => AREA_CENTERS[area.id]);
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const k = Math.max(MIN_SCALE, Math.min(0.26, (width - 160) / Math.max(600, maxX - minX),
      (height - 150) / Math.max(450, maxY - minY)));
    return zoomIdentity.translate(width / 2 - (minX + maxX) / 2 * k, height / 2 - (minY + maxY) / 2 * k).scale(k);
  };
  useLayoutEffect(() => {
    const el = atlasRef.current!;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE]).clickDistance(6).tapDistance(6)
      .extent((): [[number, number], [number, number]] => [[0, 0], [el.clientWidth, el.clientHeight]])
      .on('zoom', event => {
        const t = event.transform as ZoomTransform;
        camera.current = { x: t.x, y: t.y, k: t.k, width: el.clientWidth, height: el.clientHeight };
        setTransform(t);
      });
    zoomRef.current = behavior;
    const surface = select(el).call(behavior).on('dblclick.zoom', null);
    const saved = camera.current;
    const initial = saved ? zoomIdentity.translate(saved.x + (el.clientWidth - saved.width) / 2,
      saved.y + (el.clientHeight - saved.height) / 2).scale(saved.k) : overview(el.clientWidth, el.clientHeight);
    surface.call(behavior.transform, initial);
    const observer = new ResizeObserver(() => {
      const old = camera.current;
      if (!old || !el.clientWidth || !el.clientHeight) return;
      if (old.width === el.clientWidth && old.height === el.clientHeight) return;
      surface.interrupt().call(behavior.transform, zoomIdentity
        .translate(old.x + (el.clientWidth - old.width) / 2, old.y + (el.clientHeight - old.height) / 2).scale(old.k));
    });
    observer.observe(el);
    return () => { observer.disconnect(); surface.interrupt().on('.zoom', null); zoomRef.current = null; };
  }, []);
  useEffect(() => { if (!game.battle) setInspectedId(null); }, [Boolean(game.battle), game.life.number]);
  const animate = (target: ZoomTransform) => {
    if (!atlasRef.current || !zoomRef.current) return;
    select(atlasRef.current).interrupt().transition().duration(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360)
      .call(zoomRef.current.transform, target);
  };
  const focus = (point: MapPoint, k = 0.75) => {
    const el = atlasRef.current!;
    animate(zoomIdentity.translate(el.clientWidth / 2 - point.x * k, el.clientHeight / 2 - point.y * k).scale(k));
  };
  const scaleBy = (factor: number) => {
    if (atlasRef.current && zoomRef.current) select(atlasRef.current).interrupt().transition().duration(180).call(zoomRef.current.scaleBy, factor);
  };
  const activate = async (id: string) => {
    if (performance.now() < touchGesture.current.until) return;
    if (game.battle) { setInspectedId(id); return; }
    if (blocked || moving.current) return;
    if (id === game.locationId) { onArrive(); return; }
    const region = game.regions.find(entry => entry.id === id);
    const safe = game.destinations.find(entry => entry.id === id);
    if (!(region?.arrivable ?? safe?.travelable)) return;
    moving.current = true;
    try { if (await command(region ? { type: 'arrive', regionId: id } : { type: 'travel', locationId: id })) onArrive(); }
    finally { moving.current = false; }
  };
  const screen = (p: MapPoint) => ({ left: p.x * transform.k + transform.x, top: p.y * transform.k + transform.y });
  const edges = detailed ? all.flatMap(location => {
    const parent = prerequisite(location.id) ?? game.regions.find(entry => entry.id === location.id)?.parent;
    return parent && all.some(entry => entry.id === parent) ? [[mapPoint(parent), mapPoint(location.id)]] : [];
  }) : areas.slice(1).map((area, i) => [AREA_CENTERS[areas[i].id], AREA_CENTERS[area.id]]);
  return <div className="world-view">
    <header className="map-heading"><div><span className="eyebrow">{detailed ? '诸地' : '诸域'}</span><h1>山河图</h1></div>
      <span className="map-current">{game.battle ? <Swords size={14} /> : <LocateFixed size={14} />}{game.locationName}</span>
      <IconButton label={game.battle ? '返回战斗' : '返回当地'} onClick={onArrive}><ArrowLeft size={18} /></IconButton>
    </header>
    <div className="map-workspace">
      <div className="map-viewport" ref={atlasRef} tabIndex={0} aria-label="山河图画布"
        data-map-level={detailed ? 'locations' : 'regions'} data-map-scale={transform.k.toFixed(3)}
        onTouchStartCapture={event => {
          const t = event.touches[0];
          touchGesture.current = { x: t.clientX, y: t.clientY, moved: event.touches.length > 1, until: touchGesture.current.until };
        }}
        onTouchMoveCapture={event => {
          const t = event.touches[0], gesture = touchGesture.current;
          if (event.touches.length > 1 || Math.hypot(t.clientX - gesture.x, t.clientY - gesture.y) > 6) gesture.moved = true;
        }}
        onTouchEndCapture={() => { if (touchGesture.current.moved) touchGesture.current.until = performance.now() + 450; }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setInspectedId(null); return; }
          if (event.target !== event.currentTarget) return;
          if (event.key === '+' || event.key === '=') { event.preventDefault(); scaleBy(1.4); }
          else if (event.key === '-') { event.preventDefault(); scaleBy(1 / 1.4); }
          else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            const x = event.key === 'ArrowLeft' ? 100 : event.key === 'ArrowRight' ? -100 : 0;
            const y = event.key === 'ArrowUp' ? 100 : event.key === 'ArrowDown' ? -100 : 0;
            animate(zoomIdentity.translate(transform.x + x, transform.y + y).scale(transform.k));
          }
        }}>
        <svg className="map-connections" aria-hidden="true"><g transform={transform.toString()}>
          {edges.map(([a, b], i) => <path key={i} vectorEffect="non-scaling-stroke"
            d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${a.y} ${b.x},${b.y}`} />)}
        </g></svg>
        {detailed ? <>
          {areas.map(area => <span key={area.id} className="map-region-label"
            style={screen({ x: AREA_CENTERS[area.id].x, y: AREA_CENTERS[area.id].y - 470 })}>{area.name}</span>)}
          {all.map(location => {
            const region = game.regions.find(entry => entry.id === location.id);
            const Icon = region ? region.challenge ? Flag : Swords : House;
            const here = location.id === game.locationId;
            return <button key={location.id} className={`map-node ${region ? 'wild' : 'safe'} ${here ? 'current' : ''} ${inspectedId === location.id ? 'selected' : ''}`}
              style={screen(mapPoint(location.id))} aria-label={`${location.name}${here ? '，当前所在' : ''}`}
              onFocus={event => { if (event.currentTarget.matches(':focus-visible')) focus(mapPoint(location.id), transform.k); }}
              onClick={() => void activate(location.id)} disabled={!game.battle && blocked}>
              <span className="node-symbol"><Icon size={20} strokeWidth={1.5} />{region?.completed && <Check className="node-complete" size={12} />}</span>
              <strong>{location.name}</strong><small>{here ? '当前所在' : region ? region.completed ? '已清理' : region.challenge ? '独立挑战' : '历练' : '休整'}</small>
            </button>;
          })}
        </> : areas.map(area => <button className={`map-node region-node ${areaFor(game.locationId).id === area.id ? 'current' : ''}`}
          key={area.id} style={screen(AREA_CENTERS[area.id])} aria-label={`展开${area.name}`}
          onFocus={event => { if (event.currentTarget.matches(':focus-visible')) focus(AREA_CENTERS[area.id], transform.k); }}
          onClick={() => { if (performance.now() >= touchGesture.current.until) focus(AREA_CENTERS[area.id]); }}>
          <span className="node-symbol"><Mountain size={25} strokeWidth={1.2} /></span>
          <strong>{area.name}</strong><small>{area.subtitle}</small>
        </button>)}
      </div>
      <div className="map-tools">
        <IconButton label="全图" onClick={() => { const el = atlasRef.current!; animate(overview(el.clientWidth, el.clientHeight)); }}><Map size={18} /></IconButton>
        <IconButton label="定位当前地点" onClick={() => focus(mapPoint(game.locationId))}><LocateFixed size={18} /></IconButton>
        <span />
        <IconButton label="放大地图" disabled={transform.k >= MAX_SCALE - 0.001} onClick={() => scaleBy(1.4)}><Plus size={18} /></IconButton>
        <IconButton label="缩小地图" disabled={transform.k <= MIN_SCALE + 0.001} onClick={() => scaleBy(1 / 1.4)}><Minus size={18} /></IconButton>
      </div>
      {game.battle && inspected && <aside className="map-inspector" aria-label="地点概览">
        <header><span className="eyebrow">{areaFor(inspected.id).name}</span>
          <IconButton label="关闭地点概览" onClick={() => setInspectedId(null)}><X size={16} /></IconButton></header>
        <h2>{inspected.name}</h2><span className="subtle-label">{inspected.id === game.locationId ? '当前所在 · ' : ''}
          {inspectedRegion ? inspectedRegion.challenge ? '独立挑战' : '历练之地' : '休整之地'}</span>
        <p>{inspected.description}</p>
        {inspectedRegion && <dl><dt>探索</dt><dd>{inspectedRegion.completed ? '已清理' : `${formatAmount(inspectedRegion.clearedGroups)} / ${inspectedRegion.groupsPerClear} 组`}</dd>
          <dt>撤退落点</dt><dd>{game.destinations.find(entry => entry.id === inspectedRegion.parent)?.name ?? '安全地点'}</dd></dl>}
        <footer><Swords size={14} />交战中 · 暂不可前往</footer>
      </aside>}
    </div>
  </div>;
}
