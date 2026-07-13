import Icon from './Icon'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Themed replacement for window.confirm() so dialogs match the app's
 * dark amber design instead of dropping to a native OS box.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button close-btn" onClick={onCancel} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <p
          style={{
            margin: `0 0 var(--sp-5)`,
            color: 'var(--muted-strong)',
            fontSize: 'var(--fs-base)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div className="modal-footer align-end">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
