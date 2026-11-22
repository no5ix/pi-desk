"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { formatCompletionSummary } from "@/lib/completion-notification";
import {
  getSafariNotificationSupport,
  getLocalNotificationSettings,
  safariNotificationsEnabled,
  sendLocalNotificationTest,
  setLocalNotificationEnabled,
  setSafariNotificationsEnabled,
  type LocalNotificationSettings,
  type SafariNotificationSupport,
} from "@/lib/safari-notification";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

/**
 * Settings › General › Local browser notification.
 *
 * When it is on, a finished task raises a notification whose title is the session's
 * name and whose body is the run's length and clock times, e.g.
 * "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This
 * notification pops up at 10:22:47." One notice per finished task, said the same way
 * on every channel: lib/task-completion-notice.ts for the banner in this browser,
 * lib/task-completion-server.ts for the phone push, the ntfy message and the row the
 * server raises on this computer.
 *
 * It is named for what it is, not for one browser. Chrome and Edge raise the page's
 * own notification (the Notification API, with one permission ask). A plain Safari
 * tab cannot: the Notification constructor is not implemented there, and
 * `showNotification()` works only in a Safari web app installed with File ▸ Add to
 * Dock (macOS 14+/Safari 17+), so the server on this Mac raises one with `osascript`
 * (app/api/notifications/local), attributed to the process that owns the server.
 *
 * Two switches, because the two senders belong to different machines. The banner is
 * this browser's (localStorage, like every other per-browser choice, and it needs the
 * browser's notification permission). The Notification Center row is the
 * installation's: the server raises it for every run it finishes — including a task
 * started from a phone over the relay, and one that finishes with every page closed —
 * so it lives in the server's settings file, not in a browser's.
 */
export function SafariNotificationSection() {
  // `translate` is the same function under a second name: the sentence key is a template
  // that formatCompletionSummary fills, and lib/i18n/usage.test.mjs checks every `t(...)`
  // call site for the placeholders it must interpolate.
  const { t, locale, t: translate } = useI18n();
  const [enabled, setEnabled] = useState(() => safariNotificationsEnabled());
  const [support, setSupport] = useState<SafariNotificationSupport | null>(null);
  const [server, setServer] = useState<LocalNotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSafariNotificationSupport().then((value) => {
      if (!cancelled) setSupport(value);
    });
    void getLocalNotificationSettings().then((value) => {
      if (!cancelled) setServer(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((next: boolean) => {
    setEnabled(next);
    setSafariNotificationsEnabled(next);
    setNote(null);
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
  // The server's row is shown where it can do something: a server that is not this
  // computer, or not macOS, raises no notification of its own (Settings › General tells
  // the user why, in the line under the browser's own switch).
  const showServerRow = server !== null && server.supported && server.local;
  const supportNote = support === null
    ? t("safariNotify.loading")
    : !support.supported
      ? t("safariNotify.unsupported")
      : !support.local
        ? t("safariNotify.remote")
        : null;

  return (
    <section className="settings-general-section safari-notification-section">
      <h3 className="settings-general-heading">{t("safariNotify.title")}</h3>
      <div className="settings-option-list">
        <div className="settings-option">
          <span className="settings-option-text">
            <span className="settings-option-title">{t("safariNotify.switch")}</span>
            <span className="settings-option-hint">{t("safariNotify.body")}</span>
            <span className="settings-option-hint">{t("safariNotify.hint")}</span>
            {supportNote && <span className="settings-option-hint" role="status">{supportNote}</span>}
          </span>
          {/* The page's banner needs nothing from the server, so this switch is never
              gated by what this computer can do: a phone's browser gets it too. */}
          <ConfigSwitch
            checked={enabled}
            label={t("safariNotify.switch")}
            onChange={save}
          />
        </div>
        {showServerRow && (
          <div className="settings-option">
            <span className="settings-option-text">
              <span className="settings-option-title">{t("safariNotify.serverSwitch")}</span>
              <span className="settings-option-hint">{t("safariNotify.serverHint")}</span>
              {note && <span className="settings-option-hint" role="status">{note}</span>}
            </span>
            {/* The Test button belongs to this row: it asks the server to raise one, which
                is the channel with no page in it. */}
            <ConfigButton
              className="settings-option-action"
              variant="ghost"
              disabled={busy}
              onClick={test}
            >
              {t("safariNotify.test")}
            </ConfigButton>
            <ConfigSwitch
              checked={serverEnabled}
              label={t("safariNotify.serverSwitch")}
              onChange={saveServer}
            />
          </div>
        )}
      </div>
    </section>
  );
}
