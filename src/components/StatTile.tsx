interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

export function StatTile({ label, value, sub, accent }: StatTileProps) {
  return (
    <div
      className="card"
      style={{
        padding: '16px 18px',
        background: accent ? 'linear-gradient(135deg, var(--brand), var(--brand-deep))' : undefined,
        borderColor: accent ? 'transparent' : undefined,
        color: accent ? 'var(--on-brand)' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: accent ? 'rgba(255,255,255,0.82)' : 'var(--ink-500)',
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 26, fontWeight: 700, marginTop: 6, lineHeight: 1.15 }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontSize: 12,
            marginTop: 4,
            color: accent ? 'rgba(255,255,255,0.78)' : 'var(--ink-400)',
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
