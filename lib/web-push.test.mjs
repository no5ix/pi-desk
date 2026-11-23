import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./web-push.ts");
}

const { createWebPushNotifier, localeText } = await loadSubject();
const { sessionNotificationTag, PUSH_TTL_SECONDS } = await (await import("jiti")).createJiti(import.meta.url).import("./notification-tags.ts");

function makeEnvironment({
  initialState = null,
  sessionNames = new Map([["session-1", "My session"]]),
  errorFor = () => null,
} = {}) {
  let state = initialState;
  let saved = null;
  const sent = [];

  const env = {
    send: async (subscription, payload, vapidKeys) => {
      sent.push({ subscription, payload, vapidKeys });
      const error = errorFor(subscription);
      if (error) throw error;
    },
    loadState: () => state,
    saveState: (s) => { saved = s; },
    generateVapidKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
    listSessionNames: async () => sessionNames,
  };

  return {
    notifier: createWebPushNotifier(env),
    sent,
    getSaved: () => saved,
  };
}

const SUB_EN = {
  endpoint: "https://push.example.com/en",
  keys: { p256dh: "p256dh-en", auth: "auth-en" },
  locale: "en",
};
const SUB_ZH = {
  endpoint: "https://push.example.com/zh",
  keys: { p256dh: "p256dh-zh", auth: "auth-zh" },
  locale: "zh-CN",
};

/** A payload without its send stamp, for the assertions that compare the visible fields. */
function payloadFields(entry) {
  const { sentAt, ...fields } = JSON.parse(entry.payload);
  assert.equal(typeof sentAt, "number");
  return fields;
}

test("generates and persists VAPID keys when no state exists", () => {
  const { notifier, getSaved } = makeEnvironment();

  assert.equal(notifier.getVapidPublicKey(), "pub-key");
  assert.deepEqual(getSaved(), {
    vapidKeys: { publicKey: "pub-key", privateKey: "priv-key" },
    subscriptions: [],
  });
});

test("reuses persisted VAPID keys", () => {
  const { notifier } = makeEnvironment({
    initialState: {
      vapidKeys: { publicKey: "persisted-pub", privateKey: "persisted-priv" },
      subscriptions: [],
    },
  });

  assert.equal(notifier.getVapidPublicKey(), "persisted-pub");
});

test("addSubscription upserts by endpoint and persists", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);
  notifier.addSubscription({ ...SUB_EN, locale: "zh-CN" });

  const saved = getSaved();
  assert.equal(saved.subscriptions.length, 2);
  const updated = saved.subscriptions.find((s) => s.endpoint === SUB_EN.endpoint);
  assert.equal(updated.locale, "zh-CN");
});

test("addSubscription persists even after getVapidPublicKey already saved", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.getVapidPublicKey(); // first save
  notifier.addSubscription(SUB_EN);

  assert.equal(getSaved().subscriptions.length, 1);
});

test("a completion reaches every subscription in its own language", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  const startedAt = Date.parse("2026-01-27T08:13:02.000Z");
  const endedAt = Date.parse("2026-01-27T08:14:51.000Z");
  await notifier.notifySessionEvent("session-1", { kind: "complete", startedAt, endedAt });

  assert.equal(sent.length, 2);
  const en = sent.find((s) => s.subscription.endpoint === SUB_EN.endpoint);
  const zh = sent.find((s) => s.subscription.endpoint === SUB_ZH.endpoint);
  // The name comes from the session scan for a caller that has none, and the content is the
  // run's sentence in the language the device subscribed with.
  assert.equal(payloadFields(en).title, "My session", "the title is the session's name");
  assert.match(payloadFields(en).body, /^The task lasted 0h1m49s, started at \d\d:\d\d:\d\d, and ended at \d\d:\d\d:\d\d\. This notification pops up at \d\d:\d\d:\d\d\.$/);
  assert.equal(payloadFields(zh).title, "My session");
  assert.match(payloadFields(zh).body, /^任务历时 0h1m49s，开始于 /);
  assert.equal(payloadFields(en).url, "/?session=session-1");
  assert.equal(payloadFields(en).tag, "pi-session-complete:session-1");
  assert.equal(typeof JSON.parse(en.payload).sentAt, "number", "the payload says when it was sent, so the worker can tell a late delivery from a finished task");
});

test("a completion with a span says the sentence, in the subscriber's language", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  const startedAt = Date.parse("2026-01-27T08:13:02.000Z");
  const endedAt = Date.parse("2026-01-27T08:14:51.000Z");
  await notifier.notifySessionEvent("session-1", { kind: "complete", startedAt, endedAt });

  const en = JSON.parse(sent.find((s) => s.subscription.endpoint === SUB_EN.endpoint).payload);
  const zh = JSON.parse(sent.find((s) => s.subscription.endpoint === SUB_ZH.endpoint).payload);
  // The session name is the title, and the content is only the run's sentence: the name
  // is not repeated inside it, on any channel.
  assert.equal(en.title, "My session");
  assert.match(en.body, /^The task lasted 0h1m49s, started at \d\d:\d\d:\d\d, and ended at \d\d:\d\d:\d\d\. This notification pops up at \d\d:\d\d:\d\d\.$/);
  assert.ok(!en.body.includes("My session"), "the content repeats nothing");
  assert.equal(zh.title, "My session");
  assert.match(zh.body, /^任务历时 0h1m49s，开始于 \d\d:\d\d:\d\d，结束于 \d\d:\d\d:\d\d。此通知在 \d\d:\d\d:\d\d 弹出。$/);
});

