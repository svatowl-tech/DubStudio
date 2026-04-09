import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, Play, Save, Video, ChevronRight, AlertCircle, CheckCircle2, Edit3 } from 'lucide-react';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';

interface AssOcrPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  text: string;
  rawLineIndex: number;
}

export default function AssOcrPanel({ currentEpisode, onRefresh }: AssOcrPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadSubtitles();
    } else {
      setLines([]);
    }
  }, [currentEpisode?.subPath]);

  const loadSubtitles = async () => {
    if (!currentEpisode?.subPath) return;
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      setLines(result.lines || []);
    } catch (err) {
      console.error("Error loading subtitles:", err);
    }
  };

  const handleStartOcr = async () => {
    if (!currentEpisode || !currentEpisode.rawPath) return;
    
    let subPath = currentEpisode.subPath;
    if (!subPath) {
      // Generate subPath if not exists
      subPath = currentEpisode.rawPath.replace(/\.[^/.]+$/, ".ass");
    }

    setIsProcessing(true);
    setProgress(0);
    setStatus('Подготовка к распознаванию...');
    
    try {
      // Listen for progress
      const removeListener = window.electronAPI.on('ffmpeg-progress', (p: number) => {
        setProgress(p);
        setStatus(`Распознавание хардсаба: ${Math.round(p)}%`);
      });

      await ipcSafe.invoke('extract-hardsub', {
        videoPath: currentEpisode.rawPath,
        outputAssPath: subPath
      });
      
      removeListener();
      
      // Update episode with new subPath if it was empty
      if (!currentEpisode.subPath) {
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          subPath: subPath,
          isHardsub: true
        });
      }

      setStatus('Распознавание завершено!');
      setProgress(100);
      onRefresh();
      await loadSubtitles();
    } catch (err: any) {
      setStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!currentEpisode?.subPath || lines.length === 0) return;
    
    setIsSaving(true);
    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines: lines.map(l => ({ rawLineIndex: l.rawLineIndex, text: l.text }))
      });
      setStatus('Изменения сохранены!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      setStatus(`Ошибка при сохранении: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const assTimeToSeconds = (time: string): number => {
    if (!time) return 0;
    const parts = time.split(':');
    if (parts.length !== 3) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
  };

  const handleLineClick = (line: SubtitleLine) => {
    if (videoRef.current) {
      videoRef.current.currentTime = assTimeToSeconds(line.start);
      videoRef.current.play();
    }
    setEditingId(line.id);
  };

  const handleTextChange = (id: number, newText: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, text: newText } : l));
  };

  if (lines.length > 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
      <div key="header" className="p-4 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-emerald-400" />
            Коррекция хардсаба
          </h2>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full border border-neutral-700">
            {lines.length} строк
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleStartOcr}
            disabled={isProcessing}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Перераспознать
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>

      <div key="content" className="flex-1 flex overflow-hidden">
        {/* Video Preview */}
        <div className="w-1/2 p-4 bg-black flex flex-col items-center justify-center border-r border-neutral-800">
          <div className="relative w-full aspect-video bg-neutral-900 rounded-lg overflow-hidden shadow-2xl border border-neutral-800">
            {currentEpisode?.rawPath ? (
              <video
                ref={videoRef}
                src={`file://${currentEpisode.rawPath}`}
                className="w-full h-full"
                controls
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-neutral-500 gap-4">
                <Video className="w-12 h-12 opacity-20" />
                <p>Видео не найдено</p>
              </div>
            )}
          </div>
          <div className="mt-4 w-full p-4 bg-neutral-900/50 rounded-xl border border-neutral-800">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Инструкция</h3>
            <ul className="text-xs text-neutral-400 space-y-1.5 list-disc pl-4">
              <li key="inst-1">Нажмите на строку, чтобы перейти к этому моменту в видео.</li>
              <li key="inst-2">Отредактируйте текст прямо в списке.</li>
              <li key="inst-3">Не забудьте нажать "Сохранить" после внесения правок.</li>
            </ul>
          </div>
        </div>

        {/* Subtitle List */}
        <div className="w-1/2 flex flex-col bg-neutral-950 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-2" ref={scrollRef}>
            {lines.map((line, index) => (
              <div
                key={line.id || `line-${index}`}
                onClick={() => handleLineClick(line)}
                className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                  editingId === line.id
                    ? 'bg-emerald-500/10 border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                    : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                      {line.start}
                    </span>
                    <ChevronRight className="w-3 h-3 text-neutral-700" />
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                      {line.end}
                    </span>
                  </div>
                  <Play className={`w-3 h-3 transition-opacity ${editingId === line.id ? 'opacity-100 text-emerald-500' : 'opacity-0 group-hover:opacity-50 text-neutral-400'}`} />
                </div>
                <textarea
                  value={line.text}
                  onChange={(e) => handleTextChange(line.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-transparent border-none text-sm text-neutral-200 focus:ring-0 p-0 resize-none min-h-[1.5rem]"
                  rows={Math.max(1, line.text.split('\n').length)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      {status && (
        <div key="status-bar" className="px-4 py-2 bg-neutral-900 border-t border-neutral-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin text-emerald-500" /> : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
            {status}
          </div>
          {isProcessing && (
            <div className="w-32 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300" 
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-12 text-center space-y-6">
      <div key="icon" className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20">
        <Sparkles className="w-10 h-10 text-emerald-500" />
      </div>
      <div key="title" className="max-w-md space-y-2">
        <h2 className="text-2xl font-bold text-white">Распознавание хардсаба</h2>
        <p className="text-neutral-400">
          Автоматическое извлечение текста из видеоряда. Идеально подходит для аниме с вшитыми субтитрами.
        </p>
      </div>
      
      <div key="info-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
        <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl text-left space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <Video className="w-4 h-4" />
            Видео-анализ
          </div>
          <p className="text-xs text-neutral-500">
            Система анализирует каждый кадр и находит области с текстом, учитывая тайминги появления.
          </p>
        </div>
        <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl text-left space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <Edit3 className="w-4 h-4" />
            Ручная коррекция
          </div>
          <p className="text-xs text-neutral-500">
            После распознавания вы сможете вручную подправить текст, сверяясь с видеоплеером.
          </p>
        </div>
      </div>

      <button 
        key="start-btn"
        onClick={handleStartOcr}
        disabled={isProcessing || !currentEpisode?.rawPath}
        className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all flex items-center gap-3 disabled:opacity-50 shadow-xl shadow-emerald-500/20 group"
      >
        {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6 group-hover:scale-110 transition-transform" />}
        {isProcessing ? `Распознавание... ${Math.round(progress)}%` : 'Начать распознавание'}
      </button>

      {!currentEpisode?.rawPath && (
        <div key="no-raw-alert" className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-4 py-2 rounded-lg border border-amber-500/20">
          <AlertCircle className="w-4 h-4" />
          Сначала загрузите видеофайл (Raw)
        </div>
      )}

      {status && !lines.length && (
        <div key="status-msg" className="p-4 bg-neutral-800 rounded-lg text-sm text-neutral-300 max-w-md">
          {status}
        </div>
      )}
    </div>
  );
}
