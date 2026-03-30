import { useState, useEffect } from 'react';
import { LayoutDashboard, Scissors, Settings, Mic2, Activity, PlaySquare, Database } from 'lucide-react';
import Dashboard from './components/Dashboard';
import QAPanel from './components/QAPanel';
import ReleasePanel from './components/ReleasePanel';
import AssEditor from './components/AssEditor';
import Downloader from './components/Downloader';
import DatabasePanel from './components/DatabasePanel';
import SettingsPanel from './components/SettingsPanel';
import { Project, Episode } from './types';
import { ipcRenderer } from './lib/ipc';
import { VideoProvider } from './contexts/VideoContext';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';

function AppContent() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'subtitles' | 'qa' | 'release' | 'downloader' | 'settings' | 'database'>('dashboard');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);

  useGlobalKeyboard();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const data = await ipcRenderer.invoke('get-projects');
    setProjects(data);
    
    // Auto-select first project if none selected
    if (data.length > 0 && !selectedProjectId) {
      const firstProject = data[0];
      setSelectedProjectId(firstProject.id);
      const ep = firstProject.episodes?.find((e: Episode) => e.number === firstProject.lastActiveEpisode) || firstProject.episodes?.[0];
      if (ep) {
        setCurrentEpisode({ ...ep, project: firstProject });
      } else {
        setCurrentEpisode(null);
      }
    } else if (selectedProjectId) {
      const updatedProject = data.find((p: Project) => p.id === selectedProjectId);
      if (updatedProject) {
        const ep = updatedProject.episodes?.find((e: Episode) => e.number === updatedProject.lastActiveEpisode) || updatedProject.episodes?.[0];
        if (ep) {
          setCurrentEpisode({ ...ep, project: updatedProject });
        } else {
          setCurrentEpisode(null);
        }
      }
    }
  };

  const handleNavigate = (tab: string) => {
    setActiveTab(tab as any);
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
      await ipcRenderer.invoke('save-project', { ...project, lastActiveEpisode: episodeNumber });
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
            onClick={() => setActiveTab('dashboard')}
            title="Перейти на дашборд проекта"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'dashboard' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Дашборд проекта
          </button>

          <button
            onClick={() => setActiveTab('subtitles')}
            title="Перейти к утилитам для субтитров (ASS)"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'subtitles' 
                ? 'bg-indigo-600/10 text-indigo-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Scissors className="w-5 h-5" />
            Утилиты (ASS)
          </button>

          <button
            onClick={() => setActiveTab('qa')}
            title="Перейти к QA проверке"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'qa' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-5 h-5" />
            QA Проверка
          </button>

          <button
            onClick={() => setActiveTab('release')}
            title="Перейти к сборке релиза"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'release' 
                ? 'bg-purple-600/10 text-purple-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <PlaySquare className="w-5 h-5" />
            Сборка релиза
          </button>
        </nav>

        <div className="p-4 border-t border-neutral-800 space-y-1">
          <button
            onClick={() => setActiveTab('database')}
            title="Перейти к базе участников"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'database' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Database className="w-5 h-5" />
            База участников
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            title="Перейти к настройкам"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'settings' 
                ? 'bg-neutral-800 text-white' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Settings className="w-5 h-5" />
            Настройки
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
        {activeTab === 'downloader' && <Downloader currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        {activeTab === 'subtitles' && <AssEditor currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        {activeTab === 'release' && <ReleasePanel currentEpisode={currentEpisode} onRefresh={loadProjects} />}
        {activeTab === 'database' && <DatabasePanel />}
        {activeTab === 'settings' && <SettingsPanel />}
        {activeTab === 'qa' && <QAPanel currentEpisode={currentEpisode} onRefresh={loadProjects} />}
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
