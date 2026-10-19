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
  { name: "Rust", value: "#c4552f" },
  { name: "Clay", value: "#a8705b" },
  { name: "Amber", value: "#d9a441" },
  { name: "Ochre", value: "#b8862b" },

  { name: "Moss", value: "#5f9463" },
  { name: "Sage", value: "#7fa389" },
  { name: "Teal", value: "#3f8f8a" },
  { name: "Steel", value: "#5b8aa6" },
  { name: "Indigo", value: "#4f6bab" },

  { name: "Plum", value: "#8a6ea8" },
  { name: "Mauve", value: "#a0729a" },
  { name: "Rose", value: "#b56576" },
  { name: "Slate", value: "#6b7a8d" },
  { name: "Stone", value: "#8a8578" }
];

/**
 * Marks for a tab, grouped the way somebody reaches for them.
 *
 * Kept to a list rather than a full picker. A system emoji picker offers
 * several thousand, which is worse than useless for labelling eight tabs:
 * what makes a strip readable is a handful of marks you recognise instantly,
 * and a long hunt for the perfect one is time spent not working.
 */
export const TAB_EMOJI = [
  "",
  // What the tab is for
  "🔧", "🧪", "🐛", "🚀", "📦", "🗄️", "📝", "⚙️", "🔍", "🧹", "📐", "🎨",
  // Where it is pointed
  "🏠", "☁️", "🔌", "🖥️", "🌐", "🔒", "🗃️", "📡",
  // How it is going
  "🔥", "⚡", "🌱", "✅", "⏳", "⚠️", "💤", "👀",
  // Whose it is
  "🦀", "🐍", "🟦", "🐳", "🍎", "🧩", "☕", "🧠"
];


/** Preferences that belong to the person, not to a tab. */
export interface TerminalSettings {
  shell: string;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  cursorColour: string;
  cursorInactive: "outline" | "block" | "bar" | "underline" | "none";
}

export const CURSOR_STYLES: { value: TerminalSettings["cursorStyle"]; name: string }[] = [
  { value: "block", name: "Block" },
  { value: "bar", name: "Line" },
  { value: "underline", name: "Underline" }
];

/** A machine from ~/.ssh/config or ~/.ssh/known_hosts. */
export interface SshHost {
  alias: string;
  hostname?: string;
  user?: string;
  port?: string;
  /** `config` for one you defined, `known` for one you have merely visited. */
  source: "config" | "known";
  /** The name suggests production. A warning, never a restriction. */
  looksLive: boolean;
}
