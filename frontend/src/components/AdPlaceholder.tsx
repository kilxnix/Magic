interface AdPlaceholderProps {
  size: 'sidebar' | 'leaderboard' | 'mobileBanner';
  className?: string;
}

const AD_SIZES = {
  sidebar: { width: 300, height: 250, label: '300x250' },
  leaderboard: { width: 728, height: 90, label: '728x90' },
  mobileBanner: { width: 320, height: 100, label: '320x100' },
};

export function AdPlaceholder({ size, className = '' }: AdPlaceholderProps) {
  const { width, height, label } = AD_SIZES[size];

  return (
    <div
      aria-label="Advertisement"
      role="complementary"
      className={`mx-auto flex max-w-full items-center justify-center border-2 border-dashed border-stone-300 bg-stone-100 text-stone-400 ${className}`}
      style={{ width: '100%', maxWidth: width, minHeight: height }}
    >
      <div className="text-center">
        <div className="text-xs font-medium uppercase tracking-wider">Advertisement</div>
        <div className="text-xs mt-1">{label}</div>
      </div>
    </div>
  );
}
