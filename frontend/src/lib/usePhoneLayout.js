import { useEffect, useState } from "react";

/** Keep phone-only disclosures out of the desktop layout, including after a resize. */
export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 680px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 680px)");
    const change = () => setPhone(media.matches);
    change();
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, []);
  return phone;
}