test("notifySessionEvent prunes subscriptions dropped by the push service", async () => {
  const { notifier, sent, getSaved } = makeEnvironment({
    errorFor: (subscription) => subscription.endpoint === SUB_ZH.endpoint ? { statusCode: 410 } : null,
  });
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionEvent("session-1", {
    kind: "complete",
    startedAt: Date.parse("2026-01-27T08:13:02.000Z"),
    endedAt: Date.parse("2026-01-27T08:14:51.000Z"),
  });

  assert.equal(sent.length, 2);
  const saved = getSaved();
  assert.deepEqual(saved.subscriptions.map((s) => s.endpoint), [SUB_EN.endpoint]);
});

test("localeText falls back to English for unknown locales", () => {
  assert.equal(localeText("zh-CN", "taskFinished"), "任务已完成。");
  assert.equal(localeText("ja", "taskFinished"), "Task finished.");
  assert.equal(localeText("en", "sessionComplete"), "Session complete");
});

test("push asks for immediate delivery and expires while the news is still news", async () => {
  const { PUSH_OPTIONS } = await loadSubject();

  // iOS may defer non-high-urgency pushes to an arbitrary later window.
  assert.equal(PUSH_OPTIONS.urgency, "high");
  // RFC 8030: a push service stores a message for at least its TTL while the subscriber
  // cannot be reached, then delivers the stored pile. The four-week TTL this carried made
  // a phone that had been offline receive every task of the past week at once — the report
  // is "a lot of notifications with nothing running". A completion notice is worth minutes.
  assert.equal(PUSH_OPTIONS.TTL, PUSH_TTL_SECONDS);
  assert.ok(PUSH_OPTIONS.TTL <= 15 * 60, `TTL ${PUSH_OPTIONS.TTL}s is short enough to drop a stale notice`);
});

test("the payload carries sentAt, and the tag is the shared one", async () => {
  const { sessionPushPayload } = await loadSubject();
  const payload = sessionPushPayload("s-1", "Work", { kind: "complete" }, "en", 1_700_000_000_000);
  assert.equal(payload.sentAt, 1_700_000_000_000);
  assert.equal(payload.tag, sessionNotificationTag("s-1"),
    "the payload and the service worker share a tag, so one finished task is one notification (#1515)");
});

test("the finished-task format is the session's name and a span, or there is nothing to send", async () => {
  // The rule behind pic3–pic7: a notification that says "Session complete" / "Task
  // finished." cannot name its task, so announceRunEnd must not send it on any channel.
  const { completionAnnouncement, sessionPushPayload } = await loadSubject();
  const started = Date.parse("2026-01-27T08:00:00.000Z");
  const ended = started + 65_000;
  assert.deepEqual(completionAnnouncement("Work", { startedAt: started, endedAt: ended }),
    { title: "Work", startedAt: started, endedAt: ended });
  assert.equal(completionAnnouncement("  Fix the parser  \n", { startedAt: started, endedAt: ended }).title, "Fix the parser",
    "the title is the name as written, trimmed");
  for (const name of [null, undefined, "   "]) {
    assert.equal(completionAnnouncement(name, { startedAt: started, endedAt: ended }), null, `${JSON.stringify(name)}: no title`);
  }
  for (const event of [{}, { startedAt: started }, { endedAt: ended }, { startedAt: ended, endedAt: started }, { startedAt: NaN, endedAt: ended }]) {
    assert.equal(completionAnnouncement("Work", event), null, `${JSON.stringify(event)}: no span, no sentence`);
  }
  // The payload builder stays tolerant — it never throws, so an old caller still gets a
  // readable pair. Only announceRunEnd decides to send, and it refuses these.
  const nameless = sessionPushPayload("s-1", undefined, { kind: "complete", startedAt: started, endedAt: ended }, "en", ended);
  assert.equal(nameless.title, "Session complete");
  const numberless = sessionPushPayload("s-1", "Work", { kind: "complete" }, "en", ended);
  assert.equal(numberless.body, "Task finished.");
});

test("vapidSubject defaults to a valid https URL, not mailto:localhost", async () => {
  const { vapidSubject } = await loadSubject();
  const subject = vapidSubject();
  assert.doesNotMatch(subject, /@localhost$/);
  assert.ok(subject.startsWith("https://") || subject.startsWith("mailto:"), subject);
});

