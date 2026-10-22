import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { warrantyPortal } from '@/lib/warranty';

export function WarrantyLookupLink({ manufacturer, serialNumber }: { manufacturer: string; serialNumber: string }) {
  const [message, setMessage] = useState('');
  const portal = warrantyPortal(manufacturer);
  if (!portal) return null;
  const serial = serialNumber.trim();
  return (
    <div className="warranty-lookup-control">
      <a
        className={`button button-secondary ${!serial ? 'warranty-lookup-disabled' : ''}`}
        href={portal.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!serial}
        onClick={(event) => {
          if (!serial) {
            event.preventDefault();
            return;
          }
          setMessage('');
          if (!navigator.clipboard?.writeText) {
            setMessage('The lookup page opened, but clipboard access is unavailable. Copy the serial manually.');
            return;
          }
          void navigator.clipboard
            .writeText(serial)
            .then(() => setMessage('Serial copied. Paste it into the manufacturer lookup page.'))
            .catch(() => setMessage('The lookup page opened, but the serial could not be copied. Copy it manually.'));
        }}
      >
        <ArrowUpRight size={14} /> Check on {portal.name}
      </a>
      <span className="warranty-lookup-note" aria-live="polite">
        {message || (serial ? 'Opens the official lookup and copies the serial.' : 'Enter a serial number to enable lookup.')}
      </span>
    </div>
  );
}
