import type { ReactNode } from 'react';

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <span>{error}</span>
      {onDismiss && (
        <button type="button" className="banner-close" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * Empty states carry the instruction, because on a new account almost
 * everything is empty and that is the moment the seller needs direction.
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <p className="empty">{label}…</p>;
}
