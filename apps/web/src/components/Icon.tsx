import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "alert"
  | "archive"
  | "arrow-left"
  | "arrow-right"
  | "battery"
  | "bell"
  | "bike"
  | "calendar"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "close"
  | "download"
  | "filter"
  | "gear"
  | "help"
  | "home"
  | "list"
  | "location"
  | "logout"
  | "map"
  | "menu"
  | "more"
  | "package"
  | "pause"
  | "phone"
  | "plus"
  | "refresh"
  | "route"
  | "search"
  | "send"
  | "sliders"
  | "spark"
  | "store"
  | "users"
  | "wifi-off";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const content = (() => {
    switch (name) {
      case "activity": return <><path d="M3 12h4l2.5-7 5 14 2.5-7H21" /></>;
      case "alert": return <><path d="m12 3 9 16H3L12 3Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>;
      case "archive": return <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" /></>;
      case "arrow-left": return <><path d="m15 18-6-6 6-6" /></>;
      case "arrow-right": return <><path d="m9 18 6-6-6-6" /></>;
      case "battery": return <><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 10v4M6 10h8v4H6z" /></>;
      case "bell": return <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>;
      case "bike": return <><circle cx="5" cy="17" r="3" /><circle cx="19" cy="17" r="3" /><path d="M8 17h3l2-6h3l3 6M8 17l-2-7h4M11 17l-4-5M14 7h3" /></>;
      case "calendar": return <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>;
      case "check": return <><path d="m5 12 4 4L19 6" /></>;
      case "chevron-down": return <><path d="m6 9 6 6 6-6" /></>;
      case "chevron-right": return <><path d="m9 18 6-6-6-6" /></>;
      case "clock": return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
      case "close": return <><path d="m6 6 12 12M18 6 6 18" /></>;
      case "download": return <><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16" /></>;
      case "filter": return <><path d="M4 6h16M7 12h10M10 18h4" /></>;
      case "gear": return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>;
      case "help": return <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-.9.7-1.5 1.1-1.5 2.2M12 17h.01" /></>;
      case "home": return <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>;
      case "list": return <><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></>;
      case "location": return <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>;
      case "logout": return <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></>;
      case "map": return <><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3V6Z" /><path d="M8 3v15M16 6v15" /></>;
      case "menu": return <><path d="M4 6h16M4 12h16M4 18h16" /></>;
      case "more": return <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>;
      case "package": return <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9M8 5.3l8 4.5" /></>;
      case "pause": return <><path d="M9 6v12M15 6v12" /></>;
      case "phone": return <><path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-4-1-1.5 2.5a14 14 0 0 1-9-9L9 7 8 3Z" /></>;
      case "plus": return <><path d="M12 5v14M5 12h14" /></>;
      case "refresh": return <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18.7 7.5L20 12M4 12l1.3 4.5A7 7 0 0 0 17.9 15" /></>;
      case "route": return <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h2c5 0 1-12 6-12" /></>;
      case "search": return <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>;
      case "send": return <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>;
      case "sliders": return <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>;
      case "spark": return <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3ZM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>;
      case "store": return <><path d="M4 10v10h16V10M3 4h18l-2 6H5L3 4Z" /><path d="M9 20v-6h6v6" /></>;
      case "users": return <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 2.7-7 6-7s6 3 6 7M16 4a3 3 0 0 1 0 6M17 13c2.4.7 4 3.3 4 6" /></>;
      case "wifi-off": return <><path d="m3 3 18 18M8.5 8.5A10 10 0 0 1 21 10M3 10a15 15 0 0 1 2.6-1.5M6.5 14a8 8 0 0 1 6.4-2M10 18a3 3 0 0 1 4 0M12 21h.01" /></>;
    }
  })();

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {content}
    </svg>
  );
}
