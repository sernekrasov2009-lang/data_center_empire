import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose?: () => void;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

/**
 * Общая рамка диалога. Клик по затемнению закрывает окно (если это разрешено),
 * Esc обрабатывает глобальный слой горячих клавиш.
 */
export function Modal({
  title,
  subtitle,
  closeLabel,
  onClose,
  size = "md",
  children,
  footer,
  testId,
}: ModalProps): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, [title]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId}
      >
        <header className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" className="modal__close" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
              ✕
            </button>
          )}
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}
