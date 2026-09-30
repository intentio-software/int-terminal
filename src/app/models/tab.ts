/** A tab, as the app and the store both see it. */
export interface Tab {
  id: string;
  /** What the person called it. Empty means "use the working directory". */
  name: string;
  cwd: string;
  /** Hex colour for the strip, or empty for none. */
  colour: string;
  /** One emoji, shown before the name. */
  emoji: string;
  fontSize: number;
}

export interface SavedSession {
  tabs: Tab[];
  active: string;
}

/**
 * Colours offered for tabs.
 *
 * Muted on purpose. A strip of saturated tabs is harder to read than no colour
 * at all, and the point of colouring one is that it stands out from the rest.
 */
export const TAB_COLOURS = [
  { name: "None", value: "" },
  { name: "Ember", value: "#e8643c" },
  { name: "Amber", value: "#d9a441" },
  { name: "Moss", value: "#5f9463" },
  { name: "Steel", value: "#5b8aa6" },
  { name: "Plum", value: "#8a6ea8" },
  { name: "Clay", value: "#a8705b" }
];

/** A few emoji worth having to hand, rather than a full picker. */
export const TAB_EMOJI = ["", "🔧", "🧪", "🚀", "🐛", "📦", "🗄️", "📝", "⚙️", "🔍", "🌱", "🔥"];