test("failed and waiting pushes name the session and carry a short detail", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription({ ...SUB_ZH, locale: "zh-TW", endpoint: "https://push.example.com/tw" });

  await notifier.notifySessionEvent("session-1", { kind: "failed", detail: `429\n${"x".repeat(300)}` });
  const [en, tw] = sent.map((entry) => JSON.parse(entry.payload));
  assert.equal(en.title, "Run failed · My session");
  assert.ok(en.body.startsWith("429 x"));
  assert.ok(en.body.length <= 140);
  assert.equal(tw.title, "執行失敗 · My session");
  assert.equal(en.url, "/?session=session-1");
  assert.equal(en.tag, "pi-session-complete:session-1", "a newer state replaces the older notification");

  sent.length = 0;
  await notifier.notifySessionEvent("other", { kind: "attention", detail: "" });
  assert.equal(JSON.parse(sent[0].payload).title, "Waiting for you");
  assert.equal(JSON.parse(sent[0].payload).body, "A session is waiting for your answer.");
});

test("sendTest reaches only the asking device; removeSubscription stops pushes", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  assert.equal(await notifier.sendTest(SUB_ZH.endpoint), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subscription.endpoint, SUB_ZH.endpoint);
  assert.equal(JSON.parse(sent[0].payload).title, "Pi 通知已开启");
  assert.equal(await notifier.sendTest("https://push.example.com/unknown"), false);

  assert.equal(notifier.removeSubscription(SUB_ZH.endpoint), true);
  assert.equal(notifier.hasSubscription(SUB_ZH.endpoint), false);
  sent.length = 0;
  await notifier.notifySessionEvent("session-1", {
    kind: "complete",
    startedAt: Date.parse("2026-01-27T08:13:02.000Z"),
    endedAt: Date.parse("2026-01-27T08:14:51.000Z"),
  });
  assert.deepEqual(sent.map((entry) => entry.subscription.endpoint), [SUB_EN.endpoint]);
});

test("sendTest surfaces a delivery error instead of swallowing it", async () => {
  const { notifier } = makeEnvironment({ errorFor: () => Object.assign(new Error("403 BadJwtToken"), { statusCode: 403 }) });
  notifier.addSubscription(SUB_EN);
  await assert.rejects(notifier.sendTest(SUB_EN.endpoint), /BadJwtToken/);
});

test("a caller-supplied session name skips the session scan", async () => {
  let scans = 0;
  const sent = [];
  const env = {
    send: async (subscription, payload) => { sent.push({ subscription, payload }); },
    loadState: () => null,
    saveState: () => {},
    generateVapidKeys: () => ({ publicKey: "p", privateKey: "k" }),
    listSessionNames: async () => { scans += 1; return new Map([["s", "Listed"]]); },
  };
  const counted = createWebPushNotifier(env);
  counted.addSubscription(SUB_EN);
  await counted.notifySessionEvent("s", { kind: "complete" }, "Live name");
  await counted.notifySessionEvent("s", { kind: "attention" }, null);
  assert.equal(scans, 0);
  assert.equal(JSON.parse(sent[0].payload).title, "Live name");
  assert.equal(JSON.parse(sent[1].payload).title, "Waiting for you", "null means untitled");
  await counted.notifySessionEvent("s", { kind: "complete" });
  assert.equal(scans, 1, "omitted, it falls back to the scan");
});

test("a phone's subscription stops receiving once its login is no longer let in", async () => {
  let allowed = new Set(["me@example.com"]);
  const sent = [];
  const notifier = createWebPushNotifier({
    send: async (subscription) => { sent.push(subscription.endpoint); },
    loadState: () => null,
    saveState: () => {},
    generateVapidKeys: () => ({ publicKey: "p", privateKey: "k" }),
    listSessionNames: async () => new Map(),
    isLoginAllowed: (login) => allowed.has(login),
  });
  notifier.addSubscription({ ...SUB_EN, endpoint: "https://push.example.com/desk" });
  notifier.addSubscription({ ...SUB_EN, endpoint: "https://push.example.com/phone", login: "me@example.com" });

  await notifier.notifySessionEvent("s", { kind: "complete" }, null);
  assert.deepEqual(sent.sort(), ["https://push.example.com/desk", "https://push.example.com/phone"]);

  allowed = new Set();
  sent.length = 0;
  await notifier.notifySessionEvent("s", { kind: "complete" }, null);
  assert.deepEqual(sent, ["https://push.example.com/desk"], "this computer's own browser keeps getting them");
  assert.equal(await notifier.sendTest("https://push.example.com/phone"), false);
});

test("a relay phone's subscription stops once the device is revoked", async () => {
  let paired = new Set(["dev-1"]);
  const sent = [];
  const notifier = createWebPushNotifier({
    send: async (subscription) => { sent.push(subscription.endpoint); },
    loadState: () => null,
    saveState: () => {},
    generateVapidKeys: () => ({ publicKey: "p", privateKey: "k" }),
    listSessionNames: async () => new Map(),
    isRelayDevicePaired: (id) => paired.has(id),
  });
  notifier.addSubscription({ ...SUB_EN, endpoint: "https://push.example.com/relay-phone", relayDevice: "dev-1" });
  await notifier.notifySessionEvent("s", { kind: "complete" }, null);
  assert.deepEqual(sent, ["https://push.example.com/relay-phone"]);
  paired = new Set();
  sent.length = 0;
  await notifier.notifySessionEvent("s", { kind: "complete" }, null);
  assert.deepEqual(sent, []);
});
