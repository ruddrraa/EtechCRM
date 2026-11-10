import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalProps {
  title: string
  children: ReactNode
  onClose: () => void
  maxWidth?: string | number
}

export function Modal({ title, children, onClose, maxWidth }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const modalContent = (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            type="button"
            className="icon-button modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body-scroll">{children}</div>
      </section>
    </div>
  )

  return createPortal(modalContent, document.body)
}
