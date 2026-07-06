export const TOOLBAR_STYLE_ID = "mcs-meet-toolbar-styles";

/** Meet-like neutral controls; recording = pause icon + pulsing live dot (no yellow / no full red pill). */
const CSS = `
[data-mcs-toolbar-root] {
  display: inline-flex !important;
  align-items: center !important;
  gap: 2px !important;
  margin: 0 0px !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  flex-shrink: 0 !important;
  vertical-align: middle !important;
}
[data-mcs-toolbar-root] button {
  appearance: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  outline: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}
[data-mcs-toolbar-root] button.mcs-capture-btn {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: #3c4043;
  color: #e8eaed;
  position: relative;
  z-index: 1;
}
[data-mcs-toolbar-root] button.mcs-capture-btn:hover {
  background: #4a4d51;
}
[data-mcs-toolbar-root] button.mcs-capture-btn:focus-visible {
  outline: 2px solid #8ab4f8;
  outline-offset: 2px;
}
[data-mcs-toolbar-root] button.mcs-capture-btn.mcs-recording {
  background: #3c4043;
  color: #e8eaed;
}
[data-mcs-toolbar-root] button.mcs-capture-btn.mcs-recording:hover {
  background: #4a4d51;
}
[data-mcs-toolbar-root] button.mcs-capture-arrow {
  width: 3.75rem;
  height: 3rem;
  border-radius: 2em 0 0 2em;
  background: #2d2e30;
  color: #e8eaed;
  margin-right: -1.25rem;
  position: relative;
  z-index: 0;
}
[data-mcs-toolbar-root] button.mcs-capture-arrow:hover {
  background: #3c4043;
  z-index: 1;
}
[data-mcs-toolbar-root] button[data-tooltip]::before {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background: #303134;
  color: #e8eaed;
  font-family: "Google Sans", Roboto, Arial, sans-serif;
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  padding: 6px 10px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
[data-mcs-toolbar-root] button[data-tooltip]:hover::before {
  opacity: 1;
}
[data-mcs-toolbar-root] button.mcs-capture-btn i.google-symbols.mcs-capture-btn__icon {
  font-size: 1.375rem;
  font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
  line-height: 1;
  color: #e8eaed;
}
[data-mcs-toolbar-root] button.mcs-capture-btn:not(.mcs-recording) i.mcs-capture-btn__icon {
  color: #f28b82;
}
[data-mcs-toolbar-root] button.mcs-capture-arrow i.google-symbols {
  font-size: 1.25rem;
  color: #9aa0a6;
  position: absolute;
  right: 1.75rem;
}
[data-mcs-toolbar-root] button.mcs-capture-btn .mcs-capture-btn__live {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ea4335;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  animation: mcs-live-dot 1.1s ease-in-out infinite;
}
@keyframes mcs-live-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.85); }
}
[data-mcs-toolbar-root] .mcs-toolbar-rec-meta {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  min-height: 3rem;
  padding: 4px 10px 4px 12px;
  margin-right: -0.35rem;
  border-radius: 1rem;
  color: #e8eaed;
  font-family: "Google Sans", Roboto, Arial, sans-serif;
  max-width: 11rem;
  z-index: 0;
  pointer-events: none;
}
[data-mcs-toolbar-root] .mcs-toolbar-rec-meta[hidden] {
  display: none !important;
}
[data-mcs-toolbar-root] .mcs-toolbar-rec-meta__code {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
[data-mcs-toolbar-root] .mcs-toolbar-rec-meta__time {
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: #9aa0a6;
  margin-top: 1px;
}
`;

export function ensureToolbarStyles(doc: Document): void {
  if (doc.getElementById(TOOLBAR_STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = TOOLBAR_STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
