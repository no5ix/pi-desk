"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { formatCompletionSummary } from "@/lib/completion-notification";
import {
  getSafariNotificationSupport,
  safariNotificationsEnabled,
  sendSafariNotification,
  setSafariNotificationsEnabled,
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
 * on every channel: lib/task-completion-notice.ts.
 *
 * It is named for what it is, not for one browser. Chrome and Edge raise the page's
 * own notification (the Notification API, with one permission ask). A plain Safari
 * tab cannot: the Notification constructor is not implemented there, and
 * `showNotification()` works only in a Safari web app added to the Dock, so Pi also
 * asks the server on this Mac to raise it (app/api/notifications/local), which is
 * attributed to the process owning the server. The row states that, and a page opened
 * from another machine gets nothing from the server — hence the support probe below,
 * which disables the switch instead of silently doing nothing.
 */
export function SafariNotificationSection() {
  // `translate` is the same function under a second name: the sentence key is a template
  // that formatCompletionSummary fills, and lib/i18n/usage.test.mjs checks every `t(...)`
  // call site for the placeholders it must interpolate.
  const { t, locale, t: translate } = useI18n();
  const [enabled, setEnabled] = useState(() => safariNotificationsEnabled());
  const [support, setSupport] = useState<SafariNotificationSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSafariNotificationSupport().then((value) => {
      if (!cancelled) setSupport(value);
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

  const test = useCallback(() => {
    setBusy(true);
    setNote(null);
    void sendSafariNotification({
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
  }, [locale, translate]);

  const blocked = support !== null && (!support.supported || !support.local);
  const hint = support === null
    ? t("safariNotify.loading")
    : !support.supported
      ? t("safariNotify.unsupported")
      : !support.local
        ? t("safariNotify.remote")
        : t("safariNotify.hint");

  return (
    <section className="settings-general-section safari-notification-section">
      <h3 className="settings-general-heading">{t("safariNotify.title")}</h3>
      <div className="settings-option-list">
        <div className="settings-option">
          <span className="settings-option-text">
            <span className="settings-option-title">{t("safariNotify.switch")}</span>
            <span className="settings-option-hint">{t("safariNotify.body")}</span>
            <span className="settings-option-hint" role="status">{note ?? hint}</span>
          </span>
          {enabled && support?.supported === true && support.local === true && (
            <ConfigButton
              className="settings-option-action"
              variant="ghost"
              disabled={busy || !enabled}
              onClick={test}
            >
              {t("safariNotify.test")}
            </ConfigButton>
          )}
          <ConfigSwitch
            checked={enabled}
            loading={support === null}
            disabled={blocked}
            label={t("safariNotify.switch")}
            onChange={save}
          />
        </div>
      </div>
    </section>
  );
}
