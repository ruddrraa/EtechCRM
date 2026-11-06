import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'

export function EmptyState({ title = 'Nothing here yet', description = 'Records will appear here when they are available.' }) {
  return <div className="state-box"><Inbox size={20} /><strong>{title}</strong><span>{description}</span></div>
}

export function LoadingState() {
  return <div className="state-box"><LoaderCircle className="spin" size={20} /><strong>Loading preview</strong><span>Preparing the workspace for you.</span></div>
}

export function ErrorState() {
  return <div className="state-box state-error"><AlertCircle size={20} /><strong>Unable to load this preview</strong><span>Try again when the connected service is available.</span></div>
}
