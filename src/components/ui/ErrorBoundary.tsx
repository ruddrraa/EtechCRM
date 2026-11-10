import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './Button'

export interface ErrorBoundaryProps {
  children: ReactNode
  resetKey?: string | number
  title?: string
  description?: string
  onReset?: () => void
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    console.warn('[UI ErrorBoundary]', error?.name || 'RenderError', error?.message || 'Unexpected rendering error')
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  public handleReset = (): void => {
    this.setState({ hasError: false })
    this.props.onReset?.()
  }

  public handleReloadWorkspace = (): void => {
    if (typeof window !== 'undefined') {
      window.location.assign('/')
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    return (
      <div
        role="alert"
        style={{
          margin: '2rem auto',
          maxWidth: '480px',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '1.75rem',
          textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: '#fef2f2',
            color: '#dc2626',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <AlertTriangle size={22} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>
          {this.props.title ?? 'Something went wrong loading this view'}
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.5 }}>
          {this.props.description ??
            'An unexpected display error occurred. Your saved CRM records are safe. Try recovering this view or returning to the workspace.'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button type="button" variant="primary" size="md" onClick={this.handleReset}>
            <RefreshCw size={15} /> Try again
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={this.handleReloadWorkspace}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    )
  }
}
