import { toast } from 'sonner'

/** Toast with a clickable explorer link after a confirmed transaction. */
export function notifyTx(label: string, url: string): void {
  toast.success(
    <span>
      {label} confirmed.{' '}
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
        View transaction
      </a>
    </span>,
    { duration: 8000 },
  )
}
