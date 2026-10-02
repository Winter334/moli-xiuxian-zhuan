import { useEffect, useState } from 'react';
import { CloudDownload, HardDrive, LoaderCircle, RefreshCw } from 'lucide-react';
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
  useEffect(() => { void session.inspectSaves(); }, [session.inspectSaves]);
  useEffect(() => { setSelected(null); setConfirmed(false); }, [session.recovery?.cloud.revision]);
  const recovery = session.recovery;
  const working = session.recoveryBusy || session.tradeBusy || session.reincarnationBusy || session.pvpBusy;
  const reason = selected === 'local' ? recovery?.localBlocked : selected === 'cloud' ? recovery?.cloudBlocked : null;
  return <Dialog title="存档管理" onClose={() => { if (!working) onClose(); }} footer={<div className="save-recovery-actions">
    <button disabled={working} onClick={onClose}>取消</button>
    <button className="primary" disabled={!selected || !confirmed || !recovery || Boolean(reason) || working}
      onClick={() => { if (selected) void session.chooseSave(selected).then(success => { if (success) onClose(); }); }}>
      {session.recoveryBusy ? <LoaderCircle size={16} className="spinning" /> : selected === 'cloud' ? <CloudDownload size={16} /> : <HardDrive size={16} />}
      {selected === 'local' ? '保留本地并同步' : selected === 'cloud' ? '采用云端存档' : '确认选择'}
    </button>
  </div>}>
    <div className="save-recovery-heading"><span>{session.recoveryBusy ? '正在核对存档' : '当前账号的存档'}</span>
      <IconButton label="重新核对存档" disabled={working} onClick={() => { setSelected(null); setConfirmed(false); void session.inspectSaves(); }}>
        <RefreshCw size={16} className={session.recoveryBusy ? 'spinning' : ''} />
      </IconButton>
    </div>
    {session.recoveryMessage && <p role="alert">{session.recoveryMessage}</p>}
    {session.onlineMessage && <p className="save-choice-warning" role="status">{session.onlineMessage}</p>}
    {(session.tradePending || session.reincarnationPending || session.pvpPending) && <div className="save-pending-actions">
      <button disabled={working} onClick={() => {
        void (session.pvpPending ? session.reconcilePvp() : session.reincarnationPending
          ? session.reconcileReincarnation() : session.reconcileTrade()).then(() => session.inspectSaves());
      }}><RefreshCw size={15} />{session.pvpPending ? '核对战斗' : session.reincarnationPending ? '核对轮回' : '核对寄售'}</button>
    </div>}
    {recovery && <fieldset className="save-options" disabled={working}>
      <legend className="sr-only">选择保留的存档</legend>
      {(['local', 'cloud'] as const).map(source => <label className="save-option" key={source}>
        <div className="save-option-heading"><input type="radio" name="save-source" value={source}
          checked={selected === source} disabled={Boolean(source === 'local' ? recovery.localBlocked : recovery.cloudBlocked)}
          onChange={() => { setSelected(source); setConfirmed(false); }} />
          {source === 'local' ? <HardDrive size={17} /> : <CloudDownload size={17} />}
          <strong>{source === 'local' ? '本地进度' : '云端存档'}</strong></div>
        <Summary save={recovery[source]} cloud={source === 'cloud'} />
        {(source === 'local' ? recovery.localBlocked : recovery.cloudBlocked) &&
          <p className="save-choice-warning">{source === 'local' ? recovery.localBlocked : recovery.cloudBlocked}</p>}
      </label>)}
    </fieldset>}
    {selected && <label className="save-confirm"><input type="checkbox" checked={confirmed} disabled={working || Boolean(reason)}
      onChange={event => setConfirmed(event.target.checked)} />
      <span>{selected === 'cloud'
        ? '确认用云端存档替换此设备的全部本地进度，包括尚未上传的进度。本机保留最近一次替换前的原件。'
        : '确认保留本地进度并尝试更新云端，不合并其它设备的分支；未通过校验时不覆盖云档。'}</span>
    </label>}
  </Dialog>;
}
