import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { CardImage } from '../../../components/CardImage';
export function CardFace({
  cardName, className, size = 'small', onClick, children,
}: { cardName: string; className?: string; size?: 'normal' | 'small'; onClick?(): void; children?: ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={cn('relative overflow-hidden rounded-lg border border-card-border bg-card-stock', onClick && 'cursor-pointer', className)}
    >
      <CardImage cardName={cardName} size={size} showHoverZoom={false} className="h-full w-full object-cover" />
      {children}
    </div>
  );
}
