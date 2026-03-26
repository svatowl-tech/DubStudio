import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle2, Clock, AlertCircle, Mic, FileAudio, UserPlus, Link as LinkIcon, MessageSquare, ExternalLink, Calendar, FileText, Image as ImageIcon, Database, FolderPlus, ChevronRight, Download, Save } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Project, Episode, EpisodeStatus } from '../types';

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

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [baseDir, setBaseDir] = useState('');

  useEffect(() => {
    getParticipants().then(setParticipants);
    fetch('/api/config').then(res => res.json()).then(data => setBaseDir(data.baseDir || ''));
  }, []);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseDir) return;
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDir })
    });
    if (res.ok) {
      alert('Путь к базе успешно обновлен!');
      setIsSettingsModalOpen(false);
    } else {
      const err = await res.json();
      alert('Ошибка: ' + err.error);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const res = await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'select-folder', args: [] })
      });
      
      if (!res.ok) {
        const text = await res.text();
        console.error('Folder selection failed:', res.status, text);
        alert(`Ошибка выбора папки: ${res.status}`);
        return;
      }

      const result = await res.json();
      if (result.success && result.data?.path) {
        setBaseDir(result.data.path);
      } else {
        console.error('Folder selection error:', result.error);
        alert('Ошибка выбора папки: ' + (result.error || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Folder selection error:', error);
      alert('Ошибка при выполнении запроса выбора папки');
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newProjectTitle })
    });
    const newProject = await res.json();
    onRefresh();
    onProjectSelect(newProject.id);
    setIsNewProjectModalOpen(false);
    setNewProjectTitle('');
  };

  const handleCreateEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    
    await fetch(`/api/projects/${selectedProjectId}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: newEpisodeNumber })
    });
    
    onRefresh();
    setIsNewEpisodeModalOpen(false);
  };

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

    await fetch(`/api/episodes/${currentEpisode.id}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterName, dubberId: selectedUserId })
    });

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Project Selector & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <select 
            value={selectedProjectId || ''} 
            onChange={(e) => onProjectSelect(e.target.value)}
            className="bg-neutral-900 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="" disabled>Выберите проект</option>
            {projects?.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <button 
            onClick={() => setIsNewProjectModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Новый проект"
          >
            <FolderPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Настройки пути"
          >
            <Database className="w-5 h-5" />
          </button>
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
                className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all ${
                  currentEpisode?.id === ep.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                    : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                Серия {ep.number}
              </button>
            ))}
          </div>

          {currentEpisode && (
            <div className="space-y-8">
              {/* Episode Status Header */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Серия {currentEpisode.number}</h2>
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
                        <th className="px-6 py-4 font-semibold">Персонаж</th>
                        <th className="px-6 py-4 font-semibold">Даббер</th>
                        <th className="px-6 py-4 font-semibold">Статус</th>
                        <th className="px-6 py-4 font-semibold text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {currentEpisode?.assignments?.map(as => (
                        <tr key={as.id} className="hover:bg-neutral-800/30 transition-colors group">
                          <td className="px-6 py-4 text-neutral-200 font-medium">{as.characterName}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-400 border border-neutral-700">
                                {as.dubber?.nickname?.charAt(0) || '?'}
                              </div>
                              <span className="text-neutral-300">{as.dubber?.nickname || '...'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                              {as.status || 'PENDING'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button className="text-neutral-500 hover:text-white transition-colors">
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
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

      {/* Assign Role Modal */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Назначить роль</h2>
              <button onClick={() => setIsAssignModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAssignRole} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Персонаж</label>
                <input 
                  type="text" 
                  value={characterName} 
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Имя персонажа"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Даббер</label>
                <select 
                  value={selectedUserId} 
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  <option value="">Выберите даббера</option>
                  {participants?.map(p => (
                    <option key={p.id} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Назначить</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
