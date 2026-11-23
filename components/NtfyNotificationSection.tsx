"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { formatCompletionSummary } from "@/lib/completion-notification";
import {
  getNtfySettings,
  saveNtfySettings,
  sendNtfyNotification,
  type NtfySettingsClient,
} from "@/lib/ntfy-notification";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

/**
 * Settings › General › ntfy notification.
 *
 * `Server url` (default https://ntfy.sh), `Topic name`, a switch, and a
 * **Send Test Notice** button. When the switch is on, a finished task publishes a message
 * to the topic: its title is the session's name, its body the run's length and clock
 * times — the same sentence the local Safari notification shows.
 *
 * The values live on the server (lib/ntfy-settings.ts), not in localStorage: the topic
 * is the installation's secret and every device that opens Pi publishes to it. A page
 * that is not Pi on this computer sees the topic masked and cannot edit it, which is
 * what `local` below reports.
 */

/** What app/api/notifications/ntfy sends back for a remote page, where the topic is hidden. */
const MASKED_TOPIC = "••••••";

export function NtfyNotificationSection() {
  // `translate` is the same function under a second name: the sentence key is a template
  // that formatCompletionSummary fills, and lib/i18n/usage.test.mjs checks every `t(...)`
  // call site for the placeholders it must interpolate.
  const { t, locale, t: translate } = useI18n();
  const [settings, setSettings] = useState<NtfySettingsClient | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((data: NtfySettingsClient) => {
    setSettings(data);
    setServerUrl(data.serverUrl);
    // A masked topic is not editable and must not be written back as the mask.
    setTopic(data.topic === MASKED_TOPIC ? "" : data.topic);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getNtfySettings().then((data) => {
      if (!cancelled && data) apply(data);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const save = useCallback(async (patch: Partial<NtfySettingsClient>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const saved = await saveNtfySettings(patch);
    setBusy(false);
    if ("error" in saved) {
      setError(saved.error);
      return;
    }
    apply(saved);
    setNote(t("ntfyNotify.saved"));
  }, [apply, t]);

  const saveFields = useCallback(() => {
    void save({ serverUrl, topic });
  }, [save, serverUrl, topic]);

  // Enabling carries the fields with it: switching on with an unsaved topic would be
  // refused by the server, and the user would read that as a broken switch.
  const toggle = useCallback((next: boolean) => {
    void save({ enabled: next, serverUrl, topic });
  }, [save, serverUrl, topic]);

  const test = useCallback(() => {
    setBusy(true);
    setError(null);
    setNote(null);
    const now = Date.now();
    void sendNtfyNotification({
      title: t("ntfyNotify.testTitle"),
      body: formatCompletionSummary(
        translate("safariNotify.summary"),
        { startedAt: now - 65_000, endedAt: now, poppedAt: now },
        locale,
      ),
    }).then((result) => {
      setBusy(false);
      if (result.sent) setNote(t("ntfyNotify.testSent"));
      else setError(result.error ? t("ntfyNotify.testFailedWithError", { error: result.error }) : t("ntfyNotify.testFailed"));
    });
  }, [locale, t, translate]);

  const editable = settings?.local === true;
  const hint = settings === null
    ? t("ntfyNotify.loading")
    : !editable
      ? t("ntfyNotify.localOnly")
      : t("ntfyNotify.hint");
  const canTest = editable && settings?.enabled === true && topic.trim() !== "";

  return (
    <section className="settings-general-section ntfy-notification-section">
      <h3 className="settings-general-heading">{t("ntfyNotify.title")}</h3>
      <p className="settings-general-description">{t("ntfyNotify.description")}</p>
      <div className="settings-option-list">
        <label className="remote-access-step">
          <span className="settings-option-hint">{t("ntfyNotify.serverLabel")}</span>
          <input
            className="mcp-add-input"
            value={serverUrl}
            placeholder="https://ntfy.sh"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            disabled={!editable}
            onChange={(event) => {
              setServerUrl(event.target.value);
              setNote(null);
            }}
          />
        </label>
        <label className="remote-access-step">
          <span className="settings-option-hint">{t("ntfyNotify.topicLabel")}</span>
          <input
            className="mcp-add-input"
            value={topic}
            placeholder="pi-mac"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            disabled={!editable}
            onChange={(event) => {
              setTopic(event.target.value);
              setNote(null);
            }}
          />
        </label>
        <div className="settings-option">
          <span className="settings-option-text">
            <span className="settings-option-title">{t("ntfyNotify.switch")}</span>
            {/* The status line stays in the text column: putting it beside the buttons
                squeezed it to a few characters per line. */}
            <span className="settings-option-hint" role="status">{error ?? note ?? hint}</span>
          </span>
          <ConfigSwitch
            checked={settings?.enabled === true}
            loading={settings === null || busy}
            disabled={!editable}
            label={t("ntfyNotify.switch")}
            onChange={toggle}
          />
        </div>
        <div className="ntfy-notification-actions">
          {/* The same pair the Network proxy row uses: the write is the primary button, the
              probe is the bordered secondary one. */}
          <ConfigButton
            className="settings-option-action"
            variant="primary"
            disabled={!editable || busy || !serverUrl.trim()}
            onClick={saveFields}
          >
            {t("ntfyNotify.save")}
          </ConfigButton>
          {canTest && (
            <ConfigButton
              className="settings-option-action"
              variant="secondary"
              disabled={busy}
              onClick={test}
            >
              {t("ntfyNotify.test")}
            </ConfigButton>
          )}
        </div>
      </div>
    </section>
  );
}
