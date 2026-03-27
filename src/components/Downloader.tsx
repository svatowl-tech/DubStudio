import React, { useState } from 'react';
import { Download, Search, HardDrive, FileVideo, Globe, Loader2, CheckCircle2, FileText } from 'lucide-react';
import { Episode } from '../types';

interface DownloaderProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface DownloadTask {
  id: string;
  filename: string;
  progress: number;
  status: 'DOWNLOADING' | 'COMPLETED' | 'ERROR';
  source: string;
  type: 'RAW' | 'SUB';
}

export default function Downloader({ currentEpisode, onRefresh }: DownloaderProps) {
  const [url, setUrl] = useState('');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadType, setDownloadType] = useState<'RAW' | 'SUB'>('RAW');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'RAW' | 'SUB') => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    setIsUploading(true);
    
    try {
      // Use project title if available, otherwise fallback to ID
      const projectTitle = currentEpisode.project?.title || 'Project';
      const subDir = `${projectTitle}/Episode_${currentEpisode.number}`;
      
      const originalExt = file.name.split('.').pop() || 'mp4';
      const fileName = type === 'RAW' ? `raw_video.${originalExt}` : `subtitles.${originalExt}`;

      const formData = new FormData();
      // Append text fields BEFORE the file so Multer can access them in destination/filename callbacks
      formData.append('subDir', subDir);
      formData.append('fileName', fileName);
      formData.append('file', file);

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }

      const result = await res.json();
      if (result.success) {
        // Update episode in DB
        const updateData: any = {};
        if (type === 'RAW') updateData.rawPath = result.data.url;
        else updateData.subPath = result.data.url;
        
        // If both exist, move to ROLES status
        if ((type === 'RAW' && currentEpisode.subPath) || (type === 'SUB' && currentEpisode.rawPath)) {
          updateData.status = 'ROLES';
        }

        await fetch(`/api/episodes/${currentEpisode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        });
        
        onRefresh();
        alert(`${type === 'RAW' ? 'Видео' : 'Субтитры'} успешно загружены!`);
      } else {
        alert('Ошибка при сохранении файла: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Ошибка при загрузке файла: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !currentEpisode) return;

    setIsSearching(true);
    
    setTimeout(() => {
      setIsSearching(false);
      const filename = downloadType === 'RAW' 
        ? `${currentEpisode.project?.title}_ep${currentEpisode.number}_raw.mp4`
        : `${currentEpisode.project?.title}_ep${currentEpisode.number}_subs.ass`;

      const newTask: DownloadTask = {
        id: Date.now().toString(),
        filename,
        progress: 0,
        status: 'DOWNLOADING',
        source: url.includes('nyaa') ? 'Nyaa.si' : url.includes('anime-365') ? 'Anime365' : 'Direct Link',
        type: downloadType
      };
      
      setTasks(prev => [newTask, ...prev]);
      setUrl('');
      simulateProgress(newTask.id, downloadType);
    }, 1000);
  };

  const simulateProgress = (taskId: string, type: 'RAW' | 'SUB') => {
    let progress = 0;
    const interval = setInterval(async () => {
      progress += Math.floor(Math.random() * 20) + 10;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress, status: 'COMPLETED' } : t));
        
        // Update episode in DB
        if (currentEpisode) {
          const updateData: any = {};
          if (type === 'RAW') updateData.rawPath = `/uploads/${currentEpisode.project?.title}_ep${currentEpisode.number}_raw.mp4`;
          else updateData.subPath = `/uploads/${currentEpisode.project?.title}_ep${currentEpisode.number}_subs.ass`;
          
          // If both exist, move to ROLES status
          if ((type === 'RAW' && currentEpisode.subPath) || (type === 'SUB' && currentEpisode.rawPath)) {
            updateData.status = 'ROLES';
          }

          await fetch(`/api/episodes/${currentEpisode.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          });
          onRefresh();
        }
      } else {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress } : t));
      }
    }, 800);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Загрузка материалов</h1>
          {currentEpisode && (
            <p className="text-neutral-400 text-sm mt-1">
              Проект: <span className="text-indigo-400">{currentEpisode.project?.title}</span> • Серия {currentEpisode.number}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5 text-teal-400" />
              Новая загрузка
            </h2>
            <form onSubmit={handleDownload} className="space-y-4">
              <div className="flex gap-2 p-1 bg-neutral-950 border border-neutral-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDownloadType('RAW')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${downloadType === 'RAW' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  <FileVideo className="w-4 h-4" />
                  RAW (Видео)
                </button>
                <button
                  type="button"
                  onClick={() => setDownloadType('SUB')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${downloadType === 'SUB' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  <FileText className="w-4 h-4" />
                  SUB (Субтитры)
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">
                  Ссылка на файл
                </label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://nyaa.si/view/..."
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !url || !currentEpisode}
                className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-teal-500/20"
              >
                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {isSearching ? 'Поиск...' : 'Начать загрузку'}
              </button>
            </form>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-blue-400" />
              Локальная загрузка
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">
                  Видео файл (RAW)
                </label>
                <label className="flex items-center justify-center gap-2 w-full bg-neutral-950 border border-dashed border-neutral-800 hover:border-blue-500/50 text-neutral-400 hover:text-blue-400 px-4 py-4 rounded-lg cursor-pointer transition-all group">
                  {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileVideo className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                  <span className="text-sm font-medium">{isUploading ? 'Загрузка...' : 'Выбрать видео'}</span>
                  <input 
                    type="file" 
                    accept="video/*" 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, 'RAW')}
                    disabled={isUploading || !currentEpisode}
                  />
                </label>
                <p className="text-xs text-amber-500/70 mt-2">
                  * Внимание: формат .mkv не поддерживается для воспроизведения в браузере. Используйте .mp4 или .webm
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">
                  Файл субтитров (.ass)
                </label>
                <label className="flex items-center justify-center gap-2 w-full bg-neutral-950 border border-dashed border-neutral-800 hover:border-indigo-500/50 text-neutral-400 hover:text-indigo-400 px-4 py-4 rounded-lg cursor-pointer transition-all group">
                  {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                  <span className="text-sm font-medium">{isUploading ? 'Загрузка...' : 'Выбрать субтитры'}</span>
                  <input 
                    type="file" 
                    accept=".ass,.srt" 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, 'SUB')}
                    disabled={isUploading || !currentEpisode}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-white font-medium mb-3">Статус эпизода</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">RAW Видео:</span>
                {currentEpisode?.rawPath ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">Субтитры (.ass):</span>
                {currentEpisode?.subPath ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-blue-400" />
                Активные загрузки
              </h2>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {tasks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3">
                  <Search className="w-12 h-12 opacity-20" />
                  <p>Нет активных загрузок</p>
                </div>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-neutral-900 rounded-lg shrink-0">
                          {task.type === 'RAW' ? <FileVideo className="w-6 h-6 text-blue-400" /> : <FileText className="w-6 h-6 text-indigo-400" />}
                        </div>
                        <div className="overflow-hidden">
                          <h4 className="text-neutral-200 font-medium truncate" title={task.filename}>
                            {task.filename}
                          </h4>
                          <div className="text-xs text-neutral-500 mt-0.5">
                            Источник: {task.source}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`text-sm font-medium ${task.status === 'COMPLETED' ? 'text-green-400' : 'text-blue-400'}`}>
                          {task.progress}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="w-full bg-neutral-900 rounded-full h-2 border border-neutral-800 overflow-hidden">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${task.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-600'}`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { XCircle } from 'lucide-react';
