import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Scissors, Settings, Mic2, Activity, PlaySquare, Database } from 'lucide-react';
import Dashboard from './components/Dashboard';
import QAPanel from './components/QAPanel';
import ReleasePanel from './components/ReleasePanel';
import AssEditor from './components/AssEditor';
import DatabasePanel from './components/DatabasePanel';
import SettingsPanel from './components/SettingsPanel';
import TaskQueuePanel from './components/TaskQueuePanel';
import { Project, Episode } from './types';
import { ipcSafe } from './lib/ipcSafe';
import { VideoProvider } from './contexts/VideoContext';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';

function AppContent() {
  type TabType = 'dashboard' | 'subtitles' | 'qa' | 'release' | 'settings' | 'database';
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);

  useGlobalKeyboard();

  const loadProjects = useCallback(async () => {
    try {
      const data = await ipcSafe.invoke('get-projects');
      if (!data) return;
      
      setProjects(data);
      
      let newSelectedProjectId = selectedProjectId;
      if (data.length > 0 && !selectedProjectId) {
        newSelectedProjectId = data[0].id;
        setSelectedProjectId(newSelectedProjectId);
      }
      
      if (newSelectedProjectId) {
        const updatedProject = data.find((p: Project) => p.id === newSelectedProjectId);
        if (updatedProject) {
          const ep = updatedProject.episodes?.find((e: Episode) => e.number === updatedProject.lastActiveEpisode) || updatedProject.episodes?.[0];
          setCurrentEpisode(ep ? { ...ep, project: updatedProject } : null);
        }
      }
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadProjects();
    // Ensure window has focus on startup to avoid unresponsive inputs
    window.focus();
  }, [loadProjects]);

  const handleNavigate = (tab: TabType) => {
    setActiveTab(tab);
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = projects.find(p => p.id === projectId);
    if (project) {
      const ep = project.episodes.find(e => e.number === project.lastActiveEpisode) || project.episodes[0];
      if (ep) {
        setCurrentEpisode({ ...ep, project });
      } else {
        setCurrentEpisode(null);
      }
    }
  };

  const handleEpisodeSelect = async (episodeNumber: number) => {
    if (!selectedProjectId) return;
    const project = projects.find(p => p.id === selectedProjectId);
    if (project) {
      await ipcSafe.invoke('save-project', { ...project, lastActiveEpisode: episodeNumber });
      await loadProjects();
    }
  };

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-neutral-800">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Mic2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">Anime Dub Manager</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <button
            id="step-dashboard"
            onClick={() => setActiveTab('dashboard')}
            title="Главная панель управления проектами и сериями"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'dashboard' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Дашборд проекта</span>
          </button>

          <button
            id="step-subtitles"
            onClick={() => setActiveTab('subtitles')}
            title="Инструменты для редактирования и синхронизации субтитров (ASS)"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'subtitles' 
                ? 'bg-indigo-600/10 text-indigo-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Scissors className="w-5 h-5" />
            <span>Утилиты (ASS)</span>
          </button>

          <button
            id="step-qa"
            onClick={() => setActiveTab('qa')}
            title="Проверка качества озвучки и синхронизации"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'qa' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-5 h-5" />
            <span>QA Проверка</span>
          </button>

          <button
            onClick={() => setActiveTab('release')}
            title="Финальная сборка и экспорт релиза"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'release' 
                ? 'bg-purple-600/10 text-purple-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <PlaySquare className="w-5 h-5" />
            <span>Сборка релиза</span>
          </button>
        </nav>

        <div className="p-4 border-t border-neutral-800 space-y-1">
          <button
            onClick={() => setActiveTab('database')}
            title="Управление списком даберов, звукорежиссеров и их контактами"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'database' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Database className="w-5 h-5" />
            <span>База участников</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            title="Настройка путей к файлам, API ключей и других параметров"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'settings' 
                ? 'bg-neutral-800 text-white' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>Настройки</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 bg-neutral-950 flex flex-col p-8 ${['subtitles', 'qa'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {activeTab === 'dashboard' && (
          <Dashboard 
            onNavigate={handleNavigate} 
            projects={projects}
            selectedProjectId={selectedProjectId}
            currentEpisode={currentEpisode}
            onProjectSelect={handleProjectSelect}
            onEpisodeSelect={handleEpisodeSelect}
            onRefresh={loadProjects}
          />
        )}
        {activeTab === 'subtitles' && <AssEditor currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        {activeTab === 'release' && <ReleasePanel currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        {activeTab === 'database' && <DatabasePanel />}
        {activeTab === 'settings' && <SettingsPanel />}
        {activeTab === 'qa' && <QAPanel currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        <TaskQueuePanel />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <VideoProvider>
      <AppContent />
    </VideoProvider>
  );
}
