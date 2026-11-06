import { Button } from './Button'

export function PageHeader({ eyebrow, title, description, action, onAction }: { eyebrow?: string; title: string; description?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <Button onClick={onAction}>{action}</Button>}
    </div>
  )
}
