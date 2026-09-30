import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  QueryList,
  ViewChildren,
  inject,
  signal
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

import { TerminalPaneComponent } from "./components/terminal-pane.component";
import { ShellService } from "./services/shell.service";
import { CURSOR_STYLES, SavedSession, TAB_COLOURS, TAB_EMOJI, Tab, TerminalSettings } from "./models/tab";

/** Size steps, so zoom lands on values that render crisply. */
const SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, TerminalPaneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css"
})
export class AppComponent implements OnInit {
  private readonly shell = inject(ShellService);

  @ViewChildren(TerminalPaneComponent) panes!: QueryList<TerminalPaneComponent>;

  readonly tabs = signal<Tab[]>([]);
  readonly active = signal<string>("");
  /** The tab whose settings popover is open. */
  readonly editing = signal<string>("");
  readonly renaming = signal<string>("");
  renameDraft = "";

  readonly colours = TAB_COLOURS;
  readonly emoji = TAB_EMOJI;
  readonly cursorStyles = CURSOR_STYLES;

  /** Preferences, and whether their panel is showing. */
  readonly settings = signal<TerminalSettings | null>(null);
  readonly settingsOpen = signal(false);
  readonly shells = signal<string[]>([]);

  /** The tab being dragged, and how far it has moved. */
  readonly dragging = signal<string>("");
  private dragFrom = 0;
  private dragStartX = 0;
  private moved = false;

  async ngOnInit(): Promise<void> {
    try {
      this.settings.set(await this.shell.settings());
      this.shells.set(await this.shell.shells());
    } catch {
      // Outside Tauri there are no preferences to read, and the app should
      // still come up.
    }
    const saved = await this.restore();
    if (!saved) {
      await this.newTab();
    }
    window.addEventListener("keydown", (event) => this.onKey(event));

    // Dismiss on a click anywhere else.
    //
    // On the document rather than the strip, because most of the window is
    // the terminal, and a panel you can only close by finding the small
    // button that opened it is a panel in the way. Capture phase so it still
    // fires when the click lands inside xterm, which stops propagation of its
    // own.
    document.addEventListener("pointerdown", (event) => this.dismissPopovers(event), true);
    // Tabs and their directories are saved as the window closes, so a crash
    // costs at most the current layout rather than the whole session.
    window.addEventListener("beforeunload", () => void this.persist());
    // And periodically, because "as the window closes" is not a promise an
    // operating system always keeps.
    setInterval(() => void this.persist(), 20_000);
  }

  private async restore(): Promise<boolean> {
    let saved: SavedSession;
    try {
      saved = await this.shell.savedSession();
    } catch {
      return false;
    }
    if (!saved?.tabs?.length) {
      return false;
    }
    this.tabs.set(saved.tabs.map((tab) => ({ ...tab, fontSize: tab.fontSize || 13 })));
    this.active.set(
      saved.tabs.some((tab) => tab.id === saved.active) ? saved.active : saved.tabs[0].id
    );
    return true;
  }

  private async persist(): Promise<void> {
    // Ask each shell where it actually is now rather than trusting what it was
    // opened with: the whole point of restoring a tab is landing back in the
    // directory you were working in, not the one you started in an hour ago.
    const tabs = await Promise.all(
      this.tabs().map(async (tab) => ({ ...tab, cwd: (await this.shell.cwd(tab.id)) ?? tab.cwd }))
    );
    this.tabs.set(tabs);
    await this.shell.saveSession(tabs, this.active());
  }

  async newTab(cwd = ""): Promise<void> {
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const source = this.tabs().find((tab) => tab.id === this.active());
    this.tabs.update((tabs) => [
      ...tabs,
      {
        id,
        name: "",
        // A new tab opens where the current one is, which is what you want
        // nine times in ten: another shell in the project you are already in.
        cwd: cwd || source?.cwd || "",
        colour: "",
        emoji: "",
        fontSize: source?.fontSize ?? 13
      }
    ]);
    this.active.set(id);
  }

