import { ExternalLink, LogOut, RefreshCw, Sheet as SheetIcon } from "lucide-react";
import type { Bootstrap } from "../../../shared/schema";
import { Button, Card, Page, Section, Segmented, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";
import { isNative } from "../lib/native";
import { useSyncNow } from "../lib/store";
import { useTheme, type ThemePref } from "../lib/theme";
import { toast } from "../lib/toast";

export function SettingsScreen({ boot }: { boot: Bootstrap }) {
  const [theme, setTheme] = useTheme();
  const sync = useSyncNow();
  const s = boot.sync;
  const fromSheet = [s.last_hook_at, s.last_pull_at].filter(Boolean).sort().pop() ?? null;

  return (
    <Page eyebrow="PT Tracker" title="Settings">
      <Section title="Appearance" className="mt-0">
        <Segmented<ThemePref>
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Section>

      <Section title="Google Sheet sync">
        <Card>
          <dl className="divide-y divide-line text-[15px]">
            <Row label="Last change from the sheet">{timeAgo(fromSheet)}</Row>
            <Row label="Last write to the sheet">{timeAgo(s.last_push_at)}</Row>
            <Row label="Waiting to sync">{s.pending ? `${s.pending} change${s.pending === 1 ? "" : "s"}` : "Nothing"}</Row>
          </dl>
          {(s.last_error || s.warnings.length > 0) && (
            <div className="border-t border-line px-4 py-3 text-[14px] leading-snug">
              {s.last_error && <p className="text-bad">{s.last_error}</p>}
              {s.warnings.map((w) => (
                <p key={w} className="mt-1 text-warn">
                  {w}
                </p>
              ))}
            </div>
          )}
        </Card>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Button
            variant="secondary"
            icon={sync.isPending ? <Spinner /> : <RefreshCw size={18} />}
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(undefined, {
                onSuccess: (r) => toast(r.error ? `Sync problem: ${r.error}` : "Synced with the sheet", { tone: r.error ? "error" : "info" }),
              })
            }
          >
            Sync now
          </Button>
          <a
            href={boot.sheet_url ?? undefined}
            aria-disabled={!boot.sheet_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface text-[15.5px] font-semibold active:bg-surface-2"
          >
            <SheetIcon size={18} /> Open sheet <ExternalLink size={14} className="text-fg-3" />
          </a>
        </div>
        <p className="mt-3 px-1 text-[13.5px] leading-relaxed text-fg-3">
          Edits in the sheet show up here within seconds. Changes made here are written to the sheet straight away, and everything is
          re-checked every 5 minutes.
        </p>
      </Section>

      <Section title="Account">
        <Card>
          <dl className="divide-y divide-line text-[15px]">
            <Row label="Signed in as">{boot.me ?? "—"}</Row>
            <Row label="Running as">{isNative ? "Android app" : "Website"}</Row>
            <Row label="Version">{__APP_VERSION__}</Row>
          </dl>
        </Card>
        <Button
          variant="ghost"
          className="mt-2 w-full"
          icon={<LogOut size={18} />}
          onClick={() => {
            try {
              localStorage.removeItem("pt-cache-v1");
            } catch {}
            location.href = "/cdn-cgi/access/logout";
          }}
        >
          Sign out
        </Button>
      </Section>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-fg-2">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}
