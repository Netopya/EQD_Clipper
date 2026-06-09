import type { ReactNode } from 'react';
import { Chip } from '@mui/material';
import Link from '@mui/material/Link';

export function statusChip(status: string) {
  const color =
    status === 'completed'
      ? 'success'
      : status === 'failed'
        ? 'error'
        : status === 'in_progress'
          ? 'warning'
          : 'default';
  return <Chip size="small" label={status} color={color} variant="outlined" />;
}

export function truncateUrl(url: string, max = 64) {
  if (url.length <= max) return url;
  return `${url.slice(0, max)}…`;
}

/** Opens in a new tab; safe for http(s) URLs from scraped pages. */
export function ExternalUrl({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ wordBreak: 'break-all' }}
    >
      {children}
    </Link>
  );
}
