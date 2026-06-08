import React, { useMemo, useState } from 'react';

type Size = 'sm' | 'md';

const sizeClass: Record<Size, string> = {
  sm: 'w-8 h-8 rounded-full text-xs',
  md: 'w-14 h-14 rounded-2xl text-lg shadow-lg'
};

interface Props {
  name: string;
  profilePicUrl?: string;
  size?: Size;
  className?: string;
}

export const ContactAvatar: React.FC<Props> = ({
  name,
  profilePicUrl,
  size = 'sm',
  className = ''
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = useMemo(() => {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  }, [name]);

  const pic = (profilePicUrl || '').trim();
  const showPic = !imgFailed && (pic.startsWith('http') || pic.startsWith('data:'));

  return (
    <div
      className={`flex items-center justify-center text-white font-bold shrink-0 overflow-hidden ${sizeClass[size]} ${className}`}
      style={
        showPic
          ? undefined
          : { background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }
      }
    >
      {showPic ? (
        <img
          src={pic}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initials
      )}
    </div>
  );
};
