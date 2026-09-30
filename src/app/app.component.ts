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
import { SavedSession, TAB_COLOURS, TAB_EMOJI, Tab } from "./models/tab";

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

  async ngOnInit(): Promise<void> {
    const saved = await this.restore();
    if (!saved) {
      await this.newTab();
    }
    window.addEventListener("keydown", (event) => this.onKey(event));
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
