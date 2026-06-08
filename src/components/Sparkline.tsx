import React from 'react';

interface Props {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  id?: string;
}

export const Sparkline: React.FC<Props> = ({
  values,
  color = '#10b981',
  width = 120,
  height = 28,
  id = 'spark'
}) => {
  if (!values.length) return <div style={{ width, height }} />;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`)
    .join(' ');
  const lastX = (values.length - 1) * step;
  const lastY = height - (values[values.length - 1] / max) * (height - 4) - 2;
  const gradId = `${id}-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${points} ${lastX},${height}`}
        fill={`url(#${gradId})`}
        stroke="none"
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
};
