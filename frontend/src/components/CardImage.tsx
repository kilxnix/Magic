import { useState, useEffect } from 'react';

interface CardImageProps {
  cardName: string;
  setCode?: string;
  className?: string;
  onClick?: () => void;
  showHoverZoom?: boolean;
  size?: 'normal' | 'small';
  face?: 'back';
}

// Card skeleton that mimics an MTG card shape
function CardSkeleton() {
  return (
    <div className="absolute inset-0 bg-stone-200 rounded-lg overflow-hidden">
      {/* Card frame simulation */}
      <div className="absolute inset-1 bg-stone-300 rounded-md">
        {/* Title bar */}
        <div className="h-[12%] bg-stone-400/50 m-1 rounded-t animate-pulse" />
        {/* Art box */}
        <div className="h-[40%] bg-stone-400/30 mx-1 animate-pulse" style={{ animationDelay: '150ms' }} />
        {/* Type line */}
        <div className="h-[8%] bg-stone-400/40 mx-1 mt-1 animate-pulse" style={{ animationDelay: '300ms' }} />
        {/* Text box */}
        <div className="h-[30%] bg-stone-400/20 mx-1 mt-1 rounded-b animate-pulse" style={{ animationDelay: '450ms' }}>
          <div className="p-2 space-y-1">
            <div className="h-2 bg-stone-400/30 rounded w-3/4" />
            <div className="h-2 bg-stone-400/30 rounded w-full" />
            <div className="h-2 bg-stone-400/30 rounded w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Build local API URL for card image
function getLocalImageUrl(cardName: string, setCode?: string, size: string = 'normal'): string {
  const encodedName = encodeURIComponent(cardName);
  let url = `/api/card-image/${encodedName}?size=${size}`;
  if (setCode) {
    url += `&set=${setCode}`;
  }
  return url;
}

export function CardImage({
  cardName,
  setCode,
  className = '',
  onClick,
  showHoverZoom = true,
  size = 'normal',
  face,
}: CardImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');

  // Clean the card name (remove "1x " prefix if present)
  const cleanName = cardName.replace(/^\d+x\s+/, '').replace(/\s+\*CMDR\*$/, '');

  // Load image - check local cache first, fall back to Scryfall
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    setImageUrl('');

    const faceParam = face ? `&face=${face}` : '';

    // For back faces, go directly to Scryfall (local cache only stores front faces)
    if (face === 'back') {
      const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}${setCode ? `&set=${setCode}` : ''}&format=image&version=${size}${faceParam}`;
      setImageUrl(scryfallUrl);
      return;
    }

    const localUrl = getLocalImageUrl(cleanName, setCode, size);

    // Fetch to check if it's cached or returns a redirect
    fetch(localUrl)
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';

        if (contentType.includes('image')) {
          // It's an image - use the local URL directly
          setImageUrl(localUrl);
        } else {
          // It's JSON with a scryfall_url fallback
          const data = await res.json();
          if (data.scryfall_url) {
            setImageUrl(data.scryfall_url + faceParam);
          } else {
            setHasError(true);
          }
        }
      })
      .catch(() => {
        // Network error - try Scryfall directly as fallback
        const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}${setCode ? `&set=${setCode}` : ''}&format=image&version=${size}${faceParam}`;
        setImageUrl(scryfallUrl);
      });
  }, [cleanName, setCode, size, face]);

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Loading skeleton */}
      {isLoading && !hasError && <CardSkeleton />}

      {/* Error state - image not in local cache */}
      {hasError && (
        <div className="absolute inset-0 bg-stone-200 rounded-lg flex items-center justify-center p-2">
          <span className="text-xs text-stone-500 text-center">{cleanName}</span>
        </div>
      )}

      {/* Card image */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={cleanName}
          className={`w-full h-full object-contain rounded-lg transition-all duration-200 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          } ${onClick ? 'cursor-pointer' : ''} ${
            showHoverZoom && isHovered ? 'transform scale-105 z-10 shadow-xl' : ''
          }`}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          onClick={onClick}
          loading="lazy"
        />
      )}

      {/* Hover zoom preview - use the resolved imageUrl */}
      {showHoverZoom && isHovered && !hasError && imageUrl && (
        <div className="absolute left-full ml-2 top-0 z-50 pointer-events-none hidden lg:block">
          <img
            src={imageUrl}
            alt={cleanName}
            className="w-64 rounded-lg shadow-2xl border border-stone-300"
          />
        </div>
      )}
    </div>
  );
}
