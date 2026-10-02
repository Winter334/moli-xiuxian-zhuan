import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, Gem, Hammer, Minus, Package, Plus, Search, Shield, Swords, X } from 'lucide-react';
import { decimal, formatAmount, formatDecimal, multiply, progress } from '../format';
import { ITEM_ICONS } from './art';
import type { Instance } from './types';

export function IconButton({ label, children, className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}
export function Tabs<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string; count?: number }[]; onChange: (id: T) => void; label: string;
}) {
  return <div className="tabs" role="tablist" aria-label={label}>
    {options.map((tab, index) => <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
      tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % options.length
          : event.key === 'ArrowLeft' ? (index + options.length - 1) % options.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        onChange(options[next].id);
        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
      }}>{tab.label}{tab.count !== undefined && <small>{tab.count}</small>}</button>)}
  </div>;
}
export function Meter({ label, value, max, tone = 'jade', compact = false }: {
  label: string; value: string; max: string; tone?: string; compact?: boolean;
}) {
  return <div className={`meter ${tone} ${compact ? 'compact' : ''}`}>
    <div><span>{label}</span><span title={`${formatDecimal(value)} / ${formatDecimal(max)}`}>{formatAmount(value)}<small> / {formatAmount(max)}</small></span></div>
    <progress aria-label={label} value={progress(value, max)} max={100} />
  </div>;
}
export function Empty({ children, icon = <Package size={26} /> }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state">{icon}<p>{children}</p></div>;
}
export function Quantity({ value, max, onChange, label, disabled = false }: {
  value: number; max: number; onChange: (value: number) => void; label: string; disabled?: boolean;
}) {
  const limit = Math.max(1, max);
  const valid = Number.isInteger(value) && value >= 1 && value <= max;
  return <div className="quantity" role="group" aria-label={label}>
    <IconButton label={`减少${label}`} disabled={disabled || value <= 1} onClick={() => onChange(Math.max(1, value - 1))}><Minus size={14} /></IconButton>
    <input aria-label={label} inputMode="numeric" type="number" step="1" min="1" max={limit}
      value={Number.isNaN(value) ? '' : value} aria-invalid={!valid} disabled={disabled}
      onChange={event => onChange(event.target.valueAsNumber)} />
    <IconButton label={`增加${label}`} disabled={disabled || value >= limit} onClick={() => onChange(Math.min(limit, (value || 0) + 1))}><Plus size={14} /></IconButton>
  </div>;
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-field"><Search size={16} /><input type="search" aria-label={placeholder}
    value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
export function ItemGlyph({ kind, slot, itemId, size = 22 }: { kind?: string; slot?: string | null; itemId?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = itemId && !failed ? ITEM_ICONS[itemId] : undefined;
  const Icon = slot === 'weapon' ? Swords : slot ? Shield : kind === 'food' || kind === 'foundation-pill' || kind === 'insight'
    ? FlaskConical : kind === 'marrow' ? Gem : kind === 'part' ? Hammer : Package;
  return <span className={`item-glyph ${kind ?? 'equipment'}`}>
    {src ? <img src={src} alt="" width={size} height={size} className="raster-art" onError={() => setFailed(true)} />
      : <Icon size={size} strokeWidth={1.5} />}
  </span>;
}
export function Dialog({ title, onClose, children, wide = false, footer }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} className={`dialog ${wide ? 'wide' : ''}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={id}>{title}</h2><IconButton label="关闭窗口" onClick={onClose}><X size={18} /></IconButton></header>
    <div className="dialog-body">{children}</div>
    {footer && <footer>{footer}</footer>}
  </dialog>, document.body);
}
export const STAT_NAMES: Record<string, string> = {
  maxHp: '气血上限', attack: '攻击', defense: '防御', agility: '敏捷', attackSpeed: '攻速',
  critChance: '暴击率', critMultiplier: '暴击伤害', attackMultiplier: '普攻倍率',
  hpRegen: '气血回复/秒', hpRegenPercent: '气血回复比例/秒',
};
export function formatBonus(key: string, value: string, multiplicative = false) {
  if (multiplicative) return `×${formatAmount(value)}`;
  const percent = key === 'critChance' || key === 'hpRegenPercent';
  return `${decimal(value).gte(0) ? '+' : ''}${formatAmount(percent ? multiply(value, 100) : value)}${percent ? '个百分点' : ''}`;
}
export function Bonuses({ source }: { source: Pick<NonNullable<Instance['bonuses']>, 'flat' | 'multiplier'> }) {
  return <div className="bonus-lines">
    {Object.entries(source.flat ?? {}).map(([key, value]) =>
      <span key={`flat:${key}`} className={decimal(value).lt(0) ? 'negative' : 'positive'}>
        {STAT_NAMES[key] ?? key} <b>{formatBonus(key, value)}</b>
      </span>)}
    {Object.entries(source.multiplier ?? {}).filter(([, value]) => !decimal(value).eq(1)).map(([key, value]) =>
      <span key={`multiplier:${key}`} className={decimal(value).lt(1) ? 'negative' : 'positive'}>{STAT_NAMES[key] ?? key}<b>{formatBonus(key, value, true)}</b></span>)}
  </div>;
}
