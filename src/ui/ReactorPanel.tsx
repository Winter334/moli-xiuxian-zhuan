import { CirclePause, FlaskConical, Plus, Radiation, Thermometer } from 'lucide-react';
import { formatAmount } from '../format';
import { Meter } from './common';
import type { ViewProps } from './types';

export function ReactorPanel({ game, blocked, command }: ViewProps) {
  const reactor = game.reactor!;
  return <section className="reactor-panel" aria-label="灵能反应炉">
    <header><h2>灵能反应炉</h2><button disabled={blocked} onClick={() => void command({ type: 'reactor', active: false })}>
      <CirclePause size={16} />暂停并退出</button></header>
    <div className="reactor-readings">
      <div><Thermometer size={18} /><strong>炉温 {formatAmount(String(reactor.temperature))}</strong>
        <Meter label="熔毁阈值" value={String(reactor.temperature)} max="10000" compact /></div>
      <div><Radiation size={18} /><strong>灵能辐照 {formatAmount(String(reactor.radiation))}</strong>
        <p>反应强度 {formatAmount(String(reactor.power))} · 提取品质 {reactor.quality}</p></div>
    </div>
    <div className="reactor-feeds">{reactor.materials.map(material => <form key={material.itemId} onSubmit={event => {
      event.preventDefault();
      void command({ type: 'reactor-feed', itemId: material.itemId,
        quantity: Number(new FormData(event.currentTarget).get('quantity')) });
    }}>
      <div><strong>{material.name}</strong><small>炉内 {formatAmount(String(reactor[material.field]))} · 持有 {formatAmount(material.owned)}</small></div>
      <input aria-label={`${material.name}投料数量`} type="number" name="quantity" min={1}
        max={Math.min(10000, Number(material.owned))} defaultValue={1} step={1} required disabled={blocked || material.owned === '0'} />
      <button type="submit" disabled={blocked || material.owned === '0'} title={`投入${material.name}`}><Plus size={16} /></button>
    </form>)}</div>
    <div className="reactor-readings"><p>{game.crystallizationKnown
      ? '凝晶消耗100万辐照，反应强度归零；其它炉内积存保留。提取淬液会清零辐照。'
      : '通关凝晶室后可在此凝聚化神灵晶。'}</p>
      <button disabled={blocked || !game.crystallizationKnown || reactor.radiation < 1000000}
        onClick={() => void command({ type: 'reactor-crystallize' })}>凝聚化神灵晶</button></div>
    <footer><span className="muted small">提取消耗当前凝胶20%；过热熔毁会损失炉内投料并施加灵机灼扰。</span>
      <button disabled={blocked || reactor.gel < 10} onClick={() => void command({ type: 'reactor-extract' })}>
        <FlaskConical size={16} />提取淬液</button></footer>
  </section>;
}
