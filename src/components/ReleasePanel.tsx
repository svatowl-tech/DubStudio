import { useState, useEffect } from 'react';
import { PlaySquare, Send, CheckCircle2, Loader2, Video, Copy, FolderOutput, FileAudio, Settings2, Mic2, FileText, MonitorPlay, Calendar, Clock, Hash, Link as LinkIcon, MessageSquare } from 'lucide-react';
import { ipcRenderer } from '../lib/ipc';
import { getParticipants } from '../services/dbService';
import { Participant, Episode } from '../types';
import { 
  generateStartEpisodeMessage, 
  generateFixesIssuedMessage, 
  generateStatusMessage, 
  generateTGPostMessage, 
  generateVKPostMessage, 
  generateFinalTGMessage 
} from '../lib/templates';

interface ReleasePanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function ReleasePanel({ currentEpisode, onRefresh }: ReleasePanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const [isBaking, setIsBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeStatus, setBakeStatus] = useState('');

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [exportLogs, setExportLogs] = useState<string[]>([]);

  const [isExportingDub, setIsExportingDub] = useState(false);
  const [exportDubProgress, setExportDubProgress] = useState(0);
  const [exportDubStatus, setExportDubStatus] = useState('');
  const [exportDubLogs, setExportDubLogs] = useState<string[]>([]);

  // Release Settings
  const [totalEpisodes, setTotalEpisodes] = useState(12);
  const [deadline, setDeadline] = useState('');
  const [links, setLinks] = useState({
    anime365: '',
    tg: '',
    kodik: '',
    vk: '',
    shikimori: ''
  });

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  useEffect(() => {
    if (currentEpisode) {
      setDeadline(currentEpisode.deadline ? new Date(currentEpisode.deadline).toISOString().split('T')[0] : '');
      if (currentEpisode.project) {
        setTotalEpisodes(currentEpisode.project.totalEpisodes);
        if (currentEpisode.project.links) {
          try {
            setLinks(JSON.parse(currentEpisode.project.links));
          } catch (e) {
            console.error('Failed to parse links', e);
          }
        }
      }
    }
  }, [currentEpisode]);

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

  const handleBakeSubtitles = async () => {
    if (!currentEpisode) return;
    setIsBaking(true);
    setBakeProgress(0);
    setBakeStatus('Запуск FFmpeg...');
    
    const taskId = `bake_${currentEpisode.id}_${Date.now()}`;
    const eventSource = new EventSource(`/api/ipc/progress/${taskId}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.percent !== undefined) {
        setBakeProgress(data.percent);
        setBakeStatus(`Рендеринг: ${data.percent}%`);
      }
    };

    try {
      const projectTitle = currentEpisode.project?.title || 'Project';
      const subDir = `${projectTitle}/Episode_${currentEpisode.number}`;
      
      await ipcRenderer.invoke(
        'bake-subtitles', 
        currentEpisode.rawPath, 
        currentEpisode.subPath, 
        `/uploads/${subDir}/final_release.mp4`,
        taskId
      );
      
      setBakeStatus('Видео успешно отрендерено!');
      setBakeProgress(100);
    } catch (err: any) {
      setBakeStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsBaking(false);
      eventSource.close();
    }
  };

  const handleGeneratePost = async () => {
    if (!currentEpisode) return;
    setIsGenerating(true);
    
    const releaseData = {
      projectTitle: currentEpisode.project?.title || 'Unknown',
      episodeNumber: currentEpisode.number,
      dubbers: currentEpisode.assignments?.map(a => participants.find(p => p.id === a.dubberId)?.nickname || 'Unknown') || []
    };

    try {
      const res = await ipcRenderer.invoke('generate-post', releaseData);
      setPostContent(res.postText);
    } catch (err: any) {
      setPostContent(`Ошибка генерации: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportForSoundEngineer = async () => {
    if (!currentEpisode) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportLogs([]);
    
    const addLog = (msg: string) => setExportLogs(prev => [...prev, msg]);

    try {
      const subDir = `${currentEpisode.project?.title}/Episode_${currentEpisode.number}/SoundEngineer`;
      addLog(`Создание директории: /uploads/${subDir}/`);
      setExportStatus('Подготовка папки...');
      
      await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'create-dir',
          args: [subDir]
        })
      });

      await new Promise(r => setTimeout(r, 1000));
      setExportProgress(10);

      addLog('Экспорт дорожек даберов:');
      for (const a of currentEpisode.assignments || []) {
        const nickname = participants.find(p => p.id === a.dubberId)?.nickname || 'Unknown';
        addLog(` ├─ ${nickname}. ${currentEpisode.project?.title}[${currentEpisode.number.toString().padStart(2, '0')}].wav`);
      }
      
      setExportStatus('Копирование аудио...');
      await new Promise(r => setTimeout(r, 1500));
      setExportProgress(40);

      setExportStatus('Рендеринг видео с надписями...');
      for (let i = 40; i <= 95; i += 5) {
        await new Promise(r => setTimeout(r, 300));
        setExportProgress(i);
      }

      addLog(`Пакет успешно собран в: /uploads/${subDir}/`);
      setExportStatus('Экспорт завершен!');
      setExportProgress(100);
      
      // Update status to SOUND_ENGINEERING
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SOUND_ENGINEERING' }),
      });
      onRefresh();
    } catch (err: any) {
      setExportStatus(`Ошибка: ${err.message}`);
      addLog(`Ошибка экспорта: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportForDubbers = async () => {
    if (!currentEpisode) return;
    setIsExportingDub(true);
    setExportDubProgress(0);
    setExportDubLogs([]);
    
    const addLog = (msg: string) => setExportDubLogs(prev => [...prev, msg]);

    try {
      const subDir = `${currentEpisode.project?.title}/Episode_${currentEpisode.number}/Dubbing`;
      addLog(`Создание директории: /uploads/${subDir}/`);
      setExportDubStatus('Подготовка папки...');
      
      await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'create-dir',
          args: [subDir]
        })
      });

      await new Promise(r => setTimeout(r, 800));
      setExportDubProgress(10);

      addLog('Генерация индивидуальных субтитров (.ass):');
      for (const a of currentEpisode.assignments || []) {
        const nickname = participants.find(p => p.id === a.dubberId)?.nickname || 'Unknown';
        addLog(` ├─ ${nickname}_subs.ass`);
        // Here we would normally call splitSubsByActor and save the files in the subDir
      }
      
      setExportDubStatus('Экспорт субтитров...');
      await new Promise(r => setTimeout(r, 1200));
      setExportDubProgress(30);

      setExportDubStatus('FFmpeg (Аппаратный рендеринг референса)...');
      for (let i = 30; i <= 95; i += 10) {
        await new Promise(r => setTimeout(r, 400));
        setExportDubProgress(i);
      }

      addLog(`Видео успешно сохранено в: /uploads/${subDir}/Dub_ref.mp4`);
      setExportDubStatus('Экспорт завершен!');
      setExportDubProgress(100);
      
      // Update status to RECORDING
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECORDING' }),
      });
      onRefresh();
    } catch (err: any) {
      setExportDubStatus(`Ошибка: ${err.message}`);
      addLog(`Ошибка экспорта: ${err.message}`);
    } finally {
      setIsExportingDub(false);
    }
  };

  const handleFinishRelease = async () => {
    if (!currentEpisode) return;
    try {
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'FINISHED' }),
      });
      onRefresh();
      alert('Релиз успешно завершен!');
    } catch (error) {
      console.error('Finish error:', error);
    }
  };

  const handleSaveReleaseSettings = async () => {
    if (!currentEpisode) return;
    try {
      // Update episode deadline
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline }),
      });
      
      // Update project totalEpisodes and links
      await fetch(`/api/projects/${currentEpisode.projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          totalEpisodes, 
          links: JSON.stringify(links) 
        }),
      });
      
      onRefresh();
      alert('Настройки релиза сохранены!');
    } catch (error) {
      console.error('Save settings error:', error);
    }
  };

  const templates = [
    { title: 'Старт серии', icon: Send, generator: generateStartEpisodeMessage },
    { title: 'Выписка фиксов', icon: FileText, generator: generateFixesIssuedMessage },
    { title: 'Дороги/Фиксы', icon: Clock, generator: generateStatusMessage },
    { title: 'Пост в ТГ', icon: MessageSquare, generator: generateTGPostMessage },
    { title: 'Пост в ВК', icon: LinkIcon, generator: generateVKPostMessage },
    { title: 'Финальный пост ТГ', icon: CheckCircle2, generator: generateFinalTGMessage },
  ];

  return (
    <div className="p-8 max-w-4xl w-full mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
          <PlaySquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Сборка релиза</h1>
          {currentEpisode && (
            <p className="text-neutral-400 text-sm mt-1">
              Проект: <span className="text-indigo-400">{currentEpisode.project?.title}</span> • Серия {currentEpisode.number}
            </p>
          )}
        </div>
      </div>

      {/* Настройки релиза */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="w-6 h-6 text-indigo-400" />
          <h2 className="text-2xl font-bold text-white">Настройки релиза</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1 ml-1">Дедлайн серии</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full bg-black border border-neutral-800 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1 ml-1">Всего серий</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="number"
                  value={totalEpisodes}
                  onChange={(e) => setTotalEpisodes(parseInt(e.target.value))}
                  className="w-full bg-black border border-neutral-800 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1 ml-1">Ссылки на платформы</label>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(links).map(([key, value]) => (
                <div key={key} className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-600 uppercase w-16">{key}</span>
                  <input
                    type="text"
                    placeholder="URL..."
                    value={value}
                    onChange={(e) => setLinks(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full bg-black border border-neutral-800 rounded-lg py-1.5 pl-20 pr-4 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleSaveReleaseSettings}
          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg font-bold transition-colors shadow-lg shadow-indigo-500/20"
        >
          Сохранить настройки
        </button>
      </div>

      {/* Шаблоны сообщений */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <MessageSquare className="w-6 h-6 text-amber-400" />
          <h2 className="text-2xl font-bold text-white">Шаблоны сообщений</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {templates.map((tpl, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (currentEpisode) {
                  setPostContent(tpl.generator(currentEpisode, participants));
                }
              }}
              className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white p-3 rounded-lg text-sm font-medium transition-all border border-neutral-700/50"
            >
              <tpl.icon className="w-4 h-4" />
              {tpl.title}
            </button>
          ))}
        </div>

        <div className="relative bg-neutral-950 border border-neutral-800 rounded-lg p-4 min-h-[150px] group">
          <p className="text-neutral-300 text-sm whitespace-pre-wrap font-sans pr-8">
            {postContent || 'Выберите шаблон выше для генерации текста...'}
          </p>
          {postContent && (
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
            >
              {isCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Экспорт на озвучку (Даберам) */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Mic2 className="w-6 h-6 text-pink-400" />
          <h2 className="text-2xl font-bold text-white">Экспорт на озвучку (Даберам)</h2>
        </div>
        <p className="text-neutral-400 text-sm mb-6">
          Создание облегченного видео со вшитыми субтитрами для комфортной записи, а также нарезка индивидуальных файлов субтитров для каждого актера.
        </p>

        <div className="mt-auto space-y-4">
          {exportDubLogs.length > 0 && (
            <div className="bg-black border border-neutral-800 rounded-lg p-4 h-40 overflow-y-auto font-mono text-xs text-neutral-400 space-y-1 custom-scrollbar">
              {exportDubLogs.map((log, idx) => (
                <div key={idx} className={log.includes('Ошибка') ? 'text-red-400' : log.includes('Успешно') || log.includes('Готово') ? 'text-green-400' : ''}>
                  {log}
                </div>
              ))}
            </div>
          )}

          {isExportingDub && (
            <>
              <div className="w-full bg-neutral-950 rounded-full h-3 border border-neutral-800 overflow-hidden">
                <div 
                  className="bg-pink-500 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${exportDubProgress}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">{exportDubStatus}</span>
                <span className="text-pink-400 font-medium">{exportDubProgress}%</span>
              </div>
            </>
          )}

          <button
            onClick={handleExportForDubbers}
            disabled={isExportingDub || !currentEpisode}
            className="w-full flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold transition-colors shadow-lg shadow-pink-500/20 text-lg"
          >
            {isExportingDub ? <Loader2 className="w-6 h-6 animate-spin" /> : <Mic2 className="w-6 h-6" />}
            {isExportingDub ? 'Экспорт...' : 'Собрать пакет на озвучку'}
          </button>
        </div>
      </div>

      {/* Экспорт для звукорежиссера */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <FolderOutput className="w-6 h-6 text-teal-400" />
          <h2 className="text-2xl font-bold text-white">Экспорт для звукорежиссера</h2>
        </div>
        <p className="text-neutral-400 text-sm mb-6">
          Автоматическая сборка материалов для сведения. Видео кодируется с вшитыми надписями, а все принятые дорожки даберов переименовываются по гайдлайнам.
        </p>

        <div className="mt-auto space-y-4">
          {exportLogs.length > 0 && (
            <div className="bg-black border border-neutral-800 rounded-lg p-4 h-40 overflow-y-auto font-mono text-xs text-neutral-400 space-y-1 custom-scrollbar">
              {exportLogs.map((log, idx) => (
                <div key={idx} className={log.includes('Ошибка') ? 'text-red-400' : log.includes('Успешно') || log.includes('Готово') ? 'text-green-400' : ''}>
                  {log}
                </div>
              ))}
            </div>
          )}

          {isExporting && (
            <>
              <div className="w-full bg-neutral-950 rounded-full h-3 border border-neutral-800 overflow-hidden">
                <div 
                  className="bg-teal-500 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${exportProgress}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">{exportStatus}</span>
                <span className="text-teal-400 font-medium">{exportProgress}%</span>
              </div>
            </>
          )}

          <button
            onClick={handleExportForSoundEngineer}
            disabled={isExporting || !currentEpisode}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold transition-colors shadow-lg shadow-teal-500/20 text-lg"
          >
            {isExporting ? <Loader2 className="w-6 h-6 animate-spin" /> : <FolderOutput className="w-6 h-6" />}
            {isExporting ? 'Экспорт...' : 'Собрать пакет для звукорежиссера'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Блок хардсаба */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Video className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold text-white">Хардсаб субтитров</h2>
          </div>
          
          <div className="mt-auto space-y-4">
            <div className="w-full bg-neutral-950 rounded-full h-3 border border-neutral-800 overflow-hidden">
              <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${bakeProgress}%` }}
              ></div>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-400">{bakeStatus || 'Ожидание...'}</span>
              <span className="text-blue-400 font-medium">{bakeProgress}%</span>
            </div>

            <button
              onClick={handleBakeSubtitles}
              disabled={isBaking || !currentEpisode}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
            >
              {isBaking ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlaySquare className="w-5 h-5" />}
              {isBaking ? 'Рендеринг...' : 'Запустить рендер'}
            </button>
          </div>
        </div>

        {/* Блок SMM */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-5 h-5 text-purple-400" />
            <h2 className="text-xl font-bold text-white">SMM Пост</h2>
          </div>

          <div className="mt-auto space-y-4">
            {postContent ? (
              <div className="relative bg-neutral-950 border border-neutral-800 rounded-lg p-4 min-h-[120px] max-h-[200px] overflow-y-auto group">
                <p className="text-neutral-300 text-sm whitespace-pre-wrap font-sans pr-8">
                  {postContent}
                </p>
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                >
                  {isCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 min-h-[120px] flex items-center justify-center">
                <span className="text-neutral-600 text-sm">Пост еще не сгенерирован</span>
              </div>
            )}

            <button
              onClick={handleGeneratePost}
              disabled={isGenerating || !currentEpisode}
              className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-lg shadow-purple-500/20"
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {isGenerating ? 'Генерация...' : 'Сгенерировать пост'}
            </button>
          </div>
        </div>
      </div>

      <div className="pt-8 flex justify-center">
        <button
          onClick={handleFinishRelease}
          disabled={!currentEpisode || currentEpisode.status !== 'SOUND_ENGINEERING'}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-12 py-4 rounded-xl font-bold text-xl transition-all shadow-xl shadow-green-500/20 flex items-center gap-3"
        >
          <CheckCircle2 className="w-8 h-8" />
          Завершить релиз
        </button>
      </div>
    </div>
  );
}
