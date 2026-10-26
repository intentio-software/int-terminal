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

/** One frame, so a freshly created element has been laid out and can be
 *  measured. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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
  /**
   * Whether this pane is the one on screen.
   *
   * The GPU renderer follows it. Panes are hidden rather than unmounted, so
   * without this every background tab keeps a live WebGL context, and a
   * browser engine only grants about sixteen before it starts destroying the
   * oldest to make room - which, with a dozen tabs open, is the one you are
   * looking at. A tab you cannot see has nothing to draw.
   */
  @Input() set showing(value: boolean) {
    this.visible = value;
    this.syncRenderer();
  }
  /** Raised when the shell exits, so the tab can close itself. */
  @Output() readonly exited = new EventEmitter<string>();

  @ViewChild("surface", { static: true }) surface!: ElementRef<HTMLDivElement>;

  private readonly shell = inject(ShellService);
  private current: TerminalSettings | null = null;
  private terminal: Terminal | null = null;
  private fit: FitAddon | null = null;
  private webgl: WebglAddon | null = null;
  private visible = false;
  private renderer = "dom";
  private rendererError = "";
  private detach: (() => void) | null = null;
  private observer: ResizeObserver | null = null;
  private pendingFit = 0;
  /** The size the shell was last told, so it is not told again for nothing. */
  private toldRows = 0;
  private toldCols = 0;

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

    this.terminal = terminal;
    this.fit = fit;
    this.applyCursor();
    this.syncRenderer();

    // Measure only once the element has a size.
    //
    // open() and fit() in the same tick gives xterm's untouched 80x24,
    // because the element has not been laid out yet and there is nothing to
    // measure. The shell then gets told 80x24 while the window is half again
    // as wide, and every program in it draws for a screen that is not the one
    // on display - text struck through by lines meant for other rows, and old
    // output left behind because the terminal and the program disagree about
    // where the rows are.
    await nextFrame();
    fit.fit();

    terminal.onData((data) => void this.shell.write(this.tab.id, data));

    // Written as bytes, not a string. xterm carries UTF-8 decoding state
    // across writes, so a character split by a read boundary survives - which
    // is the whole reason the shell's output arrives here as bytes.
    this.detach = this.shell.onOutput(this.tab.id, (bytes) => terminal.write(bytes));
    this.shell.onExit(this.tab.id, () => this.exited.emit(this.tab.id));

    // Spawned with the fitted size, never the default: the first thing a
    // shell does is draw a prompt, and it should draw it for this window.
    this.toldRows = terminal.rows;
    this.toldCols = terminal.cols;
    await this.shell.spawn(this.tab.id, this.tab.cwd, terminal.rows, terminal.cols);

    void this.shell.diagnostics({
      when: "after fit and spawn",
      theme: paletteTheme(),
      rawSurface: getComputedStyle(document.body).getPropertyValue("--surface"),
      renderer: this.renderer,
      rendererError: this.rendererError,
      devicePixelRatio: window.devicePixelRatio,
      rows: terminal.rows,
      cols: terminal.cols,
      fontSize: terminal.options.fontSize,
      fontFamily: terminal.options.fontFamily,
      surface: {
        width: this.surface.nativeElement.clientWidth,
        height: this.surface.nativeElement.clientHeight
      }
    });

    // The pane changes size when the window does and when the tab strip wraps,
    // so watch the element rather than the window.
    this.observer = new ResizeObserver(() => this.refit());
    this.observer.observe(this.surface.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.pendingFit) {
      cancelAnimationFrame(this.pendingFit);
    }
    this.observer?.disconnect();
    this.detach?.();
    this.webgl?.dispose();
    this.terminal?.dispose();
  }

  /**
   * Re-measure and tell the shell. Called when shown, resized or zoomed.
   *
   * Dragging a window edge fires the observer on every pixel, but a terminal
   * only changes shape every ten pixels or so - a cell is wider than that.
   * Fitting is coalesced into the next frame, and the shell is only told when
   * the row or column count has actually moved: every SIGWINCH makes whatever
   * is running redraw itself, and a full-screen program redrawing sixty times
   * a second while somebody drags a corner is the flicker people complain
   * about.
   */
  /**
   * Give the GPU renderer to the visible pane and take it back from the rest.
   *
   * Without a renderer addon xterm draws rows as DOM nodes, which is slower
   * but correct - so a backgrounded tab is left on it rather than holding a
   * context it is not using. Contexts are the scarce thing: a browser engine
   * grants a handful per page and destroys the oldest when it runs out, and
   * the oldest is usually the tab that has been open longest, not the one
   * least needed.
   */
  private syncRenderer(): void {
    const terminal = this.terminal;
    if (!terminal) {
      // Built in ngAfterViewInit, which calls this again once there is one.
      return;
    }
    if (this.visible && !this.webgl) {
      try {
        const webgl = new WebglAddon();
        // A context can still be lost - the GPU resets, the machine sleeps.
        // Losing the renderer must not lose the terminal, so the DOM path
        // stays as the fallback it was always meant to be.
        webgl.onContextLoss(() => this.dropRenderer("context lost"));
        terminal.loadAddon(webgl);
        this.webgl = webgl;
        this.renderer = "webgl";
        this.rendererError = "";
        // The new renderer starts with an empty frame. Repaint what is on
        // screen now rather than waiting for the shell to say something,
        // which on an idle tab could be a long time to look at nothing.
        terminal.refresh(0, terminal.rows - 1);
      } catch (error) {
        // Recorded rather than swallowed: a renderer that quietly refused to
        // load is exactly the kind of thing that wastes an afternoon.
        this.renderer = "dom";
        this.rendererError = String(error);
        void this.shell.diagnostics({
          when: "webgl renderer refused to load",
          tab: this.tab.id,
          error: this.rendererError
        });
      }
    } else if (!this.visible && this.webgl) {
      this.dropRenderer("hidden");
    }
  }

  private dropRenderer(why: string): void {
    this.webgl?.dispose();
    this.webgl = null;
    this.renderer = "dom";
    if (why !== "hidden") {
      // Worth a record: a lost context is invisible from the outside and is
      // the kind of thing that only ever gets reported as "it looked wrong".
      void this.shell.diagnostics({ when: "webgl " + why, tab: this.tab.id });
    }
  }

  refit(): void {
    if (this.pendingFit) {
      return;
    }
    this.pendingFit = requestAnimationFrame(() => {
      this.pendingFit = 0;
      this.fitNow();
    });
  }

  private fitNow(): void {
    const terminal = this.terminal;
    if (!terminal || !this.fit) {
      return;
    }
    // Zero means the pane is not on screen at all. Telling a shell it is 0x0
    // wrecks whatever is drawing in it, so leave the last good size in place.
    const element = this.surface.nativeElement;
    if (!element.clientWidth || !element.clientHeight) {
      return;
    }

    this.fit.fit();
    if (terminal.rows === this.toldRows && terminal.cols === this.toldCols) {
      return;
    }
    this.toldRows = terminal.rows;
    this.toldCols = terminal.cols;
    void this.shell.resize(this.tab.id, terminal.rows, terminal.cols);
    void this.shell.diagnostics({
      when: "after a resize",
      renderer: this.renderer,
      rows: terminal.rows,
      cols: terminal.cols,
      surface: { width: element.clientWidth, height: element.clientHeight }
    });
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
      // Straight away rather than coalesced: the cell size changed, so what is
      // on screen is wrong until this happens, and a frame of wrong text is
      // more noticeable than a frame of late text.
      this.fitNow();
    }
  }

  focus(): void {
    this.terminal?.focus();
  }
}
