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
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { void session.inspectSaves(); }, [session.inspectSaves]);
  useEffect(() => { setConfirmed(false); }, [session.recovery?.cloud.revision]);
  const recovery = session.recovery;
  const working = session.recoveryBusy || session.tradeBusy || session.reincarnationBusy;
  const reason = recovery?.cloudBlocked;
  return <Dialog title="存档管理" onClose={() => { if (!working) onClose(); }} footer={<div className="save-recovery-actions">
    <button disabled={working} onClick={onClose}>取消</button>
    <button className="primary" disabled={!confirmed || !recovery || Boolean(reason) || working}
      onClick={() => { void session.chooseSave('cloud').then(success => { if (success) onClose(); }); }}>
      {session.recoveryBusy ? <LoaderCircle size={16} className="spinning" /> : <CloudDownload size={16} />}
      采用云端存档
    </button>
  </div>}>
    <div className="save-recovery-heading"><span>{session.recoveryBusy ? '正在核对存档' : '当前账号的存档'}</span>
      <IconButton label="重新核对存档" disabled={working} onClick={() => { setConfirmed(false); void session.inspectSaves(); }}>
        <RefreshCw size={16} className={session.recoveryBusy ? 'spinning' : ''} />
      </IconButton>
    </div>
    {session.recoveryMessage && <p role="alert">{session.recoveryMessage}</p>}
    {session.onlineMessage && <p className="save-choice-warning" role="status">{session.onlineMessage}</p>}
    {(session.tradePending || session.reincarnationPending) && <div className="save-pending-actions">
      <button disabled={session.recoveryBusy || session.tradeBusy || session.reincarnationBusy} onClick={() => {
        void (session.reincarnationPending ? session.reconcileReincarnation() : session.reconcileTrade()).then(() => session.inspectSaves());
      }}><RefreshCw size={15} />{session.reincarnationPending ? '核对轮回' : '核对寄售'}</button>
    </div>}
    {recovery && <div className="save-options">
      {(['local', 'cloud'] as const).map(source => <section className="save-option" key={source}>
        <div className="save-option-heading">
          {source === 'local' ? <HardDrive size={17} /> : <CloudDownload size={17} />}
          <strong>{source === 'local' ? '本地缓存' : '云端存档'}</strong></div>
        <Summary save={recovery[source]} cloud={source === 'cloud'} />
        {source === 'cloud' && recovery.cloudBlocked && <p className="save-choice-warning">{recovery.cloudBlocked}</p>}
      </section>)}
    </div>}
    {recovery && <label className="save-confirm"><input type="checkbox" checked={confirmed} disabled={working || Boolean(reason)}
      onChange={event => setConfirmed(event.target.checked)} />
      <span>确认用云端存档替换此设备的全部本地进度，包括尚未上传的进度。本机保留最近一次替换前的原件。</span>
    </label>}
  </Dialog>;
}
