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
 * The About dialog.
 *
 * Deliberately identical to the one in Intentio Tasks and Intentio Mind Map -
 * same markup, same class names, same styling - so the apps read as one suite.
 *
 * The only difference is the icons. The others use PrimeNG's font, and pulling
 * a component library into a terminal for two glyphs is not a trade worth
 * making, so the cross and the refresh arrow are drawn inline. They are the
 * same shapes at the same size, which is what anybody actually sees.
 */
@Component({
  selector: "app-about-dialog",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="about-backdrop" (click)="closed.emit()">
      <div
        id="about-dialog"
        class="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aboutDialogTitle"
        aria-describedby="aboutDialogBody"
        (click)="$event.stopPropagation()"
      >
        <button
          type="button"
          class="about-close"
          aria-label="Close about dialog"
          (click)="closed.emit()"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              d="M 2 2 L 14 14 M 14 2 L 2 14"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <div class="about-header">
          <img src="assets/intentio-logo.png" alt="Intentio logo" class="about-logo" />
          <div class="about-title-group">
            <h2 id="aboutDialogTitle">Intentio Terminal</h2>
            <p>A terminal that remembers what you were doing.</p>
            <div class="about-version">
              <span>{{ version() }}</span>
              <button
                type="button"
                class="check-updates-btn"
                [disabled]="isCheckingUpdates()"
                (click)="checkForUpdates()"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  [class.spin]="isCheckingUpdates()"
                >
                  <path
                    d="M 13.5 8 A 5.5 5.5 0 1 1 11.6 3.8"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                  <path d="M 14.4 1.4 L 13.6 5.2 L 10 4" fill="currentColor" />
                </svg>
                {{ isCheckingUpdates() ? "Checking…" : "Check for updates" }}
              </button>
            </div>
          </div>
        </div>

        <div id="aboutDialogBody" class="about-body">
          <p>
            Tabs that come back where you left them, captioned by the work you were doing. Connect
            to a host you have already configured without typing it again, and keep every shell on
            its own footing - its own name, its own colour, its own text size.
          </p>
          <p class="about-license">
            {{ licensingNotice }}
          </p>
          <a
            class="about-link"
            href="https://intentiosoftware.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            intentiosoftware.com
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <path
                d="M 5 11 L 11 5 M 6 5 L 11 5 L 11 10"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      /* Above the app chrome, and below the notice layer so an update message
         appears in front of the blur rather than behind it. */
      .about-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        animation: aboutFadeIn 0.2s ease;
      }

      @keyframes aboutFadeIn {
        from {
          opacity: 0;
        }
      }

      .about-dialog {
        position: relative;
        width: min(420px, calc(100% - 32px));
        padding: 32px 24px 24px;
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(6, 42, 68, 0.95), rgba(12, 73, 108, 0.9));
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
        color: #fff;
        font-family: "Inter", system-ui, sans-serif;
      }

      .about-close {
        position: absolute;
        top: 0;
        right: 0;
        transform: translate(50%, -50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.12);
        color: inherit;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
      }

      .about-header {
        display: flex;
        gap: 14px;
        align-items: center;
        margin-bottom: 12px;
      }

      .about-logo {
        width: 56px;
        height: 56px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      }

      .about-title-group h2 {
        margin: 0;
        font-size: 1.2rem;
      }

      .about-title-group p {
        margin: 2px 0 0;
        font-size: 0.9rem;
        opacity: 0.85;
      }

      .about-version {
        font-size: 0.8rem;
        opacity: 0.8;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .check-updates-btn {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        border-radius: 6px;
        padding: 3px 10px;
        font-size: 0.78rem;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease;
      }

      .check-updates-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.16);
        border-color: rgba(255, 255, 255, 0.45);
      }

      .check-updates-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .spin {
        animation: aboutSpin 1s linear infinite;
      }

      @keyframes aboutSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .about-license {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.95);
        margin-bottom: 0.5rem;
      }

      .about-body {
        font-size: 0.92rem;
        line-height: 1.45;
      }

      .about-body p {
        margin-bottom: 12px;
      }

      .about-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #ffd6c9;
        text-decoration: none;
        font-weight: 600;
      }

      .about-link:hover {
        color: #fff;
      }
    `
  ]
})
export class AboutDialogComponent implements OnInit {
  @Output() readonly closed = new EventEmitter<void>();

  private readonly updater = inject(UpdaterService);

  readonly version = signal("v0.0.0");
  readonly licensingNotice = "Free for personal use – commercial license coming soon.";
  readonly isCheckingUpdates = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      this.version.set(`v${await getVersion()}`);
    } catch {
      this.version.set("Development build");
    }
  }

  async checkForUpdates(): Promise<void> {
    this.isCheckingUpdates.set(true);
    await this.updater.checkNow();
    this.isCheckingUpdates.set(false);
  }
}
