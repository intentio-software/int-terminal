import { Injectable, signal } from "@angular/core";

/** What the app has found out about a newer version. */
export interface UpdateNotice {
  version: string;
  notes: string;
  /** `found`, `downloading`, `ready`, `none` or `failed`. */
  state: "found" | "downloading" | "ready" | "none" | "failed";
  message: string;
}

/**
 * Checking whether there is a newer version.
 *
 * The check is quiet unless there is something to say. An app that announces
 * it has nothing to announce, every time you open it, teaches you to ignore it
 * - so a startup check that finds nothing says nothing, and only a check you
 * asked for reports that you are up to date.
 */
@Injectable({ providedIn: "root" })
export class UpdaterService {
  readonly notice = signal<UpdateNotice | null>(null);
  private update: { version: string; body?: string; downloadAndInstall: (cb?: unknown) => Promise<void> } | null = null;

  private inTauri(): boolean {
    return typeof (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] !== "undefined";
  }

  /** On launch. Silent when there is nothing, and silent when it fails:
   *  a network that is down is not news at the moment you open a terminal. */
  async checkQuietly(): Promise<void> {
    await this.check(false);
  }

  /** From the About dialog, where silence would look broken. */
  async checkNow(): Promise<void> {
    await this.check(true);
  }

  private async check(announce: boolean): Promise<void> {
    if (!this.inTauri()) {
      if (announce) {
        this.notice.set({
          version: "",
          notes: "",
          state: "none",
          message: "Updates only work in the desktop app."
        });
      }
      return;
    }
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (!found?.available) {
        if (announce) {
          this.notice.set({ version: "", notes: "", state: "none", message: "You are up to date." });
        }
        return;
      }
      this.update = found as never;
      this.notice.set({
        version: found.version,
        notes: found.body ?? "",
        state: "found",
        message: `Version ${found.version} is available.`
      });
    } catch (error) {
      if (announce) {
        this.notice.set({
          version: "",
          notes: "",
          state: "failed",
          message: `Could not check: ${error}`
        });
      }
    }
  }

  /** Download it and restart into it. */
  async install(): Promise<void> {
    if (!this.update) {
      return;
    }
    const version = this.update.version;
    this.notice.set({
      version,
      notes: "",
      state: "downloading",
      message: `Downloading ${version}…`
    });
    try {
      await this.update.downloadAndInstall();
      this.notice.set({
        version,
        notes: "",
        state: "ready",
        message: "Installed. Restarting…"
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      this.notice.set({
        version,
        notes: "",
        state: "failed",
        message: `Could not install: ${error}`
      });
    }
  }

  dismiss(): void {
    this.notice.set(null);
  }
}
