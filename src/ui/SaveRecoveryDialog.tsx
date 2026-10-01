import { useEffect, useState } from 'react';
import { CloudDownload, Download, HardDrive, LoaderCircle, RefreshCw } from 'lucide-react';
import { formatAmount } from '../format';
import type { SaveSummary } from '../save-recovery';
import { Dialog, IconButton } from './common';
import type { GameSession } from './types';

function Summary({ save, cloud = false }: { save: SaveSummary | null; cloud?: boolean }) {
  if (!save) return <p className="muted">本地存档无法读取，原件保留。</p>;
  return <dl className="save-summary">
    <div><dt>{cloud ? '进度时间' : '保存时间'}</dt><dd>{new Date(save.savedAt).toLocaleString('zh-CN', { hour12: false })}</dd></div>
    <div><dt>世次 / 境界</dt><dd>第{save.life}世 · {save.realm}</dd></div>
    <div><dt>修为</dt><dd>{formatAmount(save.cultivation)}</dd></div>
    <div><dt>地点</dt><dd>{save.location}</dd></div>
  </dl>;
}

export function SaveRecoveryDialog({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [selected, setSelected] = useState<'local' | 'cloud' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  useEffect(() => { void session.inspectSaves(); }, [session.inspectSaves]);
  useEffect(() => { setSelected(null); setConfirmed(false); }, [session.recovery?.cloud.revision]);
  const recovery = session.recovery;
  const working = session.recoveryBusy || session.tradeBusy || session.reincarnationBusy;
  const reason = selected === 'cloud' ? recovery?.cloudBlocked : selected === 'local' ? recovery?.localBlocked : null;
  const exportCopy = (copy: 'current' | 'recovery') => {
    try {
      const raw = session.exportSave(copy);
      if (!raw) { setExportMessage(copy === 'current' ? '此设备没有本地存档原件。' : '此设备没有恢复前的副本。'); return; }
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `moli-save-${copy}-${Date.now()}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage('副本已导出，请妥善保管。');
    } catch { setExportMessage('无法读取此浏览器的存档。'); }
  };
  return <Dialog title="存档管理" onClose={() => { if (!working) onClose(); }} footer={<div className="save-recovery-actions">
    <button disabled={working} onClick={onClose}>取消</button>
    <button className="primary" disabled={!selected || !confirmed || !recovery || Boolean(reason) || session.recoveryBusy}
      onClick={() => { if (selected) void session.chooseSave(selected).then(success => { if (success) onClose(); }); }}>
      {session.recoveryBusy ? <LoaderCircle size={16} className="spinning" /> : selected === 'cloud' ? <CloudDownload size={16} /> : <HardDrive size={16} />}
      {selected === 'local' ? '采用本地并同步' : '采用云端存档'}
    </button>
  </div>}>
    <div className="save-recovery-heading"><span>{session.recoveryBusy ? '正在核对存档' : '当前账号的存档'}</span>
      <IconButton label="重新核对存档" disabled={session.recoveryBusy} onClick={() => { setSelected(null); setConfirmed(false); void session.inspectSaves(); }}>
        <RefreshCw size={16} className={session.recoveryBusy ? 'spinning' : ''} />
      </IconButton>
    </div>
    {session.recoveryMessage && <p role="alert">{session.recoveryMessage}</p>}
    {(session.tradePending || session.reincarnationPending) && <div className="save-export-actions">
      <button disabled={session.recoveryBusy || session.tradeBusy || session.reincarnationBusy} onClick={() => {
        void (session.reincarnationPending ? session.reconcileReincarnation() : session.reconcileTrade()).then(() => session.inspectSaves());
      }}><RefreshCw size={15} />{session.reincarnationPending ? '核对轮回' : '核对寄售'}</button>
    </div>}
    {recovery && <fieldset className="save-options" disabled={session.recoveryBusy}>
      <legend className="sr-only">选择存档</legend>
      {(['local', 'cloud'] as const).map(source => <label className={`save-option ${selected === source ? 'selected' : ''}`} key={source}>
        <div className="save-option-heading"><input type="radio" name="save-source" value={source} checked={selected === source}
          disabled={Boolean(source === 'local' ? recovery.localBlocked : recovery.cloudBlocked)}
          onChange={() => { setSelected(source); setConfirmed(false); }} />
          {source === 'local' ? <HardDrive size={17} /> : <CloudDownload size={17} />}
          <strong>{source === 'local' ? '本地存档' : '云端存档'}</strong></div>
        <Summary save={recovery[source]} cloud={source === 'cloud'} />
        {(source === 'local' ? recovery.localBlocked : recovery.cloudBlocked) &&
          <p className="save-choice-warning">{source === 'local' ? recovery.localBlocked : recovery.cloudBlocked}</p>}
      </label>)}
    </fieldset>}
    <div className="save-export-actions">
      <button onClick={() => exportCopy('current')}><Download size={15} />导出本地原件</button>
      <button onClick={() => exportCopy('recovery')}><Download size={15} />导出恢复前副本</button>
    </div>
    {exportMessage && <p role="status">{exportMessage}</p>}
    {selected && <label className="save-confirm"><input type="checkbox" checked={confirmed} disabled={session.recoveryBusy}
      onChange={event => setConfirmed(event.target.checked)} />
      <span>{selected === 'cloud'
        ? '确认替换此设备的全部本地进度。云端备份之后的进度不会合并；本机仅保留最近一次替换前的原件。'
        : '确认用当前本地进度尝试更新云端，不合并其它设备的分支；服务端校验未通过时保留原档。'}</span>
    </label>}
  </Dialog>;
}
