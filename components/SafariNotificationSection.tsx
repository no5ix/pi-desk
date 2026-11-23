"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { formatCompletionSummary } from "@/lib/completion-notification";
import {
  getLocalNotificationSettings,
  sendLocalNotificationTest,
  setLocalNotificationEnabled,
  type LocalNotificationSettings,
} from "@/lib/safari-notification";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

/**
 * Settings › General › Local notification.
 *
 * One switch, one sender: the app that runs Pi (Terminal, or Pi Agent Desktop) raises a
 * Notification Center row for every run this computer finishes, through
 * `app/api/notifications/local` → `lib/local-notification.ts` (`osascript`, no browser in
 * the loop). Its title is the session's name and its body is the run's length and clock
 * times, e.g. "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This
 * notification pops up at 10:22:47." One notice per finished task, said the same way on
 * every channel: lib/task-completion-server.ts raises it, and lib/web-push.ts and
 * lib/ntfy-notification.ts say the same sentence to the phone and to an ntfy topic.
 *
 * The page used to raise a notification of its own next to this one (the Notification API,
 * a per-browser localStorage switch). It is gone: a finished task arriving twice — once
 * from the app, once from the tab — read as a bug, and only the app's row works with no
 * page open, from a phone-started task, and with the window in the foreground. The
 * browser's notification permission is still used by the extension UI's "needs you" notice
 * and by scheduled runs (lib/browser-notifications.ts).
 *
 * The switch belongs to the installation, not to a browser: it is stored in the server's
 * settings file, so a phone opening Pi over the relay cannot decide what the Mac shows.
 * `app/api/notifications/local` is local-only (`isLocalRequest`), so a remote page gets
 * `local: false` and reads why the switch is not there.
 */
export function SafariNotificationSection() {
  // `translate` is the same function under a second name: the sentence key is a template
  // that formatCompletionSummary fills, and lib/i18n/usage.test.mjs checks every `t(...)`
  // call site for the placeholders it must interpolate.
  const { t, locale, t: translate } = useI18n();
  const [server, setServer] = useState<LocalNotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLocalNotificationSettings().then((value) => {
      if (!cancelled) setServer(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveServer = useCallback((next: boolean) => {
    setServer((current) => (current ? { ...current, enabled: next } : current));
    setNote(null);
    void setLocalNotificationEnabled(next).then((saved) => {
      if (saved) return;
      // The write was refused: put the switch back to what the server says, so the row
      // never claims a state the server is not in.
      void getLocalNotificationSettings().then((value) => {
        if (value) setServer(value);
      });
    });
  }, []);

  const test = useCallback(() => {
    setBusy(true);
    setNote(null);
    void sendLocalNotificationTest({
      title: t("safariNotify.testTitle"),
      body: formatCompletionSummary(
        translate("safariNotify.summary"),
        { startedAt: Date.now() - 65_000, endedAt: Date.now() },
        locale,
      ),
    }).then((sent) => {
      setBusy(false);
      setNote(sent ? t("safariNotify.testSent") : t("safariNotify.testFailed"));
    });
  }, [locale, t, translate]);

  const serverEnabled = server?.enabled === true;
  // The switch is shown where it can do something: a server that is not this computer, or
  // not macOS, raises no notification of its own, and the section says which of the two it is.
  const showServerRow = server !== null && server.supported && server.local;
  const supportNote = server === null
    ? t("safariNotify.loading")
    : !server.supported
      ? t("safariNotify.unsupported")
      : !server.local
        ? t("safariNotify.remote")
        : null;

  return (
    <section className="settings-general-section safari-notification-section">
      {/* What the row raises, said once under the heading — the shape the ntfy section uses. */}
      <h3 className="settings-general-heading">{t("safariNotify.title")}</h3>
      <p className="settings-general-description">{t("safariNotify.description")}</p>
      {supportNote && <p className="settings-general-description" role="status">{supportNote}</p>}
      {showServerRow && (
        <div className="settings-option-list">
          <div className="settings-option">
            <span className="settings-option-text">
              <span className="settings-option-title">{t("safariNotify.switch")}</span>
              {note && <span className="settings-option-hint" role="status">{note}</span>}
            </span>
            {/* The Test button belongs to this row: it asks the server to raise one, which
                is the channel with no page in it. It carries a border, so it reads as a
                button beside the switch. */}
            <ConfigButton
              className="settings-option-action"
              variant="secondary"
              disabled={busy}
              onClick={test}
            >
              {t("safariNotify.test")}
            </ConfigButton>
            <ConfigSwitch
              checked={serverEnabled}
              label={t("safariNotify.switch")}
              onChange={saveServer}
            />
          </div>
        </div>
      )}
    </section>
  );
}
