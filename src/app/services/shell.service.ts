import { InjectionToken, Injectable, inject } from "@angular/core";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { SavedSession, SshHost, Tab, TerminalSettings } from "../models/tab";

/**
 * How the app reaches Rust.
 *
 * Injected rather than imported so tests can stand in for it: the unit-test
 * builder bundles specs before Vitest sees them, so a module mock never takes
 * effect and the seam has to be in the app.
 */
export const INVOKE = new InjectionToken<typeof tauriInvoke>("invoke", {
  providedIn: "root",
  factory: () => tauriInvoke
});

interface Chunk {
  id: string;
  data: string;
}

/**
 * The shells behind the tabs.
 *
 * Output arrives as one event stream for every tab, so this fans it out by id.
 * One listener rather than one per tab: a tab is created and destroyed often,
 * and a leaked listener on a busy terminal is thousands of dead callbacks a
 * second.
 */
@Injectable({ providedIn: "root" })
export class ShellService {
  private readonly invoke = inject(INVOKE);

  private readonly writers = new Map<string, (data: string) => void>();
  private readonly closers = new Map<string, () => void>();
  private listening = false;

  private async listenOnce(): Promise<void> {
    if (this.listening) {
      return;
    }
    this.listening = true;
    try {
      await listen<Chunk>("pty-output", (event) => {
        this.writers.get(event.payload.id)?.(event.payload.data);
      });
      await listen<string>("pty-exit", (event) => {
        this.closers.get(event.payload)?.();
      });
    } catch {
      // Outside Tauri there is nothing to listen to, which is the case in
      // tests and must not throw.
      this.listening = false;
    }
  }

  onOutput(id: string, write: (data: string) => void): () => void {
    void this.listenOnce();
    this.writers.set(id, write);
    return () => this.writers.delete(id);
  }

  onExit(id: string, closed: () => void): void {
    this.closers.set(id, closed);
  }

  async spawn(id: string, cwd: string, rows: number, cols: number): Promise<void> {
    await this.invoke("spawn_shell", {
      id,
      cwd: cwd || null,
      rows: Math.max(1, Math.round(rows)),
      cols: Math.max(1, Math.round(cols))
    });
  }

  async write(id: string, data: string): Promise<void> {
    await this.invoke("write_shell", { id, data });
  }

  async resize(id: string, rows: number, cols: number): Promise<void> {
    await this.invoke("resize_shell", {
      id,
      rows: Math.max(1, Math.round(rows)),
      cols: Math.max(1, Math.round(cols))
    });
  }

  async close(id: string): Promise<void> {
    this.writers.delete(id);
    this.closers.delete(id);
    await this.invoke("close_shell", { id });
  }

  /** Where a tab is working now. Null when the shell has gone. */
  async cwd(id: string): Promise<string | null> {
    return (await this.invoke<string | null>("shell_cwd", { id })) ?? null;
  }

  /** A short caption for a directory, e.g. STM for stm-front-end. */
  async label(cwd: string): Promise<string> {
    return this.invoke<string>("directory_label", { cwd });
  }

  /** Report what the renderer is doing, for a problem nobody can screenshot. */
  async diagnostics(report: Record<string, unknown>): Promise<void> {
    try {
      await this.invoke("record_diagnostics", { report });
    } catch {
      // Diagnostics must never be the thing that breaks the app.
    }
  }

  async settings(): Promise<TerminalSettings> {
    return this.invoke<TerminalSettings>("terminal_settings");
  }

  async saveSettings(next: TerminalSettings): Promise<void> {
    await this.invoke("set_terminal_settings", { next });
  }

  /** Machines from the ssh config and known_hosts. Names only; no keys are
   *  read, here or anywhere. */
  async sshHosts(): Promise<SshHost[]> {
    return this.invoke<SshHost[]>("ssh_hosts");
  }

  async shells(): Promise<string[]> {
    return this.invoke<string[]>("shells");
  }

  async savedSession(): Promise<SavedSession> {
    return this.invoke<SavedSession>("saved_session");
  }

  async saveSession(tabs: Tab[], active: string): Promise<void> {
    await this.invoke("save_session", { session: { tabs, active } });
  }
}
