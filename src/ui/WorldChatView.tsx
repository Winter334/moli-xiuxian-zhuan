import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, LoaderCircle, MessageCircle, MoreHorizontal, RefreshCw, Send, Trash2, Volume2, VolumeX } from 'lucide-react';
import { CHAT_TEXT_LIMIT } from '../../shared/social';
import type { SocialClient, SocialState } from '../social-client';
import { PlayerAvatar } from '../discord-identity';
import { Empty, IconButton } from './common';

export function WorldChatView({ state, client, visible }: { state: SocialState; client?: SocialClient; visible: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousCount = useRef(0);
  const olderHeight = useRef<number | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [, updateClock] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => updateClock(value => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    client?.setReading(visible, following.current);
    return () => client?.setReading(false);
  }, [client, visible]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !visible) return;
    if (olderHeight.current !== null && !state.loading) {
      element.scrollTop += element.scrollHeight - olderHeight.current; olderHeight.current = null;
    } else if (following.current && state.messages.length !== previousCount.current) element.scrollTop = element.scrollHeight;
    previousCount.current = state.messages.length;
  }, [visible, state.messages, state.loading]);
  const latest = () => {
    following.current = true;
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    client?.setReading(visible, true);
  };
  const online = state.status === 'online';
  const muted = state.mutedUntil > Date.now();
  return <div className="page world-chat-page" hidden={!visible}>
    <div className="page-heading"><h1>世界频道</h1><div className="button-row">
      <span className="subtle-label">{online ? '已连接' : state.status === 'connecting' ? '连接中' : state.status === 'displaced' ? '另一设备已接入' : '未连接'}</span>
      {client && !online && <IconButton label="重新连接世界频道" onClick={client.reconnectNow}><RefreshCw size={17} /></IconButton>}
    </div></div>
    {state.notice && <p className="chat-notice" role="status">{state.notice}</p>}
    <div className="chat-history" ref={scroll} aria-label="世界频道消息" onScroll={() => {
      const element = scroll.current!;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      client?.setReading(visible, following.current);
    }}>
      {state.hasMore && <button className="chat-older" disabled={state.loading || !online} onClick={() => {
        olderHeight.current = scroll.current?.scrollHeight ?? null; following.current = false; void client?.loadOlder();
      }}>{state.loading ? <LoaderCircle size={15} className="spinning" /> : <MessageCircle size={15} />}较早消息</button>}
      {!state.messages.length && (state.loading ? <p className="empty-line"><LoaderCircle size={17} className="spinning" />正在读取消息</p>
        : <Empty icon={<MessageCircle size={28} />}>{online ? '暂无消息' : '世界频道未连接'}</Empty>)}
      {state.messages.map(message => <article className={`chat-message${message.playerId === state.playerId ? ' self' : ''}`} key={message.id}>
        <PlayerAvatar url={message.avatarUrl} size={32} /><div className="chat-message-body"><header>
          <strong>{message.name}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          })}</time>
          {state.moderator && <div className="chat-management"><IconButton label={`管理${message.name}的消息`} onClick={() => setMenu(menu === message.id ? null : message.id)}>
            <MoreHorizontal size={16} /></IconButton>
            {menu === message.id && <div className="chat-management-menu">
              <button disabled={!online} onClick={() => { setMenu(null); void client?.moderate({ action: 'delete', messageId: message.id }); }}><Trash2 size={15} />删除消息</button>
              {message.playerId !== state.playerId && <>
                <button disabled={!online} onClick={() => { setMenu(null); void client?.moderate({ action: 'mute', target: message.playerId, minutes: 60 }); }}><VolumeX size={15} />禁言1小时</button>
                <button disabled={!online} onClick={() => { setMenu(null); void client?.moderate({ action: 'unmute', target: message.playerId }); }}><Volume2 size={15} />解除禁言</button>
              </>}
            </div>}
          </div>}
        </header><p>{message.text}</p></div>
      </article>)}
    </div>
    {state.unread > 0 && <button className="chat-new" onClick={latest}><ArrowDown size={15} />{state.unread}条新消息</button>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); latest(); void client?.sendChat(); }}>
      <textarea aria-label="世界频道消息" placeholder={muted ? '当前处于禁言期间' : '传音诸位道友'}
        rows={2} maxLength={CHAT_TEXT_LIMIT} value={state.draft} disabled={!client || state.sending || muted}
        onChange={event => client?.setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (online && !state.sending && !muted) { latest(); void client?.sendChat(); }
          }
        }} />
      <div className="chat-send"><span className="muted small">{state.draft.length}/{CHAT_TEXT_LIMIT}</span>
        <button type="submit" className="primary icon-button" title={state.sendFailed ? '重试发送原消息' : '发送消息'}
          aria-label={state.sendFailed ? '重试发送原消息' : '发送消息'}
          disabled={!online || state.sending || muted || !state.draft.trim()}>
          {state.sending ? <LoaderCircle size={18} className="spinning" /> : state.sendFailed ? <RefreshCw size={18} /> : <Send size={18} />}
        </button></div>
    </form>
  </div>;
}
