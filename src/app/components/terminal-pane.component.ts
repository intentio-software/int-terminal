import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  Output,
  EventEmitter,
  ViewChild,
  inject
} from "@angular/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

import { ShellService } from "../services/shell.service";
import { Tab, TerminalSettings } from "../models/tab";

/**
 * The terminal's colours, taken from the app's own palette.
 *
 * xterm draws into a canvas and inherits nothing, so the custom properties the
 * rest of the window uses have to be read out and handed over. Doing it this
 * way rather than repeating the hex means a theme change reaches the terminal
 * too, instead of leaving it the one panel that did not get the memo.
 */
function paletteTheme(): Record<string, string> {
  const style = getComputedStyle(document.body);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--surface", "#061a2c"),
    foreground: read("--ink", "#dbe6f0"),
    cursor: read("--accent", "#f05f36"),
    cursorAccent: read("--surface", "#061a2c"),
    selectionBackground: read("--selection", "rgba(240, 95, 54, 0.25)")
  };
}

/**
 * One tab's terminal.
 *
 * Kept alive while its tab is in the background rather than destroyed and
 * rebuilt: a shell you switch away from is still running, and rebuilding the
 * view would lose the scrollback and the screen a full-screen program had
 * drawn. Hidden tabs are hidden with CSS, not unmounted.
 */
@Component({
  selector: "app-terminal-pane",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="surface" #surface></div>`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }
      .surface {
        height: 100%;
        padding: 6px 0 0 8px;
      }
    `
  ]
})
export class TerminalPaneComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) tab!: Tab;
  @Input() set settings(value: TerminalSettings | null) {
    this.current = value;
    this.applyCursor();
  }
  /** Raised when the shell exits, so the tab can close itself. */
  @Output() readonly exited = new EventEmitter<string>();

  @ViewChild("surface", { static: true }) surface!: ElementRef<HTMLDivElement>;

  private readonly shell = inject(ShellService);
  private current: TerminalSettings | null = null;
  private terminal: Terminal | null = null;
  private fit: FitAddon | null = null;
  private detach: (() => void) | null = null;
  private observer: ResizeObserver | null = null;

  async ngAfterViewInit(): Promise<void> {
    const terminal = new Terminal({
      fontFamily: '"SF Mono", Menlo, "JetBrains Mono", monospace',
      fontSize: this.tab.fontSize,
      cursorBlink: this.current?.cursorBlink ?? true,
      cursorStyle: this.current?.cursorStyle ?? "block",
      cursorInactiveStyle: this.current?.cursorInactive ?? "outline",
      // Enough to scroll back through a build, not enough to hoard memory.
      scrollback: 10_000,
      macOptionIsMeta: true,
      allowProposedApi: true,
      theme: paletteTheme()
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(this.surface.nativeElement);

    // Without a renderer addon xterm falls back to drawing rows as DOM nodes,
    // which leaves ghosts: text struck through by lines that belong to rows
    // that were supposed to have been cleared. The GPU renderer draws the
    // whole screen each frame and has nothing to leave behind.
    //
    // It can fail - a lost context, a machine with no usable GPU - and losing
    // the renderer must not lose the terminal, so the DOM path stays as the
    // fallback it was always meant to be.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // Left on the DOM renderer, which is slower but still works.
    }

    fit.fit();

    this.terminal = terminal;
    this.fit = fit;
    this.applyCursor();

    terminal.onData((data) => void this.shell.write(this.tab.id, data));

    this.detach = this.shell.onOutput(this.tab.id, (data) => terminal.write(data));
    this.shell.onExit(this.tab.id, () => this.exited.emit(this.tab.id));

    await this.shell.spawn(this.tab.id, this.tab.cwd, terminal.rows, terminal.cols);

    // The pane changes size when the window does and when the tab strip wraps,
    // so watch the element rather than the window.
    this.observer = new ResizeObserver(() => this.refit());
    this.observer.observe(this.surface.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.detach?.();
    this.terminal?.dispose();
  }

  /** Re-measure and tell the shell. Called when shown, resized or zoomed. */
  refit(): void {
    if (!this.terminal || !this.fit) {
      return;
    }
    // A hidden element measures as zero, and telling a shell it is 0x0 wrecks
    // whatever is drawing in it.
    if (!this.surface.nativeElement.offsetParent) {
      return;
    }
    this.fit.fit();
    void this.shell.resize(this.tab.id, this.terminal.rows, this.terminal.cols);
  }

  /** Put the cursor preferences on a terminal that already exists. */
  private applyCursor(): void {
    const terminal = this.terminal;
    const settings = this.current;
    if (!terminal || !settings) {
      return;
    }
    terminal.options.cursorBlink = settings.cursorBlink;
    terminal.options.cursorStyle = settings.cursorStyle;
    terminal.options.cursorInactiveStyle = settings.cursorInactive;
    terminal.options.theme = {
      ...paletteTheme(),
      ...(settings.cursorColour ? { cursor: settings.cursorColour } : {})
    };
  }

  setFontSize(size: number): void {
    if (this.terminal) {
      this.terminal.options.fontSize = size;
      this.refit();
    }
  }

  focus(): void {
    this.terminal?.focus();
  }
}
