import { useState, useEffect } from 'react';
import { PlaySquare, Send, Copy, MessageSquare, Sparkles, CheckCircle2, Globe, Link2, Save, Package, Loader2, Camera, Image as ImageIcon } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { 
  generateTGPostMessage, 
  generateVKPostMessage, 
  generateFinalTGMessage 
} from '../lib/templates';

interface ReleasePanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface ProjectLinks {
  anime365?: string;
  tg?: string;
  kodik?: string;
  vk?: string;
  shikimori?: string;
}

export default function ReleasePanel({ currentEpisode, onRefresh }: ReleasePanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [postContent, setPostContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<'TG' | 'VK' | 'FINAL_TG' | null>(null);
  const [links, setLinks] = useState<ProjectLinks>({});
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [customAudioPath, setCustomAudioPath] = useState<string>('');
  const [customRawPath, setCustomRawPath] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [screenshotTime, setScreenshotTime] = useState(0);
  const [screenshotPath, setScreenshotPath] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    if (currentEpisode?.rawPath) {
      ipcSafe.invoke('get-video-metadata', currentEpisode.rawPath).then(meta => {
        if (meta && meta.format && meta.format.duration) {
          setVideoDuration(meta.format.duration);
        }
      });
    }
  }, [currentEpisode?.rawPath]);

  const handleTakeScreenshot = async () => {
    const videoPath = customRawPath || currentEpisode?.rawPath;
    if (!videoPath) return;
    
    setIsCapturing(true);
    try {
      const tempDir = await ipcSafe.invoke('get-temp-path');
      const outputPath = `${tempDir}/screenshot_${Date.now()}.jpg`;
      const res = await ipcSafe.invoke('take-screenshot', {
        videoPath,
        timestamp: screenshotTime,
        outputPath
      });
      if (res.success) {
        setScreenshotPath(res.path);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCapturing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const removeListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      setBuildProgress(percent);
    });
    return () => removeListener();
  }, []);

  const handleBuildRelease = async () => {
    if (!currentEpisode) return;
    
    try {
      const result = await ipcSafe.invoke('select-directory');
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
      
      const targetDir = result.filePaths[0];
      setIsBuilding(true);
      setBuildProgress(0);
      
      const response = await ipcSafe.invoke('build-release', { 
        episode: currentEpisode, 
        targetDir,
        customAudioPath: customAudioPath || undefined,
        customRawPath: customRawPath || undefined
      });
      
      if (response.success) {
        alert(`Релиз успешно собран: ${response.path}`);
      } else {
        alert(`Ошибка при сборке релиза: ${response.error}`);
      }
    } catch (error: any) {
      alert(`Ошибка: ${error.message}`);
    } finally {
      setIsBuilding(false);
      setBuildProgress(0);
    }
  };

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  useEffect(() => {
    if (currentEpisode?.project?.links) {
      try {
        setLinks(JSON.parse(currentEpisode.project.links));
      } catch (e) {
        console.error('Failed to parse project links', e);
        setLinks({});
      }
    } else {
      setLinks({});
    }
  }, [currentEpisode?.project?.id]);

  const handleSaveLinks = async () => {
    if (!currentEpisode?.project) return;
    setIsSavingLinks(true);
    try {
      const updatedProject = {
        ...currentEpisode.project,
        links: JSON.stringify(links)
      };
      await ipcSafe.invoke('save-project', updatedProject);
      onRefresh();
    } catch (err) {
      console.error('Failed to save links', err);
    } finally {
      setIsSavingLinks(false);
    }
  };

  const handleCopy = async () => {
    if (!postContent) return;
    try {
      await navigator.clipboard.writeText(postContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const templates = [
    { 
      name: 'Пост в Telegram', 
      icon: <Send className="w-4 h-4" />, 
      color: 'bg-blue-600',
      generate: () => currentEpisode ? generateTGPostMessage(currentEpisode, participants) : '',
      type: 'TG' as const
    },
    { 
      name: 'Пост в VK', 
      icon: <Globe className="w-4 h-4" />, 
      color: 'bg-indigo-600',
      generate: () => currentEpisode ? generateVKPostMessage(currentEpisode, participants) : '',
      type: 'VK' as const
    },
    { 
      name: 'Финальный пост TG', 
      icon: <Sparkles className="w-4 h-4" />, 
      color: 'bg-purple-600',
      generate: () => currentEpisode ? generateFinalTGMessage(currentEpisode, participants) : '',
      type: 'FINAL_TG' as const
    }
  ];

  if (!currentEpisode) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 italic">
        Выберите серию для сборки релиза
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full space-y-8 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-600/20 rounded-xl">
            <PlaySquare className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Сборка релиза</h1>
            <p className="text-neutral-400">Формирование постов и сборка финального файла</p>
          </div>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Аудио от звукорежиссера</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  readOnly
                  value={customAudioPath}
                  placeholder="Выберите файл .wav или .mp3..."
                  className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                />
                <button
                  onClick={async () => {
                    const res = await ipcSafe.invoke('select-file', { 
                      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }] 
                    });
                    if (res.success) setCustomAudioPath(res.data.path);
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                >
                  Выбрать
                </button>
              </div>
            </div>

            {currentEpisode?.isHardsub && (
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Чистый RAW (т.к. загружен хардсаб)</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    readOnly
                    value={customRawPath}
                    placeholder="Выберите чистый видеофайл..."
                    className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      const res = await ipcSafe.invoke('select-file', { 
                        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov'] }] 
                      });
                      if (res.success) setCustomRawPath(res.data.path);
                    }}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    Выбрать
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <button
              onClick={handleBuildRelease}
            disabled={isBuilding}
            className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-2xl font-bold shadow-xl shadow-purple-500/20 transition-all group relative overflow-hidden"
          >
            {isBuilding ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Сборка... {buildProgress}%</span>
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" 
                  style={{ width: `${buildProgress}%` }}
                />
              </>
            ) : (
              <>
                <Package className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span>Собрать релиз</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>

      {/* Screenshot for Cover Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Скриншот для обложки</span>
          </div>
        </div>
        <div className="p-6 flex flex-col md:flex-row gap-8">
          <div className="flex-1 space-y-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Таймкод: {formatTime(screenshotTime)}</label>
                <span className="text-[10px] text-neutral-500">{formatTime(videoDuration)}</span>
              </div>
              <input 
                type="range"
                min={0}
                max={videoDuration || 100}
                step={1}
                value={screenshotTime}
                onChange={(e) => setScreenshotTime(parseInt(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex gap-4">
                <input 
                  type="number"
                  value={screenshotTime}
                  onChange={(e) => setScreenshotTime(Math.min(videoDuration, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-24 bg-black/50 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                />
                <button
                  onClick={handleTakeScreenshot}
                  disabled={isCapturing || !videoDuration}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all"
                >
                  {isCapturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  Сделать скриншот
                </button>
              </div>
            </div>
          </div>

          <div className="w-full md:w-64 aspect-video bg-black/50 border border-neutral-800 rounded-xl overflow-hidden flex items-center justify-center relative group">
            {screenshotPath ? (
              <>
                <img 
                  src={`file://${screenshotPath}`} 
                  alt="Screenshot" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                   <button 
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = `file://${screenshotPath}`;
                      a.download = `cover_${currentEpisode?.number}.jpg`;
                      a.click();
                    }}
                    className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                    title="Скачать скриншот"
                   >
                     <Save className="w-4 h-4" />
                   </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-neutral-600">
                <ImageIcon className="w-8 h-8" />
                <span className="text-[10px] uppercase font-bold tracking-widest">Нет скриншота</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Platform Links Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Быстрые ссылки для загрузки</span>
          </div>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <a 
            href="https://t.me/akaneproject" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-blue-600/10 hover:border-blue-500/50 transition-all group"
          >
            <Send className="w-6 h-6 text-blue-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">TG Загрузка</span>
          </a>
          <a 
            href="https://converter.kodikres.com/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-purple-600/10 hover:border-purple-500/50 transition-all group"
          >
            <Package className="w-6 h-6 text-purple-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">Kodik Конвертер</span>
          </a>
          <a 
            href="https://cabinet.vkvideo.ru/dashboard/@club216521493?filterPreset=published&section=video_my_content&subsection=video_my_content_videos" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-indigo-600/10 hover:border-indigo-500/50 transition-all group"
          >
            <GlobeIcon className="w-6 h-6 text-indigo-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">VK Кабинет</span>
          </a>
          <a 
            href="https://smotret-anime.com/translations/create" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-orange-600/10 hover:border-orange-500/50 transition-all group"
          >
            <Link2 className="w-6 h-6 text-orange-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">Anime365</span>
          </a>
          <a 
            href="https://vk.com/okaneproject" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-4 bg-black/30 border border-neutral-800 rounded-xl hover:bg-blue-500/10 hover:border-blue-500/50 transition-all group"
          >
            <GlobeIcon className="w-6 h-6 text-blue-500 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">VK Паблик</span>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {templates.map((tpl) => (
          <button
            key={tpl.type}
            onClick={() => {
              setPostContent(tpl.generate());
              setActiveTemplate(tpl.type);
            }}
            className={`p-6 rounded-2xl border transition-all flex flex-col items-center gap-4 text-center ${
              activeTemplate === tpl.type 
                ? 'bg-neutral-900 border-purple-500/50 shadow-lg shadow-purple-500/10' 
                : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
            }`}
          >
            <div className={`p-4 rounded-full ${tpl.color}/20 text-white`}>
              {tpl.icon}
            </div>
            <div>
              <h3 className="font-bold text-white">{tpl.name}</h3>
              <p className="text-xs text-neutral-500 mt-1">Сгенерировать по шаблону</p>
            </div>
          </button>
        ))}
      </div>

      {/* Platform Links Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Ссылки на платформы</span>
          </div>
          <button
            onClick={handleSaveLinks}
            disabled={isSavingLinks}
            className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingLinks ? 'Сохранение...' : 'Сохранить ссылки'}
          </button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Аниме 365</label>
            <input 
              type="text"
              value={links.anime365 || ''}
              onChange={(e) => setLinks(prev => ({ ...prev, anime365: e.target.value }))}
              placeholder="https://anime365.ru/..."
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Telegram</label>
            <input 
              type="text"
              value={links.tg || ''}
              onChange={(e) => setLinks(prev => ({ ...prev, tg: e.target.value }))}
              placeholder="https://t.me/..."
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Kodik</label>
            <input 
              type="text"
              value={links.kodik || ''}
              onChange={(e) => setLinks(prev => ({ ...prev, kodik: e.target.value }))}
              placeholder="https://kodik.info/..."
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">VK</label>
            <input 
              type="text"
              value={links.vk || ''}
              onChange={(e) => setLinks(prev => ({ ...prev, vk: e.target.value }))}
              placeholder="https://vk.com/video..."
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Shikimori</label>
            <input 
              type="text"
              value={links.shikimori || ''}
              onChange={(e) => setLinks(prev => ({ ...prev, shikimori: e.target.value }))}
              placeholder="https://shikimori.one/..."
              className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
        </div>
      </div>

      {postContent && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">Предпросмотр сообщения</span>
            </div>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isCopied ? 'bg-green-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
              }`}
            >
              {isCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {isCopied ? 'Скопировано!' : 'Копировать'}
            </button>
          </div>
          <div className="p-8">
            <pre className="bg-black/50 border border-neutral-800 rounded-xl p-8 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[500px] overflow-y-auto custom-scrollbar">
              {postContent}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobeIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
