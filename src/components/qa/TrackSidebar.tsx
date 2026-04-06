import React from 'react';
import { Activity, CheckCircle, Check, MessageSquare, Clock, Mic } from 'lucide-react';
import { STATUS_MAP } from '../../constants';

interface Track {
  id: string;
  participant: string;
  character: string;
  status: 'pending' | 'approved' | 'rejected' | 'fixes_needed';
  files: { id: string; path: string; createdAt: string; type?: 'DUBBER_FILE' | 'FIXES' }[];
  selectedFileId?: string;
  comments: any[];
}

interface TrackSidebarProps {
  tracks: Track[];
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;
  handleApproveAll: () => void;
  handleFileUpload: (e: any, trackId: string, type?: 'DUBBER_FILE' | 'FIXES') => void;
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  onGenerateFixesMessage?: () => void;
  onGenerateReminderMessage?: () => void;
  onExportSoundEngineer?: () => void;
  onBakeSubtitles?: () => void;
  isBaking?: boolean;
  bakeProgress?: number;
  bakeStatus?: string;
}

export const TrackSidebar: React.FC<TrackSidebarProps> = ({
  tracks,
  selectedTrackId,
  setSelectedTrackId,
  handleApproveAll,
  handleFileUpload,
  setTracks,
  onGenerateFixesMessage,
  onGenerateReminderMessage,
  onExportSoundEngineer,
  onBakeSubtitles,
  isBaking,
  bakeProgress,
  bakeStatus
}) => {
  return (
    <div className="w-80 border-r border-neutral-800 flex flex-col">
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <h2 className="font-bold text-white">Список дорожек</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleApproveAll}
            title="Одобрить все"
            className="p-1.5 hover:bg-green-600/20 text-green-500 rounded-md transition-colors"
          >
            <Check className="w-4 h-4" />
          </button>
          <span className="text-xs text-neutral-500">{tracks.length} ролей</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <button
          onClick={() => setSelectedTrackId('all')}
          className={`w-full p-3 rounded-lg text-left transition-all border ${
            selectedTrackId === 'all' 
              ? 'bg-blue-600/10 border-blue-500/50' 
              : 'bg-neutral-900/50 border-transparent hover:border-neutral-700'
          }`}
        >
          <div className="text-white font-bold flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Отсмотреть всех
          </div>
          <div className="text-xs text-neutral-400 mt-1">Общий микс всех даберов</div>
        </button>
        
        <div className="h-px bg-neutral-800 my-2" />

        {tracks.map(track => (
          <button
            key={track.id}
            onClick={() => setSelectedTrackId(track.id)}
            className={`w-full p-3 rounded-lg text-left transition-all border ${
              selectedTrackId === track.id 
                ? 'bg-blue-600/10 border-blue-500/50' 
                : 'bg-neutral-900/50 border-transparent hover:border-neutral-700'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                track.status === 'approved' ? 'text-green-400' :
                track.status === 'rejected' ? 'text-red-400' :
                track.status === 'fixes_needed' ? 'text-yellow-400' : 'text-blue-400'
              }`}>
                {STATUS_MAP[track.status.toUpperCase()]?.label || track.status}
              </span>
              {track.files.length > 0 && <CheckCircle className="w-3 h-3 text-green-500" />}
            </div>
            <div className="text-white font-medium">{track.participant}</div>
            <div className="text-xs text-neutral-400">{track.character}</div>
            
            {track.files.length > 0 && (
              <div className="mt-2 text-[10px] text-neutral-400">
                <select 
                  className="bg-neutral-800 text-white rounded px-1 py-0.5 w-full"
                  value={track.selectedFileId}
                  onChange={(e) => {
                    const newFileId = e.target.value;
                    setTracks(prev => prev.map(t => t.id === track.id ? { ...t, selectedFileId: newFileId } : t));
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {track.files.map((f, idx) => (
                    <option key={f.id} value={f.id}>
                      {f.type === 'FIXES' ? 'Фикс' : 'Версия'} {idx + 1} ({new Date(f.createdAt).toLocaleTimeString()})
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="mt-2 flex gap-2">
              <label className="flex-1 cursor-pointer text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded block text-center transition-colors">
                {track.files.length === 0 ? 'Загрузить аудио' : 'Добавить версию'}
                <input 
                  type="file" 
                  className="hidden" 
                  accept="audio/*" 
                  onChange={(e) => handleFileUpload(e, track.id, 'DUBBER_FILE')} 
                />
              </label>
              {track.files.length > 0 && (
                <label className="flex-1 cursor-pointer text-[10px] bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-2 py-1 rounded block text-center border border-amber-900/50 transition-colors">
                  Загрузить фикс
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="audio/*" 
                    onChange={(e) => handleFileUpload(e, track.id, 'FIXES')} 
                  />
                </label>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-neutral-800 space-y-2">
        <button 
          onClick={onGenerateFixesMessage}
          className="w-full py-2 bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Выписка фиксов
        </button>
        <button 
          onClick={onGenerateReminderMessage}
          className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <Clock className="w-3.5 h-3.5" />
          Напомнить о сдаче
        </button>
        <button 
          onClick={onExportSoundEngineer}
          className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          <Mic className="w-3.5 h-3.5" />
          Экспорт для звукача
        </button>
        <button 
          onClick={onBakeSubtitles}
          disabled={isBaking}
          className="w-full py-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Activity className="w-3.5 h-3.5" />
          {isBaking ? `Рендеринг ${Math.round(bakeProgress || 0)}%` : 'Вшить субтитры'}
        </button>
      </div>
    </div>
  );
};
