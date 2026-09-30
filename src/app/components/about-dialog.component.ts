import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal
} from "@angular/core";
import { CommonModule } from "@angular/common";

import { UpdaterService } from "../services/updater.service";

/**
 * What this is and what version of it you have.
 *
 * Also where you check for a newer one by hand, which is the only place that
 * says "you are up to date" - the check on launch stays quiet unless it has
 * something to report.
 */
@Component({
  selector: "app-about-dialog",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="about" (click)="$event.stopPropagation()">
        <svg class="mark" viewBox="0 0 512 512" aria-hidden="true">
          <rect width="512" height="512" rx="96" fill="#062a44" />
          <path
            d="M 150 178 L 246 256 L 150 334"
            fill="none"
            stroke="#f05f36"
            stroke-width="46"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <rect x="288" y="296" width="80" height="40" rx="12" fill="#94a9bd" />
        </svg>

        <h1>Intentio Terminal</h1>
        <p class="version">{{ version() || "…" }}</p>
        <p class="blurb">A terminal that remembers what you were doing.</p>

        <div class="actions">
          <button type="button" class="primary" (click)="check()" [disabled]="checking()">
            {{ checking() ? "Checking…" : "Check for updates" }}
          </button>
          <button type="button" (click)="closed.emit()">Close</button>
        </div>

        <p class="credit">
          Terminal emulation by xterm.js. Built by Intentio Software.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
      }
      .about {
        width: min(330px, calc(100vw - 48px));
        padding: 26px 24px 18px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--panel-raised);
        box-shadow: 0 22px 54px rgba(0, 0, 0, 0.5);
        text-align: center;
      }
      .mark {
        width: 62px;
        height: 62px;
        border-radius: 14px;
      }
      h1 {
        margin: 12px 0 2px;
        font-size: 15px;
        font-weight: 600;
        color: var(--ink-strong);
      }
      .version {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: var(--ink-faint);
      }
      .blurb {
        margin: 11px 0 0;
        font-size: 12px;
        line-height: 1.55;
        color: var(--ink-muted);
      }
      .actions {
        display: flex;
        gap: 7px;
        margin-top: 18px;
      }
      button {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        background: var(--hover);
      }
      button.primary {
        border-color: var(--accent);
        color: var(--accent);
      }
      button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .credit {
        margin: 16px 0 0;
        font-size: 10.5px;
        line-height: 1.6;
        color: var(--ink-faint);
      }
    `
  ]
})
export class AboutDialogComponent implements OnInit {
  @Output() readonly closed = new EventEmitter<void>();

  private readonly updater = inject(UpdaterService);
  readonly version = signal("");
  readonly checking = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      this.version.set(`Version ${await getVersion()}`);
    } catch {
      this.version.set("Development build");
    }
  }

  async check(): Promise<void> {
    this.checking.set(true);
    await this.updater.checkNow();
    this.checking.set(false);
  }
}
