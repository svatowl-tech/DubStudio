import { useState, useEffect } from 'react';
import { PlaySquare, Send, Copy, MessageSquare, Sparkles, CheckCircle2, Globe, Link2, Save } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Episode } from '../types';
import { ipcRenderer } from '../lib/ipc';
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
      await ipcRenderer.invoke('save-project', updatedProject);
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
            <p className="text-neutral-400">Формирование постов для социальных сетей</p>
          </div>
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
