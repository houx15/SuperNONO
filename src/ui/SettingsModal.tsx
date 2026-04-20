import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
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

type TestState = 'idle' | 'running' | 'ok' | 'fail';

const VOLCANO_ASR_URL = 'https://console.volcengine.com/speech/service/10038';
const VOLCANO_E2E_URL = 'https://console.volcengine.com/speech/service/10017';
const ARK_API_KEY_URL = 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey';
const GUIDE_URL = 'https://github.com/houx15/SuperNONO/blob/main/docs/credentials-guide.md';

const statusStyles: Record<TestState, { label: string; color: string }> = {
  idle: { label: '未测试', color: 'var(--fg-dim)' },
  running: { label: '测试中…', color: 'var(--fg-soft)' },
  ok: { label: '✓ 已通过', color: 'var(--accent)' },
  fail: { label: '✗ 未通过', color: 'var(--warning)' },
};

function StatusPill({ state }: { state: TestState }) {
  const s = statusStyles[state];
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--sans)',
        color: s.color,
        whiteSpace: 'nowrap',
        padding: '2px 8px',
        borderRadius: 6,
        border: `1px solid ${s.color}`,
        opacity: 0.85,
      }}
    >
      {s.label}
    </span>
  );
}

export function SettingsModal(p: SettingsModalProps) {
  const [volcanoState, setVolcanoState] = useState<TestState>('idle');
  const [volcanoReason, setVolcanoReason] = useState<string | null>(null);
  const [doubaoState, setDoubaoState] = useState<TestState>('idle');
  const [doubaoReason, setDoubaoReason] = useState<string | null>(null);

  const onVolcanoChange = (setter: (v: string) => void, v: string) => {
    setter(v);
    if (volcanoState !== 'idle') {
      setVolcanoState('idle');
      setVolcanoReason(null);
    }
  };
  const onDoubaoChange = (v: string) => {
    p.setDoubaoApiKey(v);
    if (doubaoState !== 'idle') {
      setDoubaoState('idle');
      setDoubaoReason(null);
    }
  };

  const runVolcanoTest = async () => {
    setVolcanoState('running');
    setVolcanoReason(null);
    const r = await p.testVolcano(p.volcanoAppId, p.volcanoAccessKey);
    setVolcanoState(r.ok ? 'ok' : 'fail');
    setVolcanoReason(r.reason ?? null);
  };
  const runDoubaoTest = async () => {
    setDoubaoState('running');
    setDoubaoReason(null);
    const r = await p.testDoubao(p.doubaoApiKey);
    setDoubaoState(r.ok ? 'ok' : 'fail');
    setDoubaoReason(r.reason ?? null);
  };

  const openLink = (url: string) => {
    openUrl(url).catch(() => {});
  };

  const hasUnverified = useMemo(() => {
    const volcanoFilled = p.volcanoAppId.trim() && p.volcanoAccessKey.trim();
    const doubaoFilled = p.doubaoApiKey.trim();
    const volcanoBad = volcanoFilled && volcanoState !== 'ok';
    const doubaoBad = doubaoFilled && doubaoState !== 'ok';
    return Boolean(volcanoBad || doubaoBad);
  }, [p.volcanoAppId, p.volcanoAccessKey, p.doubaoApiKey, volcanoState, doubaoState]);

  return (
    <div className="modal-scrim" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>设置 · Settings</h3>
            <div className="sub">SuperNono · v0.9.2</div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>唤醒词 · Wake word</label>
            <input
              className="input"
              value={p.wakeWord}
              onChange={(e) => p.setWakeWord(e.target.value)}
              placeholder="例如：嘿 Nono"
            />
            <div className="hint">说出唤醒词后，会议中将触发语音问答。</div>
          </div>

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>豆包语音凭证</div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openLink(GUIDE_URL);
                }}
                style={{ color: 'var(--accent)', fontSize: 11 }}
              >
                详细获取指南 ↗
              </a>
            </div>
            <div
              className="hint"
              style={{ fontFamily: 'var(--sans)', fontSize: 12, lineHeight: 1.55 }}
            >
              本应用需要在火山引擎开通三个服务。App ID + Access Token 同时用于前两个， Doubao API
              Key 单独来自 Ark。
              <ul style={{ margin: '6px 0 8px 0', paddingLeft: 18 }}>
                <li>
                  豆包·流式语音识别大模型 — 实时 ASR 转写{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openLink(VOLCANO_ASR_URL);
                    }}
                    style={{ color: 'var(--accent)' }}
                  >
                    开通 ↗
                  </a>
                </li>
                <li>
                  豆包·端到端实时语音大模型 — 唤醒词问答与 TTS{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openLink(VOLCANO_E2E_URL);
                    }}
                    style={{ color: 'var(--accent)' }}
                  >
                    开通 ↗
                  </a>
                </li>
                <li>
                  豆包·大语言模型 (Ark) — 摘要与会议纪要{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openLink(ARK_API_KEY_URL);
                    }}
                    style={{ color: 'var(--accent)' }}
                  >
                    创建 API Key ↗
                  </a>
                </li>
              </ul>
              ⚠ Ark API Key 与火山引擎其他产品的通用 API Key 不通用 — 必须在 Ark 控制台单独创建。
            </div>
          </div>

          <div className="form-row" style={{ marginTop: 14 }}>
            <label>App ID</label>
            <div className="select-row">
              <input
                className="input mono"
                value={p.volcanoAppId}
                onChange={(e) => onVolcanoChange(p.setVolcanoAppId, e.target.value)}
                placeholder="123456789"
                style={{ flex: 1 }}
              />
              <StatusPill state={volcanoState} />
            </div>
          </div>

          <div className="form-row">
            <label>Access Token</label>
            <div className="select-row">
              <input
                className="input mono"
                type="password"
                value={p.volcanoAccessKey}
                onChange={(e) => onVolcanoChange(p.setVolcanoAccessKey, e.target.value)}
                placeholder="your-access-token"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost"
                style={{ height: 32 }}
                onClick={runVolcanoTest}
                disabled={
                  !p.volcanoAppId.trim() || !p.volcanoAccessKey.trim() || volcanoState === 'running'
                }
              >
                测试
              </button>
            </div>
            {volcanoState === 'fail' && volcanoReason && (
              <div className="hint" style={{ color: 'var(--warning)' }}>
                {volcanoReason}
              </div>
            )}
            <div className="hint">
              App ID + Access Token 一并测试，用于 ASR 与唤醒问答。凭证存储于系统钥匙串。
            </div>
          </div>

          <div className="form-row">
            <label>Doubao API Key (Ark)</label>
            <div className="select-row">
              <input
                className="input mono"
                type="password"
                value={p.doubaoApiKey}
                onChange={(e) => onDoubaoChange(e.target.value)}
                placeholder="sk-ark-..."
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost"
                style={{ height: 32 }}
                onClick={runDoubaoTest}
                disabled={!p.doubaoApiKey.trim() || doubaoState === 'running'}
              >
                测试
              </button>
              <StatusPill state={doubaoState} />
            </div>
            {doubaoState === 'fail' && doubaoReason && (
              <div className="hint" style={{ color: 'var(--warning)' }}>
                {doubaoReason}
              </div>
            )}
            <div className="hint">用于摘要与纪要生成。凭证存储于系统钥匙串。</div>
          </div>

          {hasUnverified && (
            <div
              style={{
                marginTop: 14,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
                color: 'var(--warning)',
                fontSize: 12,
              }}
            >
              ⚠ 部分凭证尚未测试通过。保存后，应用可能仍无法正常启动会议 — 建议先通过测试再保存。
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={p.onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await p.onSave();
              p.onClose();
            }}
          >
            <Icon name="check" size={14} /> 保存
          </button>
        </div>
      </div>
    </div>
  );
}
