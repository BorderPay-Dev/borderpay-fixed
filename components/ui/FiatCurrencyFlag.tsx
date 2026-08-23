type Props = {
  currency: string;
  className?: string;
};

export function FiatCurrencyFlag({ currency, className = 'h-12 w-12' }: Props) {
  const code = String(currency || '').toUpperCase();
  if (!['USD', 'EUR', 'GBP'].includes(code)) return null;

  return (
    <span
      className={`${className} inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/10`}
      aria-hidden="true"
    >
      {code === 'USD' ? <UnitedStatesFlag /> : code === 'GBP' ? <UnitedKingdomFlag /> : <EuropeanUnionFlag />}
    </span>
  );
}

function UnitedStatesFlag() {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="48" height="48" fill="#fff" />
      {[0, 8, 16, 24, 32, 40].map((y) => <rect key={y} y={y} width="48" height="4" fill="#B22234" />)}
      <rect width="23" height="26" fill="#3C3B6E" />
      {[5, 12, 19].flatMap((y) => [4, 10, 16].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" fill="#fff" />))}
    </svg>
  );
}

function UnitedKingdomFlag() {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="48" height="48" fill="#012169" />
      <path d="M0 0L48 48M48 0L0 48" stroke="#fff" strokeWidth="11" />
      <path d="M0 0L48 48M48 0L0 48" stroke="#C8102E" strokeWidth="5" />
      <path d="M24 0V48M0 24H48" stroke="#fff" strokeWidth="15" />
      <path d="M24 0V48M0 24H48" stroke="#C8102E" strokeWidth="8" />
    </svg>
  );
}

function EuropeanUnionFlag() {
  const stars = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 12 - Math.PI / 2;
    return { x: 24 + Math.cos(angle) * 13, y: 24 + Math.sin(angle) * 13 };
  });
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="48" height="48" fill="#003399" />
      {stars.map(({ x, y }, index) => <circle key={index} cx={x} cy={y} r="1.7" fill="#FFCC00" />)}
    </svg>
  );
}
