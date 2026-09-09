"use client";
import { useEffect, useRef } from "react";
import { ChefHat, X } from "lucide-react";

export function Brand({ subtitle = "CHEF PARTNER" }: { subtitle?: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <ChefHat />
      </div>
      <div>
        ChefFlow<small>{subtitle}</small>
      </div>
    </div>
  );
}
export function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title = "Nothing here yet",
  text = "Your updates will appear here.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty-state">
      <ChefHat size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="flow-modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button className="close" aria-label="Close dialog" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export type Run = (
  operation: () => Promise<unknown>,
  message: string,
) => Promise<boolean>;
