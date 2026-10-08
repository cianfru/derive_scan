import { useState } from "react";

/** Native disclosure; charts can wait until opened so they measure a visible container. */
export default function PhoneDisclosure({ title, children, lazy = false, className = "" }) {
  const [open, setOpen] = useState(false);
  return <details className={`phone-research-fold ${className}`} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{title}<span aria-hidden="true">+</span></summary>
    {(!lazy || open) && children}
  </details>;
}
