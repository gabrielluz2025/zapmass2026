import React, { useState } from 'react';
import { User as UserIcon } from 'lucide-react';

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

type ProfileAvatarProps = {
  photoURL?: string | null;
  displayName?: string | null;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: React.CSSProperties;
  iconClassName?: string;
};

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  photoURL,
  displayName,
  className = 'w-8 h-8 rounded-md object-cover',
  fallbackClassName = 'w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold',
  fallbackStyle,
  iconClassName = 'w-3.5 h-3.5'
}) => {
  const [failed, setFailed] = useState(false);
  const label = displayName?.trim() || 'Usuário';
  const initials = initialsFromName(label);
  const showPhoto = Boolean(photoURL?.trim()) && !failed;

  if (showPhoto) {
    return (
      <img
        src={photoURL!}
        alt=""
        className={className}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={fallbackClassName}
      style={fallbackStyle ?? { background: 'var(--brand-600)', color: '#fff' }}
    >
      {initials || <UserIcon className={iconClassName} />}
    </div>
  );
};
