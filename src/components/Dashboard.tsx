import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle2, Clock, AlertCircle, Mic, FileAudio, UserPlus, Link as LinkIcon, MessageSquare, ExternalLink, Calendar, FileText, Image as ImageIcon, Database, FolderPlus, ChevronRight, Download, Save, Loader2, FileVideo, Activity, Users, Settings2, Hash, Globe, User } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Project, Episode, EpisodeStatus, ReleaseType } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getNextEpisodeDate, searchAnime, getAnimeCharacters, getAnimeDetails } from '../services/animeService';
import { ExportModal } from './ExportModal';
import { generateStartEpisodeMessage, generateStatusMessage } from '../lib/templates';
import { sanitizeFolderName } from '../lib/pathUtils';
import GettingStartedGuide from './GettingStartedGuide';

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

const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб'
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
  const [newProjectOriginalTitle, setNewProjectOriginalTitle] = useState('');
  const [newProjectReleaseType, setNewProjectReleaseType] = useState<ReleaseType>('VOICEOVER');
  const [newProjectEmoji, setNewProjectEmoji] = useState('❤️');
  const [newProjectIsOngoing, setNewProjectIsOngoing] = useState(true);
  const [newProjectSynopsis, setNewProjectSynopsis] = useState('');
  const [newProjectPosterUrl, setNewProjectPosterUrl] = useState('');
  const [newProjectTypeAndSeason, setNewProjectTypeAndSeason] = useState('');
  const [newProjectTotalEpisodes, setNewProjectTotalEpisodes] = useState(12);
  const [newProjectCharacters, setNewProjectCharacters] = useState<{name: string, dubberId: string, photoUrl?: string}[]>([]);
  const [animeSearchQuery, setAnimeSearchQuery] = useState('');
  const [animeSearchResults, setAnimeSearchResults] = useState<any[]>([]);
  const [isSearchingAnime, setIsSearchingAnime] = useState(false);
  
  const [isNewEpisodeModalOpen, setIsNewEpisodeModalOpen] = useState(false);
  const [newEpisodeNumber, setNewEpisodeNumber] = useState(1);

  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [isDeleteEpisodeModalOpen, setIsDeleteEpisodeModalOpen] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCharacterManagementModalOpen, setIsCharacterManagementModalOpen] = useState(false);
  const [isAssignSoundEngineerModalOpen, setIsAssignSoundEngineerModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [selectedSoundEngineerId, setSelectedSoundEngineerId] = useState('');

  const [isAssignDubbersModalOpen, setIsAssignDubbersModalOpen] = useState(false);
  const [selectedProjectDubbers, setSelectedProjectDubbers] = useState<string[]>([]);

  const [isUploading, setIsUploading] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');

  const [isProjectSettingsModalOpen, setIsProjectSettingsModalOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');

  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isHardsubEnabled, setIsHardsubEnabled] = useState(false);

  useEffect(() => {
    if (currentEpisode) {
      setIsHardsubEnabled(currentEpisode.isHardsub || false);
    }
  }, [currentEpisode]);

  const handleExport = async (targetDir: string, skipConversion: boolean, smartExport?: boolean) => {
    if (!currentEpisode) return;
    setIsUploading(true);
    setTranscodingProgress(0);
    
    let res;
    if (exportRole === 'DABBER') {
      res = await ipcSafe.invoke('export-dabber-files', { episode: currentEpisode, targetDir, skipConversion });
      
      // Generate Start Episode message after export to dubbers
      if (res.success) {
        const msg = generateStartEpisodeMessage(currentEpisode, participants);
        setGeneratedMessage(msg);
        setIsMessageModalOpen(true);
      }
    } else {
      res = await ipcSafe.invoke('export-sound-engineer-files', { episode: currentEpisode, targetDir, skipConversion, smartExport });
    }

    setIsUploading(false);
    setTranscodingProgress(null);
    setIsExportModalOpen(false);
    if (res.success) {
      alert('Экспорт успешно завершен!');
    } else {
      alert('Ошибка экспорта: ' + res.error);
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    const msg = generateStatusMessage(currentEpisode, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  };

  const handleAnimeSearch = async () => {
    if (!animeSearchQuery.trim()) return;
    setIsSearchingAnime(true);
    const results = await searchAnime(animeSearchQuery);
    setAnimeSearchResults(results);
    setIsSearchingAnime(false);
  };

  const handleSelectAnime = async (anime: any) => {
    setNewProjectTitle(anime.title);
    
    // Fetch full details using the source from search results
    const details = await getAnimeDetails(anime.mal_id, anime.source || 'shikimori');
    
    // The user wants original title in Romaji. 
    // Shikimori 'name' is Romaji. Jikan 'title' is Romaji.
    // We already set original_title in searchAnime.
    const originalTitle = anime.original_title || anime.title;
    
    setNewProjectOriginalTitle(originalTitle);
    setNewProjectTotalEpisodes(anime.episodes || details?.episodes || 12);
    setNewProjectIsOngoing(anime.status === 'Currently Airing' || details?.status === 'Currently Airing');
    setNewProjectSynopsis(anime.synopsis || details?.description || details?.synopsis || '');
    setNewProjectPosterUrl(anime.images?.jpg?.large_image_url || details?.image?.original || '');
    setAnimeSearchResults([]);
    setAnimeSearchQuery('');
    
    // Auto-fill characters
    const characters = await getAnimeCharacters(anime.mal_id, anime.source || 'shikimori');
    if (characters && characters.length > 0) {
      const mapping = characters.slice(0, 15).map((c: any) => ({
        name: c.name,
        dubberId: '',
        photoUrl: c.image || ''
      }));
      setNewProjectCharacters(mapping);
    }
  };

  const handleAddCharacter = () => {
    setNewProjectCharacters(prev => [...prev, { name: '', dubberId: '', photoUrl: '' }]);
    // Use a small timeout to allow the DOM to update before scrolling
    setTimeout(() => {
      const container = document.getElementById('character-list-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  };

  const handleRemoveCharacter = (index: number) => {
    setNewProjectCharacters(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateCharacter = (index: number, name: string) => {
    setNewProjectCharacters(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name };
      return updated;
    });
  };

  const handleFileSelect = async (type: 'RAW' | 'SUB') => {
    if (!currentEpisode) return;

    setIsUploading(true);
    
    try {
      const res = await ipcSafe.invoke('select-file', {
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
        const transcodeRes = await ipcSafe.invoke('transcode-video', {
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
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      const originalExt = finalFilePath.split('.').pop() || 'mp4';
      const targetFileName = type === 'RAW' 
        ? (isHardsubEnabled ? `raw_video_hardsub.${originalExt}` : `raw_video.${originalExt}`) 
        : `subtitles.${originalExt}`;

      const copyRes = await ipcSafe.invoke('copy-file', {
        sourcePath: finalFilePath,
        targetDir: subDir,
        fileName: targetFileName
      });

      if (copyRes.success) {
        // Update episode in DB
        const updateData: any = {};
        if (type === 'RAW') {
          updateData.rawPath = copyRes.data.path;
          updateData.isHardsub = isHardsubEnabled;
        } else {
          updateData.subPath = copyRes.data.path;
        }
        
        // If both exist, move to ROLES status
        if ((type === 'RAW' && currentEpisode.subPath) || (type === 'SUB' && currentEpisode.rawPath)) {
          updateData.status = 'ROLES';
        }

        await ipcSafe.invoke('save-episode', { ...currentEpisode, ...updateData });
        
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
    ipcSafe.invoke('get-config').then(data => {});
    
    const progressListener = (percent: number) => {
      setTranscodingProgress(percent);
    };
    const cleanup = ipcSafe.on('ffmpeg-progress', progressListener);
    
    return () => {
      cleanup();
    };
  }, []);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const [nextEpisodeDate, setNextEpisodeDate] = useState<string | null>(null);

  useEffect(() => {
    const fetchNextDate = async () => {
      if (selectedProject?.originalTitle) {
        const date = await getNextEpisodeDate(selectedProject.originalTitle);
        setNextEpisodeDate(date);
      } else {
        setNextEpisodeDate(null);
      }
    };
    fetchNextDate();
  }, [selectedProject?.originalTitle]);

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
    await ipcSafe.invoke('save-project', updatedProject);
    onRefresh();
    setIsAssignDubbersModalOpen(false);
  };


  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    
    const newProject = {
      id: Date.now().toString(),
      title: newProjectTitle,
      originalTitle: newProjectOriginalTitle,
      releaseType: newProjectReleaseType,
      emoji: newProjectEmoji,
      isOngoing: newProjectIsOngoing,
      synopsis: newProjectSynopsis,
      posterUrl: newProjectPosterUrl,
      typeAndSeason: newProjectTypeAndSeason,
      totalEpisodes: newProjectTotalEpisodes,
      globalMapping: JSON.stringify(newProjectCharacters.map(c => ({ characterName: c.name, dubberId: c.dubberId, photoUrl: c.photoUrl }))),
      status: 'ACTIVE' as const,
      lastActiveEpisode: 1,
      assignedDubberIds: [],
      episodes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ipcSafe.invoke('save-project', newProject);
    onRefresh();
    onProjectSelect(newProject.id);
    setIsNewProjectModalOpen(false);
    setNewProjectTitle('');
    setNewProjectOriginalTitle('');
    setNewProjectReleaseType('VOICEOVER');
    setNewProjectEmoji('❤️');
    setNewProjectIsOngoing(true);
    setNewProjectCharacters([]);
    setNewProjectSynopsis('');
    setNewProjectPosterUrl('');
    setNewProjectTypeAndSeason('');
    setNewProjectTotalEpisodes(12);
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    if (!confirm('Вы уверены, что хотите удалить этот проект и все его серии?')) return;
    
    await ipcSafe.invoke('delete-project', selectedProjectId);
    onProjectSelect('');
    onRefresh();
    setIsDeleteProjectModalOpen(false);
  };

  const handleDeleteEpisode = async () => {
    if (!currentEpisode) return;
    if (!confirm(`Вы уверены, что хотите удалить серию ${currentEpisode.number}?`)) return;
    
    await ipcSafe.invoke('delete-episode', currentEpisode.id);
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
    
    await ipcSafe.invoke('save-episode', newEpisode);
    
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

  const handleExportProject = async () => {
    if (!selectedProject) return;
    
    // Get all participants to include them in the export for full portability
    const allParticipants = await ipcSafe.invoke('get-participants');
    
    const exportData = {
      type: "PROJECT_RELEASE_BUNDLE",
      version: "1.2",
      exportDate: new Date().toISOString(),
      project: selectedProject,
      // Full list of participants ensures we can restore all references
      participants: allParticipants,
      // We can also include some summary stats for the "Audit"
      audit: {
        totalEpisodes: selectedProject.episodes.length,
        totalAssignments: selectedProject.episodes.reduce((acc, ep) => acc + (ep.assignments?.length || 0), 0),
        totalUploads: selectedProject.episodes.reduce((acc, ep) => acc + (ep.uploads?.length || 0), 0),
        completedEpisodes: selectedProject.episodes.filter(ep => ep.status === 'FINISHED').length
      }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${selectedProject.title}_release_audit_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEpisode || !selectedUserId || !characterName || !selectedProject) return;

    // Check aliases
    const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
    const mainName = aliases[characterName] || characterName;

    // Check if already assigned in this episode
    const existing = currentEpisode.assignments?.find(a => a.characterName === mainName);
    if (existing) {
      if (existing.dubberId === selectedUserId) {
        alert('Этот дабер уже назначен на этого персонажа в этой серии.');
        return;
      }
      if (!confirm(`Персонаж "${mainName}" уже назначен на ${participants.find(p => p.id === existing.dubberId)?.nickname}. Переназначить на ${participants.find(p => p.id === selectedUserId)?.nickname}?`)) {
        return;
      }
      // Remove existing assignment for this character
      currentEpisode.assignments = currentEpisode.assignments.filter(a => a.characterName !== mainName);
    }

    const newAssignment = {
      id: Date.now().toString(),
      episodeId: currentEpisode.id,
      characterName: mainName,
      dubberId: selectedUserId,
      status: 'PENDING'
    };
    
    const updatedEpisode = {
      ...currentEpisode,
      assignments: [...(currentEpisode.assignments || []), newAssignment]
    };
    
    await ipcSafe.invoke('save-episode', updatedEpisode);

    // Also update global mapping if not already there
    const globalMapping: {characterName: string, dubberId: string}[] = JSON.parse(selectedProject.globalMapping || '[]');
    const charIndex = globalMapping.findIndex(c => c.characterName === mainName);
    if (charIndex === -1) {
      globalMapping.push({ characterName: mainName, dubberId: selectedUserId });
      await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(globalMapping) });
    } else if (globalMapping[charIndex].dubberId !== selectedUserId) {
      // Optional: Update global mapping if it's different? 
      // User might want to keep it as is or update it. 
      // Let's ask or just update if it was empty.
      if (!globalMapping[charIndex].dubberId) {
        globalMapping[charIndex].dubberId = selectedUserId;
        await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(globalMapping) });
      }
    }

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  const handleAssignSoundEngineer = async () => {
    if (selectedProject) {
      const updatedProject = { ...selectedProject, soundEngineerId: selectedSoundEngineerId };
      await ipcSafe.invoke('save-project', updatedProject);
    }
    onRefresh();
    setIsAssignSoundEngineerModalOpen(false);
    setSelectedSoundEngineerId('');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Stats & Recent Activity Section */}
      {projects.length === 0 ? (
        <GettingStartedGuide onStart={() => setIsNewProjectModalOpen(true)} />
      ) : !selectedProjectId && (
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
              {recentEpisodes.map((ep, idx) => (
                <button
                  key={ep.id || ('ep-' + idx)}
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
            title="Создать новый проект озвучки"
          >
            <FolderPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsAssignDubbersModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Назначить даберов на этот проект"
          >
            <UserPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsAssignSoundEngineerModalOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
            title="Назначить звукорежиссера"
          >
            <Mic className="w-5 h-5" />
          </button>
          {selectedProjectId && (
            <>
              <button 
                onClick={() => setIsProjectSettingsModalOpen(true)}
                className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
                title="Настройки проекта"
              >
                <Settings2 className="w-5 h-5" />
              </button>
              <button 
                onClick={handleDeleteProject}
                className="p-2 bg-red-900/20 hover:bg-red-900/40 rounded-lg text-red-400 hover:text-red-300 transition-colors"
                title="Удалить проект"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsCharacterManagementModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
          >
            <Users className="w-4 h-4" />
            Персонажи
          </button>
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
        <div className="space-y-8">
          {/* Project Info Section */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row">
            {selectedProject.posterUrl && (
              <div className="w-full md:w-48 h-72 md:h-auto flex-shrink-0">
                <img 
                  src={selectedProject.posterUrl} 
                  alt={selectedProject.title} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
            <div className="p-6 flex-1 space-y-4 text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">{selectedProject.title}</h1>
                  <div className="text-neutral-500 font-medium italic">{selectedProject.originalTitle}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-bold border border-blue-500/20">
                    {RELEASE_TYPE_LABELS[selectedProject.releaseType || 'VOICEOVER']}
                  </div>
                  {selectedProject.isOngoing && (
                    <div className="px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs font-bold border border-green-500/20 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Онгоинг
                    </div>
                  )}
                </div>
              </div>
              
              {selectedProject.synopsis && (
                <div className="text-neutral-400 text-sm leading-relaxed line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">
                  {selectedProject.synopsis}
                </div>
              )}
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Всего серий</div>
                  <div className="text-lg font-bold text-white">{selectedProject.totalEpisodes || '?'}</div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">След. серия</div>
                  <div className="text-lg font-bold text-blue-400">{nextEpisodeDate || 'Неизвестно'}</div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Звукорежиссер</div>
                  <div className="text-lg font-bold text-purple-400 truncate">
                    {participants.find(p => p.id === selectedProject.soundEngineerId)?.nickname || '—'}
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Даберы</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {selectedProject.assignedDubberIds?.length || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Episode Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {selectedProject?.episodes?.map((ep, idx) => (
              <button
                key={ep.id || ('ep-' + idx)}
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
                    <div className="flex gap-2">
                      <button onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Экспорт Даберам</button>
                      <button onClick={() => { setExportRole('SOUND_ENGINEER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">Экспорт Звукарю</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-neutral-400 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Статус: <span className="text-blue-400 font-medium">{STATUS_LABELS[currentEpisode.status]}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4" />
                      <span>Звукореж: <span className="text-purple-400 font-medium">{participants.find(p => p.id === selectedProject?.soundEngineerId)?.nickname || 'Не назначен'}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>Даберы: <span className="text-emerald-400 font-medium">{selectedProject?.assignedDubberIds?.length > 0 ? selectedProject.assignedDubberIds.map(id => participants.find(p => p.id === id)?.nickname).filter(Boolean).join(', ') : 'Не назначены'}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>Дата след. серии: <span className="text-orange-400 font-medium">{nextEpisodeDate || 'Не определена'}</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm text-neutral-400">Ориг. название</div>
                    <div className="text-white font-medium">{selectedProject?.originalTitle || 'Не задано'}</div>
                  </div>
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
                        Загружено {currentEpisode.isHardsub && '(Хардсаб)'}
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
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="hardsub-checkbox"
                      checked={isHardsubEnabled}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setIsHardsubEnabled(checked);
                        if (currentEpisode) {
                          await ipcSafe.invoke('save-episode', { ...currentEpisode, isHardsub: checked });
                          onRefresh();
                        }
                      }}
                      className="w-4 h-4 rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-900"
                    />
                    <label htmlFor="hardsub-checkbox" className="text-sm text-neutral-300 cursor-pointer select-none">
                      Хардсаб (видео уже с вшитыми субтитрами)
                    </label>
                  </div>
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
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={handleGenerateReminderMessage}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      Напомнить о сдаче
                    </button>
                    <button 
                      onClick={() => setIsAssignModalOpen(true)}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <UserPlus className="w-4 h-4" />
                      Назначить роль
                    </button>
                  </div>
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
                              statuses: [as.status],
                              lineCount: as.lineCount || 0
                            };
                          } else {
                            if (!grouped[dubberId].characters.includes(as.characterName)) {
                              grouped[dubberId].characters.push(as.characterName);
                            }
                            grouped[dubberId].statuses.push(as.status);
                            grouped[dubberId].lineCount += (as.lineCount || 0);
                          }
                        });

                        return Object.entries(grouped).map(([dubberId, data], idx) => {
                          // Determine overall status for the dubber
                          const allApproved = data.statuses.every((s: string) => s === 'APPROVED');
                          const anyFixes = data.statuses.some((s: string) => s === 'FIXES_NEEDED' || s === 'REJECTED');
                          const displayStatus = allApproved ? 'APPROVED' : anyFixes ? 'FIXES_NEEDED' : data.statuses[0];

                          return (
                            <tr key={(dubberId || 'dubber') + idx} className="hover:bg-neutral-800/30 transition-colors group">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-xs text-blue-400 border border-blue-500/20 font-bold">
                                    {data.dubber?.nickname?.charAt(0) || '?'}
                                  </div>
                                  <span className="text-white font-medium">{data.dubber?.nickname || '...'}</span>
                                  <span className="text-[10px] text-neutral-500 ml-2">({data.lineCount} реп.)</span>
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
        </div>
      )}


      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Новый проект</h2>
              <button onClick={() => setIsNewProjectModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-left">
              {/* Anime Search Section */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800">
                <label className="block text-sm font-medium text-neutral-400 mb-2">Поиск в базе аниме (MAL)</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={animeSearchQuery} 
                    onChange={(e) => setAnimeSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnimeSearch()}
                    className="flex-1 bg-neutral-900 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                    placeholder="Введите название для поиска..."
                  />
                  <button 
                    type="button"
                    onClick={handleAnimeSearch}
                    disabled={isSearchingAnime}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSearchingAnime ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                    Найти
                  </button>
                </div>
                
                {animeSearchResults.length > 0 && (
                  <div className="mt-4 space-y-2 max-h-40 overflow-y-auto pr-2">
                    {animeSearchResults.map((anime, idx) => (
                      <button
                        key={(anime.mal_id || 'anime') + idx}
                        type="button"
                        onClick={() => handleSelectAnime(anime)}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-800 text-left transition-colors group"
                      >
                        <img src={anime.images?.jpg?.small_image_url} alt="" className="w-10 h-14 object-cover rounded" referrerPolicy="no-referrer" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate group-hover:text-blue-400">{anime.title}</div>
                          <div className="text-xs text-neutral-500">{anime.type} • {anime.episodes || '?'} эп. • {anime.status}</div>
                        </div>
                        <Plus className="w-4 h-4 text-neutral-600 group-hover:text-blue-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleCreateProject} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Название аниме</label>
                    <input 
                      type="text" 
                      value={newProjectTitle} 
                      onChange={(e) => setNewProjectTitle(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Напр: Твоё имя"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Оригинальное название</label>
                    <input 
                      type="text" 
                      value={newProjectOriginalTitle} 
                      onChange={(e) => setNewProjectOriginalTitle(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Напр: Kimi no Na wa"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Тип релиза</label>
                    <select 
                      value={newProjectReleaseType}
                      onChange={(e) => setNewProjectReleaseType(e.target.value as ReleaseType)}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="VOICEOVER">Закадр</option>
                      <option value="RECAST">Рекаст</option>
                      <option value="REDUB">Редаб</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Тип и Сезон</label>
                    <input 
                      type="text" 
                      value={newProjectTypeAndSeason} 
                      onChange={(e) => setNewProjectTypeAndSeason(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                      placeholder="TV1, Movie..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Кол-во серий</label>
                    <input 
                      type="number" 
                      value={newProjectTotalEpisodes} 
                      onChange={(e) => setNewProjectTotalEpisodes(parseInt(e.target.value) || 1)}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={newProjectIsOngoing} 
                      onChange={(e) => setNewProjectIsOngoing(e.target.checked)}
                      className="w-4 h-4 bg-neutral-950 border-neutral-800 rounded text-blue-600 focus:ring-blue-500/50"
                    />
                    <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">Онгоинг (выходит сейчас)</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">Постер (URL)</label>
                  <input 
                    type="text" 
                    value={newProjectPosterUrl} 
                    onChange={(e) => setNewProjectPosterUrl(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-neutral-300">Список персонажей (Character List)</label>
                    <button 
                      type="button"
                      onClick={handleAddCharacter}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Добавить
                    </button>
                  </div>
                    <div id="character-list-container" className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 scroll-smooth">
                      {newProjectCharacters.map((char, idx) => (
                        <div key={char.name || ('char-' + idx)} className="flex gap-2 group items-center">
                          {char.photoUrl ? (
                            <img src={char.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-neutral-800" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-700">
                              <User className="w-4 h-4" />
                            </div>
                          )}
                          <input 
                            type="text"
                            value={char.name}
                            onChange={(e) => handleUpdateCharacter(idx, e.target.value)}
                            placeholder="Имя персонажа"
                            className="flex-1 bg-neutral-950 border border-neutral-800 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500/50"
                          />
                          <button 
                            type="button"
                            onClick={() => handleRemoveCharacter(idx)}
                            className="text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    {newProjectCharacters.length === 0 && (
                      <div className="col-span-full text-center py-4 text-xs text-neutral-500 italic border border-dashed border-neutral-800 rounded-lg">
                        Список пуст. Найдите аниме или добавьте вручную.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">Описание (Синопсис)</label>
                  <textarea 
                    value={newProjectSynopsis} 
                    onChange={(e) => setNewProjectSynopsis(e.target.value)}
                    rows={4}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50 resize-none text-sm"
                    placeholder="Краткое описание сюжета..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsNewProjectModalOpen(false)}
                    className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Отмена
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                  >
                    Создать проект
                  </button>
                </div>
              </form>
            </div>
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
              {participants.map((p, idx) => (
                <label key={(p.id || 'p') + idx} className="flex items-center gap-3 p-3 rounded-lg hover:bg-neutral-800 cursor-pointer">
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
                <label className="block text-sm font-medium text-neutral-300 mb-2">Имя персонажа</label>
                <input 
                  type="text" 
                  value={characterName} 
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Наруто"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Дабер</label>
                <select 
                  value={selectedUserId} 
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  <option value="">Выберите дабера</option>
                  {participants.filter(p => selectedProject?.assignedDubberIds?.includes(p.id)).map((p, idx) => (
                    <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Назначить</button>
            </form>
          </div>
        </div>
      )}

      {/* Character Management Modal */}
      {isCharacterManagementModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Управление персонажами и алиасами</h2>
              <button onClick={() => setIsCharacterManagementModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Characters Table */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white">Список персонажей</h3>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={async () => {
                        const name = prompt('Введите имя персонажа:');
                        if (name) {
                          const mapping = JSON.parse(selectedProject.globalMapping || '[]');
                          mapping.push({ characterName: name, dubberId: '' });
                          await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(mapping) });
                          onRefresh();
                        }
                      }}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                    >
                      <Plus className="w-4 h-4" /> Добавить персонажа
                    </button>
                  </div>
                </div>
                
                <div className="bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-neutral-900/50 text-neutral-400 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 font-semibold">Фото</th>
                        <th className="px-4 py-3 font-semibold">Персонаж</th>
                        <th className="px-4 py-3 font-semibold">Дабер по умолчанию</th>
                        <th className="px-4 py-3 font-semibold">Алиасы (через запятую)</th>
                        <th className="px-4 py-3 font-semibold text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {(() => {
                        const mapping: {characterName: string, dubberId: string, photoUrl?: string}[] = JSON.parse(selectedProject.globalMapping || '[]');
                        const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
                        
                        // Group aliases by main character
                        const aliasesByMain: Record<string, string[]> = {};
                        Object.entries(aliases).forEach(([alias, main]) => {
                          if (!aliasesByMain[main]) aliasesByMain[main] = [];
                          aliasesByMain[main].push(alias);
                        });

                        return mapping.map((char, idx) => (
                          <tr key={char.characterName || ('char-' + idx)} className="hover:bg-neutral-900/30 transition-colors">
                            <td className="px-4 py-3">
                              {char.photoUrl ? (
                                <img src={char.photoUrl} alt={char.characterName} className="w-10 h-10 rounded-full object-cover" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-500">
                                  <ImageIcon className="w-5 h-5" />
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-white font-medium">{char.characterName}</td>
                            <td className="px-4 py-3">
                              <select 
                                value={char.dubberId}
                                onChange={async (e) => {
                                  const updatedMapping = [...mapping];
                                  updatedMapping[idx] = { ...char, dubberId: e.target.value };
                                  await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(updatedMapping) });
                                  onRefresh();
                                }}
                                className="bg-neutral-900 border border-neutral-800 text-white rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">Не назначен</option>
                                {participants.filter(p => selectedProject.assignedDubberIds?.includes(p.id)).map((p, idx) => (
                                  <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <input 
                                type="text"
                                defaultValue={aliasesByMain[char.characterName]?.join(', ') || ''}
                                onBlur={async (e) => {
                                  const newAliasesList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                  const updatedAliases = { ...aliases };
                                  
                                  // Remove old aliases for this character
                                  Object.keys(updatedAliases).forEach(k => {
                                    if (updatedAliases[k] === char.characterName) delete updatedAliases[k];
                                  });
                                  
                                  // Add new ones
                                  newAliasesList.forEach(alias => {
                                    updatedAliases[alias] = char.characterName;
                                  });
                                  
                                  await ipcSafe.invoke('save-project', { ...selectedProject, characterAliases: JSON.stringify(updatedAliases) });
                                  onRefresh();
                                }}
                                placeholder="Напр: Наруто Узумаки, Нарик"
                                className="w-full bg-neutral-900 border border-neutral-800 text-neutral-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button 
                                onClick={async () => {
                                  if (confirm(`Удалить персонажа "${char.characterName}"?`)) {
                                    const updatedMapping = mapping.filter((_, i) => i !== idx);
                                    // Also remove aliases
                                    const updatedAliases = { ...aliases };
                                    Object.keys(updatedAliases).forEach(k => {
                                      if (updatedAliases[k] === char.characterName) delete updatedAliases[k];
                                    });
                                    await ipcSafe.invoke('save-project', { 
                                      ...selectedProject, 
                                      globalMapping: JSON.stringify(updatedMapping),
                                      characterAliases: JSON.stringify(updatedAliases)
                                    });
                                    onRefresh();
                                  }
                                }}
                                className="text-neutral-600 hover:text-red-400 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-neutral-800 flex justify-end">
              <button 
                onClick={() => setIsCharacterManagementModalOpen(false)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Sound Engineer Modal */}
      {isAssignSoundEngineerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Назначить звукорежиссера</h2>
              <button onClick={() => setIsAssignSoundEngineerModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Звукорежиссер</label>
                <select 
                  value={selectedSoundEngineerId} 
                  onChange={(e) => setSelectedSoundEngineerId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">Выберите звукорежиссера</option>
                  {participants.map((p, idx) => (
                    <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => handleAssignSoundEngineer()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                >
                  Назначить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Settings Modal */}
      {isProjectSettingsModalOpen && projects.find(p => p.id === selectedProjectId) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-xl font-semibold text-white">Настройки проекта</h2>
              </div>
              <button onClick={() => setIsProjectSettingsModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 space-y-8">
              {(() => {
                const project = projects.find(p => p.id === selectedProjectId)!;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Тип и Сезон (напр. TV1)</label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="text"
                            value={project.typeAndSeason || ''}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                typeAndSeason: e.target.value 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            placeholder="TV1, Movie, OVA..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Дедлайн серии</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="date"
                            value={currentEpisode?.deadline ? new Date(currentEpisode.deadline).toISOString().split('T')[0] : ''}
                            onChange={async (e) => {
                              if (currentEpisode) {
                                await ipcSafe.invoke('save-episode', { ...currentEpisode, deadline: e.target.value });
                                onRefresh();
                              }
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Всего серий</label>
                        <div className="relative">
                          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="number"
                            value={project.totalEpisodes}
                            onChange={async (e) => {
                              await ipcSafe.invoke('save-project', { 
                                ...project, 
                                totalEpisodes: parseInt(e.target.value) 
                              });
                              onRefresh();
                            }}
                            className="w-full bg-black border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2 ml-1">Ссылки на платформы</label>
                      <div className="grid grid-cols-1 gap-3">
                        {(() => {
                          const links = JSON.parse(project.links || '{"anime365":"","tg":"","kodik":"","vk":"","shikimori":""}');
                          return Object.entries(links).map(([key, value], idx) => (
                            <div key={(key || 'link') + idx} className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-600 uppercase w-16">{key}</span>
                              <input
                                type="text"
                                placeholder="URL..."
                                value={value as string}
                                onChange={async (e) => {
                                  const updatedLinks = { ...links, [key]: e.target.value };
                                  await ipcSafe.invoke('save-project', { 
                                    ...project, 
                                    links: JSON.stringify(updatedLinks) 
                                  });
                                  onRefresh();
                                }}
                                className="w-full bg-black border border-neutral-800 rounded-xl py-2.5 pl-20 pr-4 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="p-6 border-t border-neutral-800 flex justify-end">
              <button 
                onClick={() => setIsProjectSettingsModalOpen(false)}
                className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
      {currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen} 
          onClose={() => setIsExportModalOpen(false)} 
          episode={currentEpisode} 
          role={exportRole} 
          onExport={handleExport}
          isExporting={isUploading}
          progress={transcodingProgress || 0}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Сгенерированное сообщение
              </h3>
              <button 
                onClick={() => setIsMessageModalOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <textarea
                readOnly
                value={generatedMessage}
                className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-300 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedMessage);
                  alert("Сообщение скопировано в буфер обмена!");
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                Копировать
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
