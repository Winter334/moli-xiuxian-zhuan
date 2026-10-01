import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { GameSession } from './types';
import { Dialog } from './common';

export function ReincarnationDialog({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [accepted, setAccepted] = useState(false);
  return <Dialog title="重入轮回" onClose={onClose}>
    <div className="reincarnation-intro"><RotateCcw size={30} strokeWidth={1.3} /><h3>了却此世，再踏仙途</h3>
      <p>第{session.response?.game.life.number}世</p></div>
    <div className="loss-section"><h3>本世尽归尘土</h3><p>境界、根基、修为、熟练、功法、神通、灵髓成长、炉鼎、探索进度，以及全部装备、物品和灵石。</p>
      <p className="negative">在售余货、待领物品与待领货款全部清除。已成交给他人的资产不追回。</p></div>
    <div className="loss-section"><h3>历世留痕</h3><p>身份、累计履历、测试标记与交易账目保留。新世恢复正常开局，重新随机一个气运，可能与本世相同，不获得永久属性奖励。</p></div>
    <label className="check-label loss-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
      确认舍弃本世成长与资产，此操作不可撤销</label>
    <div className="dialog-actions"><button onClick={onClose}>暂留此世</button>
      <button className="danger" disabled={!accepted || session.blocked || session.tradeStopped}
        onClick={() => { onClose(); void session.submitReincarnation(); }}><Check size={16} />确认轮回</button></div>
  </Dialog>;
}
