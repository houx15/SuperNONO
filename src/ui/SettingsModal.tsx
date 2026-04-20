import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Icon } from './Icon';
import type { TestResult } from '../logic/types';
import type { LlmConfig } from '../logic/adapters';
import { LLM_PROVIDERS, type LlmProviderPreset, type LlmSdkShape } from '../logic/config';
import type { SettingsState } from '../hooks/useSettings';

export interface SettingsModalProps {
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
  testVolcano: (appId: string, accessKey: string) => Promise<TestResult>;
  testLlm: (cfg: LlmConfig) => Promise<TestResult>;
  onClose: () => void;
  onSave: () => Promise<void>;
}

type TestState = 'idle' | 'running' | 'ok' | 'fail';

const VOLCANO_ASR_URL = 'https://console.volcengine.com/speech/service/10038';
const VOLCANO_E2E_URL = 'https://console.volcengine.com/speech/service/10017';
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

function findPreset(id: string): LlmProviderPreset | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

export function SettingsModal(p: SettingsModalProps) {
  const { settings, setSettings } = p;
  const [volcanoState, setVolcanoState] = useState<TestState>('idle');
  const [volcanoReason, setVolcanoReason] = useState<string | null>(null);
  const [llmState, setLlmState] = useState<TestState>('idle');
  const [llmReason, setLlmReason] = useState<string | null>(null);

  const currentPreset = useMemo(() => findPreset(settings.llmProvider), [settings.llmProvider]);

  const updateSettings = (patch: Partial<SettingsState>) => {
    setSettings({ ...settings, ...patch });
  };
  const onVolcanoChange = (patch: Partial<SettingsState>) => {
    updateSettings(patch);
    if (volcanoState !== 'idle') {
      setVolcanoState('idle');
      setVolcanoReason(null);
    }
  };
  const onLlmChange = (patch: Partial<SettingsState>) => {
    updateSettings(patch);
    if (llmState !== 'idle') {
      setLlmState('idle');
      setLlmReason(null);
    }
  };

  const onProviderChange = (providerId: string) => {
    const preset = findPreset(providerId);
    if (!preset) {
      updateSettings({ llmProvider: providerId });
      return;
    }
    // When switching preset, reset base URL + sdk shape to the preset's defaults.
    // Keep model + apiKey so user doesn't lose them on accidental click; they
    // likely need to change them anyway.
    onLlmChange({
      llmProvider: providerId,
      llmBaseUrl: preset.baseUrl,
      llmSdkShape: preset.sdkShape,
    });
  };

  const runVolcanoTest = async () => {
    setVolcanoState('running');
    setVolcanoReason(null);
    const r = await p.testVolcano(settings.volcanoAppId, settings.volcanoAccessKey);
    setVolcanoState(r.ok ? 'ok' : 'fail');
    setVolcanoReason(r.reason ?? null);
  };
  const runLlmTest = async () => {
    setLlmState('running');
    setLlmReason(null);
    const r = await p.testLlm({
      baseUrl: settings.llmBaseUrl,
      model: settings.llmModel,
      apiKey: settings.llmApiKey,
      sdkShape: settings.llmSdkShape,
    });
    setLlmState(r.ok ? 'ok' : 'fail');
    setLlmReason(r.reason ?? null);
  };

  const openLink = (url: string) => {
    openUrl(url).catch(() => {});
  };

  const hasUnverified = useMemo(() => {
    const volcanoFilled = settings.volcanoAppId.trim() && settings.volcanoAccessKey.trim();
    const llmFilled =
      settings.llmBaseUrl.trim() && settings.llmModel.trim() && settings.llmApiKey.trim();
    const volcanoBad = volcanoFilled && volcanoState !== 'ok';
    const llmBad = llmFilled && llmState !== 'ok';
    return Boolean(volcanoBad || llmBad);
  }, [
    settings.volcanoAppId,
    settings.volcanoAccessKey,
    settings.llmBaseUrl,
    settings.llmModel,
    settings.llmApiKey,
    volcanoState,
    llmState,
  ]);

  const llmKeyHint = currentPreset?.keyHint ?? 'API Key';
  const llmModelHint = currentPreset?.modelHint ?? 'model id';

  return (
    <div className="modal-scrim" onClick={p.onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
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
              value={settings.wakeWord}
              onChange={(e) => updateSettings({ wakeWord: e.target.value })}
              placeholder="例如：嘿 Nono"
            />
            <div className="hint">说出唤醒词后，会议中将触发语音问答。</div>
          </div>

          {/* === Voice section === */}
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
              <div style={{ fontSize: 13, fontWeight: 600 }}>① 火山语音凭证 (豆包)</div>
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
              实时 ASR 与唤醒词问答共用同一组凭证，须在火山引擎语音控制台开通：
              <ul style={{ margin: '6px 0 8px 0', paddingLeft: 18 }}>
                <li>
                  豆包·流式语音识别大模型{' '}
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
                  豆包·端到端实时语音大模型{' '}
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
              </ul>
            </div>
          </div>

          <div className="form-row" style={{ marginTop: 14 }}>
            <label>App ID</label>
            <div className="select-row">
              <input
                className="input mono"
                value={settings.volcanoAppId}
                onChange={(e) => onVolcanoChange({ volcanoAppId: e.target.value })}
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
                value={settings.volcanoAccessKey}
                onChange={(e) => onVolcanoChange({ volcanoAccessKey: e.target.value })}
                placeholder="your-access-token"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost"
                style={{ height: 32 }}
                onClick={runVolcanoTest}
                disabled={
                  !settings.volcanoAppId.trim() ||
                  !settings.volcanoAccessKey.trim() ||
                  volcanoState === 'running'
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
            <div className="hint">App ID + Access Token 共同测试。存储于系统钥匙串。</div>
          </div>

          {/* === LLM section === */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              ② LLM 服务凭证（用于滚动摘要与会议纪要）
            </div>
            <div
              className="hint"
              style={{ fontFamily: 'var(--sans)', fontSize: 12, lineHeight: 1.55 }}
            >
              支持任何 OpenAI-SDK-兼容 或 Anthropic-SDK-兼容 的服务端点 — 选择预设或自行填写 base
              URL / model / API Key。
            </div>
          </div>

          <div className="form-row" style={{ marginTop: 12 }}>
            <label>服务商 · Provider</label>
            <div className="select-row">
              <select
                className="input"
                value={settings.llmProvider}
                onChange={(e) => onProviderChange(e.target.value)}
                style={{ flex: 1 }}
              >
                {LLM_PROVIDERS.map((prov) => (
                  <option key={prov.id} value={prov.id}>
                    {prov.label}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={settings.llmSdkShape}
                onChange={(e) => onLlmChange({ llmSdkShape: e.target.value as LlmSdkShape })}
                style={{ width: 150 }}
                title="SDK 兼容方言"
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic 兼容</option>
              </select>
              {currentPreset?.keyUrl && (
                <button
                  className="btn btn-ghost"
                  style={{ height: 32 }}
                  onClick={() => openLink(currentPreset.keyUrl!)}
                >
                  获取 Key ↗
                </button>
              )}
            </div>
            <div className="hint">
              预设会自动填 base URL 与 SDK 方言；选 &ldquo;自定义&rdquo; 可完全手填。
            </div>
          </div>

          <div className="form-row">
            <label>Base URL</label>
            <input
              className="input mono"
              value={settings.llmBaseUrl}
              onChange={(e) => onLlmChange({ llmBaseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div className="form-row">
            <label>Model</label>
            <input
              className="input mono"
              value={settings.llmModel}
              onChange={(e) => onLlmChange({ llmModel: e.target.value })}
              placeholder={llmModelHint}
            />
          </div>

          <div className="form-row">
            <label>API Key</label>
            <div className="select-row">
              <input
                className="input mono"
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => onLlmChange({ llmApiKey: e.target.value })}
                placeholder={llmKeyHint}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost"
                style={{ height: 32 }}
                onClick={runLlmTest}
                disabled={
                  !settings.llmBaseUrl.trim() ||
                  !settings.llmModel.trim() ||
                  !settings.llmApiKey.trim() ||
                  llmState === 'running'
                }
              >
                测试
              </button>
              <StatusPill state={llmState} />
            </div>
            {llmState === 'fail' && llmReason && (
              <div className="hint" style={{ color: 'var(--warning)' }}>
                {llmReason}
              </div>
            )}
            <div className="hint">凭证存储于系统钥匙串。</div>
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
