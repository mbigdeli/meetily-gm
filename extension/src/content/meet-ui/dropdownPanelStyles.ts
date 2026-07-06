export const PANEL_Z_INDEX = "2147483647";
export const ACCENT = "#8ab4f8";
export const MUTED = "rgba(232, 234, 237, 0.38)";

export const CLONE_PANEL_PROPS = [
  "background",
  "background-color",
  "border-radius",
  "box-shadow",
  "padding",
  "font-family",
  "font-size",
  "color",
] as const;

export const STYLE_ID = "mcs-dropdown-panel-styles";

export const FALLBACK_PANEL_STYLE: Partial<Record<(typeof CLONE_PANEL_PROPS)[number], string>> = {
  background: "#2c2c2c",
  "background-color": "#2c2c2c",
  "border-radius": "2.25rem",
  "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.35)",
  "font-family": "'Google Sans', Roboto, sans-serif",
  "font-size": "13px",
  color: "#e8eaed",
  padding: "10px 16px",
};