  select(id: string): void {
    this.active.set(id);
    // A pane that was hidden measured as zero, so it has to re-measure before
    // it is usable.
    queueMicrotask(() => {
      const pane = this.panes?.find((p) => p.tab.id === id);
      pane?.refit();
      pane?.focus();
    });
  }

  async closeTab(id: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    await this.shell.close(id);
    const remaining = this.tabs().filter((tab) => tab.id !== id);
    this.tabs.set(remaining);
    if (!remaining.length) {
      await this.newTab();
      return;
    }
    if (this.active() === id) {
      this.select(remaining[remaining.length - 1].id);
    }
    void this.persist();
  }

  /** The shell ended by itself, so the tab goes with it. */
  onExited(id: string): void {
    void this.closeTab(id);
  }

  /** Close any open panel unless the click was inside one. */
  private dismissPopovers(event: Event): void {
    if (!this.editing() && !this.settingsOpen() && !this.renaming()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    // The button that opened it counts as inside, or the click that closes it
    // would be followed by the toggle reopening it.
    if (target?.closest(".settings, .cog, .preferences-button")) {
      return;
    }
    this.editing.set("");
    this.settingsOpen.set(false);
    if (this.renaming()) {
      this.commitRename(this.renaming());
    }
  }

  // ----------------------------------------------------------- preferences

  togglePreferences(event: Event): void {
    event.stopPropagation();
    this.settingsOpen.set(!this.settingsOpen());
    this.editing.set("");
  }

  /**
   * Change a preference and apply it at once.
   *
   * The cursor is the thing you are looking at while you change it, so a
   * setting that took effect in the next tab would be hard to judge.
   */
  async changeSettings(change: Partial<TerminalSettings>): Promise<void> {
    const next = { ...(this.settings() as TerminalSettings), ...change };
    this.settings.set(next);
    await this.shell.saveSettings(next);
  }

  // ------------------------------------------------------------ reordering

  /**
   * Drag a tab along the strip.
   *
   * Pointer events rather than HTML5 drag-and-drop: the strip is also the
   * window's drag region, and a native drag inside it would have the operating
   * system trying to move the window at the same time. Pointer capture keeps
   * every move coming here until the button is released, even when the cursor
   * leaves the strip.
   *
   * Order changes as you pass each neighbour rather than on drop, so the strip
   * shows what will happen instead of asking you to imagine it.
   */
  onTabPointerDown(tab: Tab, event: PointerEvent): void {
    // Only the primary button, and never from the buttons on the tab.
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) {
      return;
    }
    this.dragFrom = this.tabs().findIndex((t) => t.id === tab.id);
    this.dragStartX = event.clientX;
    this.moved = false;
    this.dragging.set(tab.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onTabPointerMove(event: PointerEvent): void {
    const id = this.dragging();
    if (!id) {
      return;
    }
    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (!this.moved && Math.abs(event.clientX - this.dragStartX) < 5) {
      return;
    }
    this.moved = true;

    const strip = (event.currentTarget as HTMLElement).parentElement;
    if (!strip) {
      return;
    }
    const elements = Array.from(strip.querySelectorAll<HTMLElement>(".tab"));
    // The tab whose middle the cursor has passed is the one to swap with.
    const target = elements.findIndex((element) => {
      const box = element.getBoundingClientRect();
      return event.clientX < box.left + box.width / 2;
    });
    const to = target === -1 ? elements.length - 1 : target;
    const from = this.tabs().findIndex((tab) => tab.id === id);
    if (to === from || to < 0) {
      return;
    }
    this.tabs.update((tabs) => {
      const next = [...tabs];
      const [moving] = next.splice(from, 1);
      next.splice(to, 0, moving);
      return next;
    });
  }

  onTabPointerUp(tab: Tab, event: PointerEvent): void {
    const wasDragging = this.dragging();
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.dragging.set("");
    if (!wasDragging) {
      return;
    }
    if (this.moved) {
      // It was a drag, not a click, so do not also switch tabs.
      void this.persist();
      return;
    }
    this.select(tab.id);
  }

  // ---------------------------------------------------------------- captions

  caption(tab: Tab): string {
    if (tab.name) {
      return tab.name;
    }
    if (!tab.cwd) {
      return "Shell";
    }
    const name = tab.cwd.split("/").filter(Boolean).pop() ?? "Shell";
    const home = tab.cwd.match(/^\/Users\/[^/]+$/);
    if (home) {
      return "~";
    }
    // Same rule as the Rust side: a three-character prefix on a client
    // repository is the designator worth showing.
    const [prefix, ...rest] = name.split("-");
    if (prefix.length === 3 && /^[a-z][a-z0-9]{2}$/i.test(prefix) && rest.length) {
      return prefix.toUpperCase();
    }
    return name;
  }

  startRename(tab: Tab, event: Event): void {
    event.stopPropagation();
    this.renameDraft = tab.name || this.caption(tab);
    this.renaming.set(tab.id);
    this.editing.set("");
  }

  commitRename(id: string): void {
    const name = this.renameDraft.trim();
    this.update(id, (tab) => ({ ...tab, name }));
    this.renaming.set("");
    void this.persist();
  }

  // ------------------------------------------------------------- appearance

  toggleSettings(id: string, event: Event): void {
    event.stopPropagation();
    this.editing.set(this.editing() === id ? "" : id);
    this.renaming.set("");
  }

  setColour(id: string, colour: string): void {
    this.update(id, (tab) => ({ ...tab, colour }));
    void this.persist();
  }

  setEmoji(id: string, emoji: string): void {
    this.update(id, (tab) => ({ ...tab, emoji }));
    void this.persist();
  }

  /** Change one tab's text size. Per tab, not per window: a log tail wants
   *  small and pairing wants large, often at the same time. */
  zoom(id: string, direction: 1 | -1): void {
    const tab = this.tabs().find((t) => t.id === id);
    if (!tab) {
      return;
    }
    const at = SIZES.indexOf(tab.fontSize);
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, (at < 0 ? 3 : at) + direction))];
    this.update(id, (t) => ({ ...t, fontSize: next }));
    this.panes?.find((p) => p.tab.id === id)?.setFontSize(next);
    void this.persist();
  }

  private update(id: string, change: (tab: Tab) => Tab): void {
    this.tabs.update((tabs) => tabs.map((tab) => (tab.id === id ? change(tab) : tab)));
  }

  // ------------------------------------------------------------------- keys

  private onKey(event: KeyboardEvent): void {
    // Escape closes whatever is open, before any of the shortcuts.
    if (event.key === "Escape" && (this.editing() || this.settingsOpen())) {
      event.preventDefault();
      this.editing.set("");
      this.settingsOpen.set(false);
      this.panes?.find((pane) => pane.tab.id === this.active())?.focus();
      return;
    }
    if (!event.metaKey) {
      return;
    }
    const tabs = this.tabs();
    if (event.key === "t") {
      event.preventDefault();
      void this.newTab();
    } else if (event.key === "w") {
      event.preventDefault();
      void this.closeTab(this.active());
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoom(this.active(), 1);
    } else if (event.key === "-") {
      event.preventDefault();
      this.zoom(this.active(), -1);
    } else if (event.key === "]" && event.shiftKey) {
      event.preventDefault();
      this.step(1);
    } else if (event.key === "[" && event.shiftKey) {
      event.preventDefault();
      this.step(-1);
    } else if (/^[1-9]$/.test(event.key)) {
      // Cmd+9 is the last tab, as it is everywhere else on macOS.
      event.preventDefault();
      const index = event.key === "9" ? tabs.length - 1 : Number(event.key) - 1;
      if (tabs[index]) {
        this.select(tabs[index].id);
      }
    }
  }

  private step(by: 1 | -1): void {
    const tabs = this.tabs();
    const at = tabs.findIndex((tab) => tab.id === this.active());
    if (at < 0 || tabs.length < 2) {
      return;
    }
    // Wraps, because a tab strip is a ring and stopping at the end is a small
    // irritation repeated hundreds of times a day.
    const next = (at + by + tabs.length) % tabs.length;
    this.select(tabs[next].id);
  }
}
