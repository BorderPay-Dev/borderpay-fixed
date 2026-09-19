import React, { useId, useMemo, useState } from 'react';
import { VolumePeriod, VOLUME_PERIODS, dayLabel } from './activity';
import { TreasuryValuation, valuationTotal, balanceDays } from './balance';
const number = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export function TreasuryActivityChart({ valuation, balanceVisible }: { valuation?: TreasuryValuation; balanceVisible: boolean }) {
  const [period, setPeriod] = useState<VolumePeriod>('1M');
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const active = hover ?? selected;
  const id = useId().replace(/:/g, '');
  const days = useMemo(() => balanceDays(valuation, VOLUME_PERIODS[period]), [valuation, period]);
  const total = valuationTotal(valuation);
  const day = active === null ? null : days[active];
  const maximum = Math.max(1, ...days.map(item => item.value));
  const points = days.map((item, index) => ({ x: index / Math.max(1, days.length - 1) * 1000, y: 176 - item.value / maximum * 152 }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const point = active === null ? null : points[active];
  const indexAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (points.length - 1));
  };
  return <section className="treasury-volume" aria-labelledby={`${id}-title`}>
    <div className="treasury-volume-top"><div><p className="treasury-volume-eyebrow">TREASURY</p><h2 id={`${id}-title`}>Balance history</h2></div></div>
    <div className="treasury-volume-heading"><p className="treasury-volume-value" data-testid="volume-value">{balanceVisible ? total === null ? 'Unavailable' : `$${number(total)}` : '••••••'} <span>USD</span></p><p className="treasury-volume-caption">Current total balance</p></div>
    {!balanceVisible ? <p className="treasury-volume-caption">Show your balance to view its history.</p> : days.length ? <>
      <div className="treasury-volume-scale"><span>${number(maximum)}</span><span>USD equivalent</span></div>
      <div className="treasury-volume-plot" role="slider" tabIndex={0} aria-label="Inspect daily treasury balance" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={active ?? points.length - 1} aria-valuetext={day ? `${dayLabel(day.time)}, ${number(day.value)} USD` : 'Use arrow keys to inspect a day.'}
        onPointerMove={event => setHover(indexAt(event))} onPointerLeave={() => setHover(null)}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setHover(indexAt(event)); }}
        onPointerUp={event => { setSelected(indexAt(event)); setHover(null); }} onPointerCancel={() => setHover(null)} onBlur={() => setHover(null)}
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setHover(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (active ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
          } else if (event.key === 'Escape') { setHover(null); setSelected(null); }
        }}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C7FF00" stopOpacity=".22"/><stop offset="100%" stopColor="#C7FF00" stopOpacity="0"/></linearGradient></defs>{[24,100,176].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#ffffff0c"/>)}<path d={`${path} L1000,190 L0,190 Z`} fill={`url(#${id}-fill)`}/><path d={path} fill="none" stroke="#C7FF00" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>{point && <g data-testid="volume-crosshair"><line x1={point.x} x2={point.x} y1="0" y2="190" stroke="#c7ff00" strokeOpacity=".5" strokeDasharray="4 4"/><circle cx={point.x} cy={point.y} r="4" fill="#c7ff00" stroke="#101418" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g>}</svg>
      </div>
      <p className="treasury-volume-caption" data-testid="volume-caption">{day ? `${dayLabel(day.time)} · $${number(day.value)} USD` : 'Daily closing balance · UTC'}</p>
      <div className="treasury-volume-dates"><span>{dayLabel(days[0].time)}</span><span>{dayLabel(days[days.length - 1].time)}</span></div>
      <div className="treasury-volume-periods" role="group" aria-label="Chart period">{(Object.keys(VOLUME_PERIODS) as VolumePeriod[]).map(value => <button key={value} aria-pressed={value === period} onClick={() => { setPeriod(value); setHover(null); setSelected(null); }}>{value}</button>)}</div>
    </> : <p role="status" className="treasury-volume-warning">Balance history is temporarily unavailable.</p>}
    <div className="treasury-volume-footnote"><p>All wallets valued in USD. History shows USD equivalent at current Bridge rates.</p></div>
  </section>;
}
