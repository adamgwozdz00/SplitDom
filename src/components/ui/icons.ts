/** The app's line icons (24×24 path data, stroke = currentColor), drawn as in the design. */
export const ICON_PATHS = {
  "chevron-left": ["M15 18l-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  plus: ["M12 5v14M5 12h14"],
  check: ["M20 6 9 17l-5-5"],
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M10 21v-6h4v6"],
  receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6M9 12h6"],
  card: ["M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z", "M2 10h20"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 9h18M8 2v4M16 2v4"],
  user: ["M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"],
  "user-plus": ["M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M2 21c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5", "M19 8v6M16 11h6"],
  logout: ["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "M10 17l-5-5 5-5", "M5 12h11"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 15h10l1-15"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  lock: ["M6 11h12v10H6z", "M8 11V7a4 4 0 0 1 8 0v4"],
  alert: ["M12 3 2 21h20z", "M12 10v4M12 17.5v.5"],
  clock: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 7v5l3 2"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  mail: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"],
} as const;

export type IconName = keyof typeof ICON_PATHS;
