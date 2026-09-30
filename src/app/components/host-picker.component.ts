import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  computed,
  signal
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

import { SshHost } from "../models/tab";

/**
 * Somewhere to connect, without typing it again.
 *
 * The hosts come from the ssh config you already keep, so this adds a way to
 * pick one rather than a second place to describe them. `ssh` does the
 * connecting with that same config, which is why jump hosts, identity files
 * and everything else clever in there keeps working.
 */
@Component({
  selector: "app-host-picker",
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="cancelled.emit()">
      <div class="picker" (click)="$event.stopPropagation()">
        <input
          #field
          class="query"
          type="text"
          placeholder="Connect to…"
          [(ngModel)]="query"
          (ngModelChange)="highlighted.set(0)"
          (keydown)="onKey($event)"
        />

        @if (matches().length) {
          <ul class="results">
            @for (host of matches(); track host.alias; let i = $index) {
              <li
                class="result"
                [class.on]="i === highlighted()"
                (mouseenter)="highlighted.set(i)"
                (click)="chosen.emit(host)"
              >
                <span class="alias">{{ host.alias }}</span>
                @if (host.looksLive) {
                  <span class="live" title="The name suggests production">live</span>
                }
                <span class="detail">{{ detail(host) }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">Nothing matching. Anything you type is passed to ssh as it is.</p>
        }

        <p class="foot">
          From your ssh config and known hosts. <strong>↵</strong> to connect,
          <strong>esc</strong> to close.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        justify-content: center;
        padding-top: 84px;
        background: rgba(0, 0, 0, 0.35);
      }
      .picker {
        width: min(560px, calc(100vw - 48px));
        max-height: 60vh;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel-raised);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }
      .query {
        padding: 13px 16px;
        border: none;
        border-bottom: 1px solid var(--border);
        background: transparent;
        color: var(--ink-strong);
        font: inherit;
        font-size: 14px;
        outline: none;
      }
      .results {
        margin: 0;
        padding: 5px;
        list-style: none;
        overflow-y: auto;
      }
      .result {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 7px 11px;
        border-radius: 7px;
        font-size: 13px;
        cursor: default;
      }
      .result.on {
        background: var(--selected);
      }
      .alias {
        color: var(--ink-strong);
      }
      /* Stated, not enforced. A name is a hint about a machine, not a fact. */
      .live {
        padding: 1px 6px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--danger) 22%, transparent);
        color: var(--danger);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .detail {
        margin-left: auto;
        color: var(--ink-faint);
        font-size: 11.5px;
        font-family: var(--font-mono);
      }
      .empty,
      .foot {
        margin: 0;
        padding: 11px 16px;
        color: var(--ink-faint);
        font-size: 11.5px;
      }
      .foot {
        border-top: 1px solid var(--border);
      }
      strong {
        color: var(--ink-muted);
        font-weight: 600;
      }
    `
  ]
})
export class HostPickerComponent implements OnInit {
  @Input() hosts: SshHost[] = [];
  @Output() readonly chosen = new EventEmitter<SshHost>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild("field", { static: true }) field!: ElementRef<HTMLInputElement>;

  query = "";
  readonly highlighted = signal(0);
  private readonly typed = signal("");

  ngOnInit(): void {
    this.field.nativeElement.focus();
  }

  readonly matches = computed(() => {
    const needle = this.typed().trim().toLowerCase();
    const all = this.all;
    if (!needle) {
      // Hosts you have defined first: a config entry is a deliberate act and a
      // known_hosts line is a side effect of having connected once.
      return all.filter((host) => host.source === "config").slice(0, 40);
    }
    return all
      .filter((host) => this.haystack(host).includes(needle))
      .sort((a, b) => this.rank(a, needle) - this.rank(b, needle))
      .slice(0, 40);
  });

  private all: SshHost[] = [];

  ngOnChanges(): void {
    this.all = this.hosts;
  }

  private haystack(host: SshHost): string {
    return `${host.alias} ${host.hostname ?? ""} ${host.user ?? ""}`.toLowerCase();
  }

  /** A name that starts with what you typed beats one that merely contains it. */
  private rank(host: SshHost, needle: string): number {
    const alias = host.alias.toLowerCase();
    const defined = host.source === "config" ? 0 : 4;
    if (alias === needle) return defined;
    if (alias.startsWith(needle)) return defined + 1;
    if (alias.includes(needle)) return defined + 2;
    return defined + 3;
  }

  detail(host: SshHost): string {
    const bits = [host.user, host.hostname].filter(Boolean).join("@");
    const port = host.port && host.port !== "22" ? `:${host.port}` : "";
    return bits ? `${bits}${port}` : host.source === "known" ? "known host" : "";
  }

  onKey(event: KeyboardEvent): void {
    this.typed.set(this.query);
    const found = this.matches();
    if (event.key === "Escape") {
      event.preventDefault();
      this.cancelled.emit();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.highlighted.set(Math.min(found.length - 1, this.highlighted() + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.highlighted.set(Math.max(0, this.highlighted() - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = found[this.highlighted()];
      // Typing something not in the list still works: ssh is given it as it
      // is, which is how you reach a machine you have never met.
      if (picked) {
        this.chosen.emit(picked);
      } else if (this.query.trim()) {
        this.chosen.emit({
          alias: this.query.trim(),
          source: "known",
          looksLive: false
        });
      }
    }
  }
}
