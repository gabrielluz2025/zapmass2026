import React from 'react';

type Props = {
  src: string;
  name: string;
  size?: number;
  className?: string;
};

export const WaAvatar: React.FC<Props> = ({ src, name, size = 49, className = '' }) => (
  <img
    src={src}
    alt={name}
    width={size}
    height={size}
    className={`rounded-full object-cover flex-shrink-0 bg-[#dfe5e7] ${className}`}
    loading="lazy"
    onError={(e) => {
      const el = e.currentTarget;
      el.onerror = null;
      el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=00a884&color=fff&size=200`;
    }}
  />
);
