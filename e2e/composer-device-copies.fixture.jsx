import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatInput } from '../components/ChatInput';
import { I18nProvider } from '../hooks/useI18n';

/**
 * A composer with two other devices' copies.
 *
 * The rows come from the server (`GET /api/composer-copies`), so the fixture
 * answers that endpoint itself: a mac's Safari copy (text, one image, one
 * attachment the caps refused) and an iPhone's Chrome copy. Everything else about
 * the composer is real.
 */
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const NOW = Date.now();
const COPIES = [
  {
    deviceId: 'iphone-e2e0001', label: 'iphone', kind: 'phone', browser: 'chrome',
    value: '在 iphone 上打的一段话', images: [], files: [],
    updatedAt: NOW, droppedImages: 0, droppedFiles: 0,
  },
  {
    deviceId: 'mac-e2e0002', label: 'mac', kind: 'desktop', browser: 'safari',
    value: '在 macbook 上打的提示词', images: [{ data: ONE_PIXEL_PNG, mimeType: 'image/png' }], files: [],
    updatedAt: NOW - 5000, droppedImages: 0, droppedFiles: 1,
  },
];

const calls = [];
const realFetch = window.fetch.bind(window);
window.__copiesCalls = calls;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.includes('/api/composer-copies')) return realFetch(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  calls.push({ method, body: init?.body ? JSON.parse(init.body) : null });
  if (method === 'GET') {
    return new Response(JSON.stringify({ copies: COPIES }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true, token: 'tok-e2e' }), { status: 200, headers: { 'content-type': 'application/json' } });
};

function Fixture() {
  const input = useRef(null);
  const [sent, setSent] = useState([]);
  window.__fixture = { sent: () => sent };
  return <I18nProvider><main style={{ maxWidth: 860, margin: 'auto', paddingTop: 120 }}>
    <div id="sent" style={{ minHeight: 40, color: 'var(--text-dim)', fontSize: 14 }}>{sent.map(message => <p key={message}>{message}</p>)}</div>
    <ChatInput ref={input} draftKey="device-copies-e2e" isStreaming={false}
      onSend={(message, images) => setSent(prev => [...prev, `${message} · ${(images?.length ?? 0)} image(s)`])}
      onAbort={() => {}}
      thinkingLevel="high" onThinkingLevelChange={() => {}} onToolPresetChange={() => {}} toolPreset="configured"
      model={{ provider: 'fixture', modelId: 'fixture-model' }} modelList={[{ id: 'fixture-model', name: 'Fixture model', provider: 'fixture' }]}
    />
  </main></I18nProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
