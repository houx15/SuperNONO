import { useState } from 'react';
import { Icon } from './Icon';
import type { TestResult } from '../logic/types';

export interface SettingsModalProps {
  wakeWord: string;
  setWakeWord: (w: string) => void;
  volcanoAppId: string;
  setVolcanoAppId: (v: string) => void;
  volcanoAccessKey: string;
  setVolcanoAccessKey: (v: string) => void;
  doubaoApiKey: string;
  setDoubaoApiKey: (v: string) => void;
  testVolcano: (appId: string, accessKey: string) => Promise<TestResult>;
  testDoubao: (apiKey: string) => Promise<TestResult>;
  onClose: () => void;
  onSave: () => Promise<void>;
}

export function SettingsModal(p: SettingsModalProps) {
  const [volcanoTest, setVolcanoTest] = useState<TestResult | null>(null);
  const [doubaoTest, setDoubaoTest] = useState<TestResult | null>(null);

  const runVolcanoTest = async () => {
    setVolcanoTest(null);
    setVolcanoTest(await p.testVolcano(p.volcanoAppId, p.volcanoAccessKey));
  };
  const runDoubaoTest = async () => {
    setDoubaoTest(null);
    setDoubaoTest(await p.testDoubao(p.doubaoApiKey));
  };

  return (
    <div className="modal-scrim" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Settings</h3>
            <div className="sub">Configure · v0.9.2</div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Wake word · 唤醒词</label>
            <input
              className="input"
              value={p.wakeWord}
              onChange={(e) => p.setWakeWord(e.target.value)}
              placeholder="e.g. 嘿 Nono"
            />
          </div>

          <div className="form-row">
            <label>Volcano App ID</label>
            <input
              className="input mono"
              value={p.volcanoAppId}
              onChange={(e) => p.setVolcanoAppId(e.target.value)}
              placeholder="123456789"
            />
          </div>

          <div className="form-row">
            <label>Volcano Access Key</label>
            <div className="select-row">
              <input
                className="input mono"
                type="password"
                value={p.volcanoAccessKey}
                onChange={(e) => p.setVolcanoAccessKey(e.target.value)}
                placeholder="sk-..."
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={runVolcanoTest}>
                Test
              </button>
            </div>
            {volcanoTest && (
              <div
                className="hint"
                style={{ color: volcanoTest.ok ? 'var(--accent)' : 'var(--warning)' }}
              >
                {volcanoTest.ok ? '✓ Credentials accepted' : `× ${volcanoTest.reason}`}
              </div>
            )}
            <div className="hint">Stored in OS keychain.</div>
          </div>

          <div className="form-row">
            <label>Doubao API key</label>
            <div className="select-row">
              <input
                className="input mono"
                type="password"
                value={p.doubaoApiKey}
                onChange={(e) => p.setDoubaoApiKey(e.target.value)}
                placeholder="sk-ark-..."
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={runDoubaoTest}>
                Test
              </button>
            </div>
            {doubaoTest && (
              <div
                className="hint"
                style={{ color: doubaoTest.ok ? 'var(--accent)' : 'var(--warning)' }}
              >
                {doubaoTest.ok ? '✓ Key accepted' : `× ${doubaoTest.reason}`}
              </div>
            )}
            <div className="hint">Stored in OS keychain.</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await p.onSave();
              p.onClose();
            }}
          >
            <Icon name="check" size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
