import { useCallback, useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, ScrollText, Settings, Volume2, VolumeX } from 'lucide-react';
import { Dialog, IconButton } from './common';
import { LOG_DISPLAY_LIMITS } from './log-settings';

// 对应原作地区曲目（src/locations.js）；下一地域入口可先独立切曲。
const AREA_TRACKS = {
  village: 1, ridge: 1, river: 2, city: 3, courts: 4, inner: 5, marsh: 6, uplands: 6, zhaoye: 7,
  qixia: 8, chengzhao: 9, 'jiyuan-ruins': 10, brokenplain: 11, 'ark-outer': 12, 'ark-inner': 13,
} as const;
export type AreaTrackId = keyof typeof AREA_TRACKS;
const DEFAULT_AREA: AreaTrackId = 'village';
const KEY = 'moli.ui.music-volume.v1';
const DEFAULT_VOLUME = 0.6;
function readVolume() {
  try {
    const saved = localStorage.getItem(KEY);
    const value = saved === null ? DEFAULT_VOLUME : Number(saved);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
  } catch { return DEFAULT_VOLUME; }
}
export function SettingsControl({ areaId, locationId, logLimit, onLogLimitChange }: {
  areaId: AreaTrackId | null; locationId?: string; logLimit: number; onLogLimitChange: (limit: number) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const wantsPlay = useRef(true);
  const playAttempt = useRef(0);
  const needsGesture = useRef(false);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(readVolume);
  const [error, setError] = useState('');
  const area: AreaTrackId = areaId && areaId in AREA_TRACKS ? areaId : DEFAULT_AREA;
  const track = locationId === 'zhaoye-roadhead' ? 7 : AREA_TRACKS[area];
  const play = useCallback(async (reportFailure = true) => {
    const player = audio.current;
    if (!player || !wantsPlay.current || document.hidden || !player.getAttribute('src')) return false;
    const attempt = ++playAttempt.current;
    try {
      await player.play();
      if (attempt === playAttempt.current) { needsGesture.current = false; setError(''); }
      return true;
    } catch (reason) {
      if (attempt !== playAttempt.current || !wantsPlay.current || document.hidden) return false;
      if (reason instanceof DOMException && reason.name === 'AbortError') return false;
      needsGesture.current = reason instanceof DOMException && reason.name === 'NotAllowedError';
      if (reportFailure) { setError('音乐暂未能播放'); setPlaying(false); }
      return false;
    }
  }, []);
  useEffect(() => {
    audio.current!.volume = volume;
    try { localStorage.setItem(KEY, String(volume)); } catch { /* Audio preferences are optional. */ }
  }, [volume]);
  useEffect(() => {
    const player = audio.current!;
    const visibility = () => {
      if (document.hidden) { ++playAttempt.current; player.pause(); }
      else void play(false);
    };
    document.addEventListener('visibilitychange', visibility);
    const resume = () => { if (needsGesture.current) void play(false); };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    return () => {
      ++playAttempt.current;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('visibilitychange', visibility);
      player.pause();
    };
  }, [play]);
  useEffect(() => {
    const player = audio.current!;
    ++playAttempt.current;
    player.pause();
    setPlaying(false);
    player.src = `/audio/bgms/${track}.mp3`;
    player.load();
    setError('');
    void play(false);
    return () => { ++playAttempt.current; player.pause(); };
  }, [track, play]);
  return <>
    <audio ref={audio} loop preload="none" onPlay={() => setPlaying(!audio.current!.paused)}
      onPause={() => setPlaying(!audio.current!.paused)} onError={() => {
        if (audio.current!.error) { setError('音乐资源暂不可用'); setPlaying(false); }
      }} />
    <IconButton label="设置" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Settings size={18} />
    </IconButton>
    {open && <Dialog title="设置" onClose={() => setOpen(false)}>
      <section className="settings-section" aria-label="音乐设置">
        <h3><Music2 size={17} />音乐</h3>
        <div className="settings-row"><button aria-label={playing ? '暂停音乐' : '播放音乐'}
          onClick={() => { wantsPlay.current = !playing; if (playing) { ++playAttempt.current; audio.current!.pause(); setPlaying(false); } else void play(); }}>
          {playing ? <Pause size={16} /> : <Play size={16} />}{playing ? '暂停' : '播放'}</button></div>
        <label className="volume-slider">{volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          <input aria-label="音乐音量" type="range" min="0" max="1" step="0.01" value={volume}
            onChange={event => setVolume(Number(event.target.value))} /><span>{Math.round(volume * 100)}%</span></label>
        {error && <p role="status" className="negative">{error}</p>}
      </section>
      <section className="settings-section" aria-label="日志设置">
        <h3><ScrollText size={17} />日志</h3>
        <div className="settings-row"><span>最近记录</span>
          <div className="settings-options" role="group" aria-label="日志展示条数">
            {LOG_DISPLAY_LIMITS.map(limit => <button key={limit} aria-pressed={logLimit === limit}
              onClick={() => onLogLimitChange(limit)}>{limit}条</button>)}
          </div>
        </div>
      </section>
    </Dialog>}
  </>;
}
