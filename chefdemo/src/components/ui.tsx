"use client";
import { useEffect, useRef } from "react";
import Image from "next/image";
import { ChefHat, X } from "lucide-react";
import { ServiceArea } from "@/lib/domain";

export function Brand({ subtitle = "Chef Login" }: { subtitle?: string }) {
  return (
    <div className="brand">
      <Image
        className="brand-logo"
        src="/khana-banao-logo.png"
        alt="Khana Banao"
        width={1260}
        height={427}
        priority
      />
      <small>{subtitle}</small>
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
export function AreaFields({
  areas,
  region,
  location,
  onRegion,
  onLocation,
  required,
  regionLabel = "Region",
  locationLabel = "Location",
}: {
  areas: ServiceArea[];
  region: string;
  location: string;
  onRegion: (value: string) => void;
  onLocation: (value: string) => void;
  required?: boolean;
  regionLabel?: string;
  locationLabel?: string;
}) {
  const live = areas.filter((a) => a.active);
  const regions = [...new Set(live.map((a) => a.region))].sort();
  const locations = live
    .filter((a) => a.region === region)
    .map((a) => a.name)
    .sort();
  return (
    <>
      <Field label={regionLabel}>
        <select
          name="region"
          value={region}
          required={required}
          onChange={(e) => {
            onRegion(e.target.value);
            onLocation("");
          }}
        >
          <option value="">Select region</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label={locationLabel}>
        <select
          name="location"
          value={location}
          required={required}
          disabled={!region}
          onChange={(e) => onLocation(e.target.value)}
        >
          <option value="">
            {region ? "Select location" : "Select a region first"}
          </option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>
    </>
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
