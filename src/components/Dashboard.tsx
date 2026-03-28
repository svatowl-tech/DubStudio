import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle2, Clock, AlertCircle, Mic, FileAudio, UserPlus, Link as LinkIcon, MessageSquare, ExternalLink, Calendar, FileText, Image as ImageIcon, Database, FolderPlus, ChevronRight, Download, Save, Loader2, FileVideo, Activity } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Project, Episode, EpisodeStatus } from '../types';
import { ipcRenderer } from '../lib/ipc';

interface DashboardProps {
  onNavigate?: (tab: string) => void;
  projects: Project[];
  selectedProjectId: string | null;
  currentEpisode: Episode | null;
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

const ROLE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  RECORDED: 'Записано',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  FIXES_NEEDED: 'Нужны правки'
};

export default function Dashboard({ 
  onNavigate, 
  projects, 
  selectedProjectId, 
  currentEpisode, 
  onProjectSelect, 
  onEpisodeSelect,
  onRefresh
}: DashboardProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  
  const [isNewEpisodeModalOpen, setIsNewEpisodeModalOpen] = useState(false);
  const [newEpisodeNumber, setNewEpisodeNumber] = useState(1);

  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [isDeleteEpisodeModalOpen, setIsDeleteEpisodeModalOpen] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');

  const [isAssignDubbersModalOpen, setIsAssignDubbersModalOpen] = useState(false);
  const [selectedProjectDubbers, setSelectedProjectDubbers] = useState<string[]>([]);

  const [isUploading, setIsUploading] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [baseDir, setBaseDir] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  const handleFileSelect = async (type: 'RAW' | 'SUB') => {
    if (!currentEpisode) return;

    setIsUploading(true);
    
    try {
      const res = await ipcRenderer.invoke('select-file', {
        filters: type === 'RAW' ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mkv'] }] : [{ name: 'Subtitles', extensions: ['ass', 'srt'] }]
      });

      if (!res.success) return;

      const filePath = res.data.path;
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase();
      
      let finalFilePath = filePath;
      
      // Transcode MKV to MP4
      if (type === 'RAW' && ext === 'mkv') {
        setStatus("Транскодирование MKV в MP4...");
        const outputPath = filePath.replace(/\.mkv$/i, '.mp4');
        const transcodeRes = await ipcRenderer.invoke('transcode-video', {
          videoPath: filePath,
          outputPath
        });
        
        if (!transcodeRes.success) {
          alert('Ошибка транскодирования: ' + transcodeRes.error);
          setIsUploading(false);
          return;
        }
        finalFilePath = outputPath;
        setTranscodingProgress(null);
      }
      
      // Use project title if available, otherwise fallback to ID
      const projectTitle = currentEpisode.project?.title || 'Project';
      const subDir = `${projectTitle}/Episode_${currentEpisode.number}`;
      
      const originalExt = finalFilePath.split('.').pop() || 'mp4';
      const targetFileName = type === 'RAW' ? `raw_video.${originalExt}` : `subtitles.${originalExt}`;

      const copyRes = await ipcRenderer.invoke('copy-file', {
        sourcePath: finalFilePath,
        targetDir: subDir,
        fileName: targetFileName
      });

      if (copyRes.success) {
        // Update episode in DB
        const updateData: any = {};
        if (type === 'RAW') updateData.rawPath = copyRes.data.path;
        else updateData.subPath = copyRes.data.path;
        
        // If both exist, move to ROLES status
        if ((type === 'RAW' && currentEpisode.subPath) || (type === 'SUB' && currentEpisode.rawPath)) {
          updateData.status = 'ROLES';
        }

        await ipcRenderer.invoke('save-episode', { ...currentEpisode, ...updateData });
        
        onRefresh();
        alert(`${type === 'RAW' ? 'Видео' : 'Субтитры'} успешно загружены!`);
      } else {
        alert('Ошибка при сохранении файла: ' + copyRes.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Ошибка при загрузке файла: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    getParticipants().then(setParticipants);
    ipcRenderer.invoke('get-config').then(data => setBaseDir(data.baseDir || ''));
    
    const progressListener = (percent: number) => {
      setTranscodingProgress(percent);
    };
    const cleanup = ipcRenderer.on('ffmpeg-progress', progressListener);
    
    return () => {
      cleanup();
    };
  }, []);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const stats = {
    totalProjects: projects.length,
    activeEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status !== 'FINISHED').length || 0), 0),
    finishedEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FINISHED').length || 0), 0),
    pendingFixes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FIXES').length || 0), 0)
  };

  const recentEpisodes = projects
    .flatMap(p => (p.episodes || []).map(e => ({ ...e, projectTitle: p.title })))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 5);

  useEffect(() => {
    if (selectedProject) {
      setSelectedProjectDubbers(selectedProject.assignedDubberIds || []);
    }
  }, [selectedProject]);

  const handleSaveProjectDubbers = async () => {
    if (!selectedProject) return;
    const updatedProject = {
      ...selectedProject,
      assignedDubberIds: selectedProjectDubbers
    };
    await ipcRenderer.invoke('save-project', updatedProject);
    onRefresh();
    setIsAssignDubbersModalOpen(false);
  };

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseDir) return;
    await ipcRenderer.invoke('save-config', { baseDir });
    alert('Путь к базе успешно обновлен!');
    setIsSettingsModalOpen(false);
  };

  const handleSelectFolder = async () => {
    try {
      const result = await ipcRenderer.invoke('select-folder');
      
      if (result) {
        if (result.success && result.data) {
          setBaseDir(result.data.path);
        } else if (typeof result === 'string') {
          setBaseDir(result);
        }
      }
    } catch (error) {
      console.error('Folder selection error:', error);
      alert('Ошибка при выполнении запроса выбора папки');
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    
    const newProject = {
      id: Date.now().toString(),
      title: newProjectTitle,
      status: 'ACTIVE',
      lastActiveEpisode: 1,
      totalEpisodes: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ipcRenderer.invoke('save-project', newProject);
    onRefresh();
    onProjectSelect(newProject.id);
    setIsNewProjectModalOpen(false);
    setNewProjectTitle('');
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    if (!confirm('Вы уверены, что хотите удалить этот проект и все его серии?')) return;
    
    await ipcRenderer.invoke('delete-project', selectedProjectId);
    onProjectSelect('');
    onRefresh();
    setIsDeleteProjectModalOpen(false);
  };

  const handleDeleteEpisode = async () => {
    if (!currentEpisode) return;
    if (!confirm(`Вы уверены, что хотите удалить серию ${currentEpisode.number}?`)) return;
    
    await ipcRenderer.invoke('delete-episode', currentEpisode.id);
    onRefresh();
    setIsDeleteEpisodeModalOpen(false);
  };

  const handleCreateEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    
    const newEpisode = {
      id: Date.now().toString(),
      projectId: selectedProjectId,
      number: newEpisodeNumber,
      status: 'UPLOAD',
      assignments: [],
      uploads: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ipcRenderer.invoke('save-episode', newEpisode);
    
    onRefresh();
    setIsNewEpisodeModalOpen(false);
  };

  useEffect(() => {
    if (selectedProject?.episodes) {
      const maxEp = Math.max(0, ...selectedProject.episodes.map(e => e.number));
      setNewEpisodeNumber(maxEp + 1);
    } else {
      setNewEpisodeNumber(1);
    }
  }, [selectedProject, isNewEpisodeModalOpen]);

  const handleExportProject = () => {
    if (!selectedProject) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selectedProject, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${selectedProject.title}_export.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEpisode || !selectedUserId || !characterName) return;

    const newAssignment = {
      id: Date.now().toString(),
      episodeId: currentEpisode.id,
      characterName,
      dubberId: selectedUserId,
      status: 'PENDING'
    };
    
    const updatedEpisode = {
      ...currentEpisode,
      assignments: [...(currentEpisode.assignments || []), newAssignment]
    };
    
    await ipcRenderer.invoke('save-episode', updatedEpisode);

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Stats & Recent Activity Section */}
      {!selectedProjectId && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <FolderPlus className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-neutral-400">Проектов</p>
                  <p className="text-2xl font-bold text-white">{stats.totalProjects}</p>
                </div>
              </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-neutral-400">В работе</p>
                  <p className="text-2xl font-bold text-white">{stats.activeEpisodes}</p>
                </div>
              </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-neutral-400">Завершено</p>
                  <p className="text-2xl font-bold text-white">{stats.finishedEpisodes}</p>
                </div>
              </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-neutral-400">Нужны правки</p>
                  <p className="text-2xl font-bold text-white">{stats.pendingFixes}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-neutral-800 bg-neutral-950/50 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white">Последняя активность</h3>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto max-h-[300px]">
              {recentEpisodes.map(ep => (
                <button
                  key={ep.id}
                  onClick={() => {
                    onProjectSelect(ep.projectId);
                    onEpisodeSelect(ep.number);
                  }}
                  className="w-full p-3 rounded-lg text-left hover:bg-neutral-800 transition-colors group"
                >
                  <div className="text-xs font-bold text-blue-400 truncate mb-1">{ep.projectTitle}</div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white font-medium">Серия {ep.number}</span>
                    <span className="text-[10px] text-neutral-500">{STATUS_LABELS[ep.status]}</span>
                  </div>
                </button>
              ))}
              {recentEpisodes.length === 0 && (
                <div className="p-8 text-center text-xs text-neutral-600 italic">Нет активности</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Project Selector & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative flex-1 max-w-xs">
            <select 
              value={selectedProjectId || ''} 
              onChange={(e) => onProjectSelect(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none"
            >
              <option value="" disabled>Выберите проект</option>
              {projects
                ?.filter(p => p.title.toLowerCase().includes(projectSearch.toLowerCase()))
                .map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
              <ChevronRight className="w-4 h-4 rotate-90" />
            </div>
          </div>
          
          <input 
            type="text"
            placeholder="Поиск..."
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            className="bg-neutral-900 border border-neutral-800 text-white rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />

          <button 
            onClick={() => setIsNewProjectModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Новый проект"
          >
            <FolderPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsAssignDubbersModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Назначить даберов на проект"
          >
            <UserPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Настройки пути"
          >
            <Database className="w-5 h-5" />
          </button>
          {selectedProjectId && (
            <button 
              onClick={handleDeleteProject}
              className="p-2 bg-red-900/20 hover:bg-red-900/40 rounded-lg text-red-400 hover:text-red-300 transition-colors"
              title="Удалить проект"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportProject}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            Экспорт JSON
          </button>
          <button 
            onClick={() => setIsNewEpisodeModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить серию
          </button>
        </div>
      </div>

      {selectedProject && (
        <>
          {/* Episode Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {selectedProject?.episodes?.map(ep => (
              <button
                key={ep.id}
                onClick={() => onEpisodeSelect(ep.number)}
                className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 border ${
                  currentEpisode?.id === ep.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 border-blue-400' 
                    : ep.status === 'FINISHED' ? 'bg-green-900/20 text-green-400 border-green-900/50 hover:bg-green-900/30' :
                      ep.status === 'FIXES' ? 'bg-red-900/20 text-red-400 border-red-900/50 hover:bg-red-900/30' :
                      'bg-neutral-900 text-neutral-400 border-transparent hover:bg-neutral-800'
                }`}
              >
                Серия {ep.number}
                <div className="flex gap-0.5">
                  {ep.rawPath && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Видео загружено" />}
                  {ep.subPath && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Субтитры загружены" />}
                </div>
              </button>
            ))}
          </div>

          {currentEpisode && (
            <div className="space-y-8">
              {/* Episode Status Header */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-white mb-1">Серия {currentEpisode.number}</h2>
                    <button 
                      onClick={handleDeleteEpisode}
                      className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Удалить серию"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-neutral-400">
                    <Clock className="w-4 h-4" />
                    <span>Статус: <span className="text-blue-400 font-medium">{STATUS_LABELS[currentEpisode.status]}</span></span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Workflow Stepper */}
                  <div className="flex items-center gap-1">
                    {(Object.keys(STATUS_LABELS) as EpisodeStatus[]).map((status, idx) => (
                      <React.Fragment key={status}>
                        <div 
                          className={`w-3 h-3 rounded-full ${
                            currentEpisode.status === status ? 'bg-blue-500 ring-4 ring-blue-500/20' : 
                            idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'
                          }`}
                          title={STATUS_LABELS[status]}
                        />
                        {idx < Object.keys(STATUS_LABELS).length - 1 && (
                          <div className={`w-4 h-px ${idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'}`} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>

              {/* File Upload Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <FileVideo className="w-5 h-5 text-blue-400" />
                      Видео файл (RAW)
                    </h3>
                    {currentEpisode.rawPath ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Загружено
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                        <AlertCircle className="w-3 h-3" />
                        Ожидание
                      </span>
                    )}
                  </div>
                  <label className={`flex items-center justify-center gap-2 w-full ${currentEpisode.rawPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-blue-500/50 text-neutral-400 hover:text-blue-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} onClick={() => handleFileSelect('RAW')}>
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {transcodingProgress !== null && (
                          <span className="text-xs">{transcodingProgress}%</span>
                        )}
                      </div>
                    ) : (
                      <FileVideo className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    )}
                    <span className="text-sm font-medium">{isUploading ? (status || 'Обработка...') : 'Выбрать видео'}</span>
                  </label>
                  <p className="text-xs text-amber-500/70 mt-2">
                    * Внимание: формат .mkv не поддерживается для воспроизведения в браузере. Используйте .mp4 или .webm
                  </p>
                </div>

                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-400" />
                      Файл субтитров (.ass)
                    </h3>
                    {currentEpisode.subPath ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Загружено
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                        <AlertCircle className="w-3 h-3" />
                        Ожидание
                      </span>
                    )}
                  </div>
                  <label className={`flex items-center justify-center gap-2 w-full ${currentEpisode.subPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-indigo-500/50 text-neutral-400 hover:text-indigo-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} onClick={() => handleFileSelect('SUB')}>
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                    <span className="text-sm font-medium">{isUploading ? 'Загрузка...' : 'Выбрать субтитры'}</span>
                  </label>
                </div>
              </div>

              {/* Assignments Table */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Распределение ролей</h3>
                  <button 
                    onClick={() => setIsAssignModalOpen(true)}
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Назначить роль
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-neutral-950/50 text-neutral-400 text-xs uppercase tracking-wider">
                        <th className="px-6 py-4 font-semibold">Даббер</th>
                        <th className="px-6 py-4 font-semibold">Персонажи</th>
                        <th className="px-6 py-4 font-semibold">Статус</th>
                        <th className="px-6 py-4 font-semibold text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {(() => {
                        const grouped: Record<string, any> = {};
                        currentEpisode?.assignments?.forEach(as => {
                          const dubberId = as.dubberId;
                          if (!grouped[dubberId]) {
                            grouped[dubberId] = {
                              dubber: as.dubber,
                              characters: [as.characterName],
                              statuses: [as.status]
                            };
                          } else {
                            if (!grouped[dubberId].characters.includes(as.characterName)) {
                              grouped[dubberId].characters.push(as.characterName);
                            }
                            grouped[dubberId].statuses.push(as.status);
                          }
                        });

                        return Object.entries(grouped).map(([dubberId, data]) => {
                          // Determine overall status for the dubber
                          const allApproved = data.statuses.every((s: string) => s === 'APPROVED');
                          const anyFixes = data.statuses.some((s: string) => s === 'FIXES_NEEDED' || s === 'REJECTED');
                          const displayStatus = allApproved ? 'APPROVED' : anyFixes ? 'FIXES_NEEDED' : data.statuses[0];

                          return (
                            <tr key={dubberId} className="hover:bg-neutral-800/30 transition-colors group">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-xs text-blue-400 border border-blue-500/20 font-bold">
                                    {data.dubber?.nickname?.charAt(0) || '?'}
                                  </div>
                                  <span className="text-white font-medium">{data.dubber?.nickname || '...'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-neutral-400 text-sm">
                                {data.characters.join(', ')}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                                  displayStatus === 'APPROVED' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                  displayStatus === 'FIXES_NEEDED' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                  'bg-neutral-800 text-neutral-400 border-neutral-700'
                                }`}>
                                  {ROLE_STATUS_LABELS[displayStatus] || displayStatus || 'Ожидает'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => onNavigate?.('QA')}
                                  className="text-neutral-500 hover:text-blue-400 transition-colors p-2 hover:bg-blue-500/10 rounded-lg"
                                  title="Проверить в QA"
                                >
                                  <Activity className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                      {(!currentEpisode?.assignments || currentEpisode.assignments.length === 0) && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-neutral-500 italic">
                            Роли еще не распределены. Используйте утилиту ASS или назначьте вручную.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-400" />
                Настройки хранилища
              </h3>
              <button onClick={() => setIsSettingsModalOpen(false)} className="text-neutral-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleUpdateConfig} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">
                  Путь к корневой папке проектов
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={baseDir}
                    onChange={(e) => setBaseDir(e.target.value)}
                    placeholder="Папка не выбрана"
                    className="flex-1 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button 
                    type="button"
                    onClick={handleSelectFolder}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors border border-neutral-700 flex items-center gap-2 whitespace-nowrap"
                  >
                    <FolderPlus className="w-4 h-4" />
                    Авто
                  </button>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  В веб-версии вы можете ввести путь вручную или использовать "Авто" для симуляции выбора. Все файлы будут сохраняться в эту папку.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
                >
                  Отмена
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Новый проект</h2>
              <button onClick={() => setIsNewProjectModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Название аниме</label>
                <input 
                  type="text" 
                  value={newProjectTitle} 
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Твоё имя"
                  required
                />
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Создать проект</button>
            </form>
          </div>
        </div>
      )}

      {/* New Episode Modal */}
      {isNewEpisodeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Добавить серию</h2>
              <button onClick={() => setIsNewEpisodeModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateEpisode} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Номер серии</label>
                <input 
                  type="number" 
                  value={newEpisodeNumber} 
                  onChange={(e) => setNewEpisodeNumber(parseInt(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  min="1"
                  required
                />
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Добавить</button>
            </form>
          </div>
        </div>
      )}

      {/* Assign Dubbers Modal */}
      {isAssignDubbersModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Назначить даберов на проект</h2>
              <button onClick={() => setIsAssignDubbersModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
              {participants.map(p => (
                <label key={p.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProjectDubbers.includes(p.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedProjectDubbers([...selectedProjectDubbers, p.id]);
                      } else {
                        setSelectedProjectDubbers(selectedProjectDubbers.filter(id => id !== p.id));
                      }
                    }}
                    className="w-4 h-4 rounded border-neutral-700 bg-neutral-950 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-neutral-200">{p.nickname}</span>
                </label>
              ))}
            </div>
            <div className="p-6 border-t border-neutral-800">
              <button onClick={handleSaveProjectDubbers} className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
