import React, { useId, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ReceiptText } from 'lucide-react';
import { TreasuryActivity, VolumePeriod, VOLUME_PERIODS, volumeSeries, dayLabel, utcDay } from './activity';

const number = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const currencies = ['USDC', 'USDT', 'EURC', 'USD', 'EUR', 'GBP'];

export function TreasuryActivityChart<T extends TreasuryActivity>({ transactions, complete, refreshedAt, renderLedger }: {
  transactions: T[]; complete?: boolean; refreshedAt: string; renderLedger: (rows: T[]) => React.ReactNode;
}) {
  const [period, setPeriod] = useState<VolumePeriod>('1M');
  const [currency, setCurrency] = useState('USDC');
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const id = useId().replace(/:/g, '');
  const now = Date.parse(refreshedAt);
  const series = useMemo(() => volumeSeries(transactions, currency, period, Number.isFinite(now) ? now : Date.now()), [transactions, currency, period, now]);
  const active = hover ?? selected;
  const day = active === null ? null : series.days[active];
  const selection = selected === null ? null : series.days[selected];
  const rows = (selection ? series.rows.filter(row => utcDay(Date.parse(row.created_at)) === selection.time) : series.rows) as T[];
  const total = day ? day.value : series.total;
  const maximum = Math.max(1, ...series.days.map(item => item.value));
  const points = series.days.map((item, index) => ({ x: index / (series.days.length - 1) * 1000, y: 176 - item.value / maximum * 152 }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const point = active === null ? null : points[active];
  const hasCompleteAmounts = complete === true && series.excluded === 0;
  const difference = series.previous > 0 ? (series.total - series.previous) / series.previous * 100 : null;
  const reset = () => { setHover(null); setSelected(null); };
  const indexAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (points.length - 1));
  };
  return <section className="treasury-volume" aria-labelledby={`${id}-title`}>
    <div className="treasury-volume-top"><div><p className="treasury-volume-eyebrow">TREASURY</p><h2 id={`${id}-title`}>Transaction volume</h2></div><label className="treasury-volume-currency"><span className="sr-only">Volume currency</span><select value={currency} onChange={event => { setCurrency(event.target.value); reset(); }}>{currencies.map(code => <option key={code}>{code}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label></div>
    <div className="treasury-volume-heading"><p className="treasury-volume-value" data-testid="volume-value">{number(total)} <span>{currency}</span></p><p className="treasury-volume-caption" data-testid="volume-caption">{day ? `${dayLabel(day.time)} · ${day.count} completed` : `${dayLabel(series.days[0].time)} – ${dayLabel(series.days[series.days.length - 1].time)}`}</p>
      <div className="treasury-volume-comparison">{!day && hasCompleteAmounts && difference !== null ? <><span className={difference >= 0 ? 'positive' : 'negative'}>{difference >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownLeft size={14}/>} {Math.abs(difference).toFixed(1)}%</span><span>vs. previous {VOLUME_PERIODS[period]} days</span></> : <span>{day ? 'Daily completed volume' : 'Completed volume for this period'}</span>}</div>
    </div>
    <div className="treasury-volume-scale"><span>{number(maximum)} {currency}</span><span>Daily volume</span></div>
    <div className="treasury-volume-plot" role="slider" tabIndex={0} aria-label="Inspect daily transaction volume" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={active ?? points.length - 1} aria-valuetext={day ? `${dayLabel(day.time)}, ${number(day.value)} ${currency}, ${day.count} transactions` : 'Use arrow keys to inspect a day. Enter to view its transactions.'}
      onPointerMove={event => setHover(indexAt(event))} onPointerLeave={() => setHover(null)}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setHover(indexAt(event)); }}
      onPointerUp={event => { const index = indexAt(event); setSelected(index); setHover(null); setShowLedger(true); }}
      onPointerCancel={() => setHover(null)} onBlur={() => setHover(null)}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          setHover(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (active ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(active ?? points.length - 1); setShowLedger(true); }
        else if (event.key === 'Escape') reset();
      }}>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C7FF00" stopOpacity=".22"/><stop offset="100%" stopColor="#C7FF00" stopOpacity="0"/></linearGradient></defs>{[24,100,176].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#ffffff0c"/>)}<path d={`${path} L1000,190 L0,190 Z`} fill={`url(#${id}-fill)`}/><path d={path} fill="none" stroke="#C7FF00" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>{point && <g data-testid="volume-crosshair"><line x1={point.x} x2={point.x} y1="0" y2="190" stroke="#c7ff00" strokeOpacity=".5" strokeDasharray="4 4"/><circle cx={point.x} cy={point.y} r="4" fill="#c7ff00" stroke="#101418" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g>}</svg>
    </div>
    <div className="treasury-volume-dates"><span>{dayLabel(series.days[0].time)}</span><span>{dayLabel(series.days[series.days.length - 1].time)}</span></div>
    <div className="treasury-volume-periods" role="group" aria-label="Chart period">{(Object.keys(VOLUME_PERIODS) as VolumePeriod[]).map(value => <button key={value} aria-pressed={value === period} onClick={() => { setPeriod(value); reset(); }}>{value}</button>)}</div>
    <div className="treasury-volume-stats"><div><span>Completed transfers</span><strong>{series.rows.length}</strong></div><div><span>Largest transfer</span><strong>{number(series.largest)} <small>{currency}</small></strong></div></div>
    <div className="treasury-volume-footnote"><p>Hover or drag to inspect. Select a day to see its transactions. Dates in UTC. Each transfer is counted once per currency.</p>{complete !== true && <p role="status" className="treasury-volume-warning">Partial history — totals include loaded records only.</p>}{series.excluded > 0 && <p role="status" className="treasury-volume-warning">{series.excluded} completed record(s) have no confirmed amount and are excluded.</p>}{!series.rows.length && <p>{complete === true ? `No completed ${currency} transfers in this period.` : `No completed ${currency} transfers in the loaded history for this period.`}</p>}</div>
    <div className="treasury-volume-ledger-heading"><button aria-expanded={showLedger} aria-controls={`${id}-ledger`} onClick={() => setShowLedger(value => !value)}><ReceiptText size={16}/>{showLedger ? 'Hide' : 'View'} {rows.length} transactions<ChevronDown size={14}/></button>{selection && <button onClick={reset}>Clear day filter</button>}</div>
    {showLedger && <div id={`${id}-ledger`}><p className="treasury-volume-caption">{selection ? dayLabel(selection.time) : `${period} period`} · {currency} · Completed</p>{renderLedger(rows)}</div>}
  </section>;
}
