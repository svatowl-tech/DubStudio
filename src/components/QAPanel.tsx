import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, CheckCircle, XCircle, AlertCircle, MessageSquare, Volume2, Check, X, Activity, Download, User, Clock, FileAudio, Send, Video, Trash2 } from 'lucide-react';
import { Episode, RoleAssignment } from '../types';

interface QAPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface Track {
  id: string;
  participant: string;
  character: string;
  status: 'pending' | 'approved' | 'rejected' | 'fixes_needed';
  fileUrl?: string;
  comments: Comment[];
}

interface Comment {
  id: string;
  text: string;
  timestamp: number;
  author: string;
}

export default function QAPanel({ currentEpisode, onRefresh }: QAPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [originalVolume, setOriginalVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);

  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Map assignments to tracks
  useEffect(() => {
    if (!currentEpisode) return;
    
    const mappedTracks: Track[] = currentEpisode.assignments?.map(as => {
      // Find the latest DUBBER_FILE for this assignment
      const dubberFile = currentEpisode.uploads?.find(u => u.assignmentId === as.id && u.type === 'DUBBER_FILE');
      
      return {
        id: as.id,
        participant: as.dubber?.nickname || 'Unknown',
        character: as.characterName,
        status: (as.status?.toLowerCase() || 'pending') as Track['status'],
        fileUrl: dubberFile?.path,
        comments: [] // In a real app, this would be in the DB
      };
    }) || [];
    
    setTracks(mappedTracks);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode]);

  const selectedTrack = tracks.find(t => t.id === selectedTrackId);

  useEffect(() => {
    if (!containerRef.current || !selectedTrack?.fileUrl) return;

    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    wavesurferRef.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3b82f6',
      progressColor: '#1d4ed8',
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 3,
      height: 100,
      normalize: true,
    });

    wavesurferRef.current.load(selectedTrack.fileUrl);

    wavesurferRef.current.on('ready', () => {
      setDuration(wavesurferRef.current?.getDuration() || 0);
    });

    wavesurferRef.current.on('audioprocess', () => {
      const time = wavesurferRef.current?.getCurrentTime() || 0;
      setCurrentTime(time);
      if (videoRef.current) videoRef.current.currentTime = time;
    });

    wavesurferRef.current.on('play', () => setIsPlaying(true));
    wavesurferRef.current.on('pause', () => setIsPlaying(false));

    return () => wavesurferRef.current?.destroy();
  }, [selectedTrackId, selectedTrack?.fileUrl]);

  const togglePlay = () => {
    wavesurferRef.current?.playPause();
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  const handleAddComment = () => {
    if (!newComment.trim() || !selectedTrackId) return;

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      text: newComment,
      timestamp: currentTime,
      author: 'Куратор'
    };

    setTracks(tracks.map(t => 
      t.id === selectedTrackId ? { ...t, comments: [...t.comments, comment] } : t
    ));
    setNewComment('');
  };

  const handleStatusChange = async (id: string, status: Track['status']) => {
    if (!currentEpisode) return;
    
    // Convert Track status back to RoleAssignment status
    const dbStatus = status.toUpperCase();
    
    try {
      await fetch(`/api/assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: dbStatus }),
      });

      // Check if all assignments are approved
      const allApproved = currentEpisode.assignments?.every(a => 
        a.id === id ? dbStatus === 'APPROVED' : a.status === 'APPROVED'
      ) || false;

      const needsFixes = dbStatus === 'FIXES_NEEDED' || dbStatus === 'REJECTED';

      if (allApproved) {
        await fetch(`/api/episodes/${currentEpisode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'SOUND_ENGINEERING' }),
        });
      } else if (needsFixes && currentEpisode.status !== 'FIXES') {
        await fetch(`/api/episodes/${currentEpisode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'FIXES' }),
        });
      }

      onRefresh();
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const handleFileUpload = async (e: any, assignmentId: string) => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    const projectTitle = currentEpisode.project?.title || 'Project';
    const subDir = `${projectTitle}/Episode_${currentEpisode.number}/QAFixes`;
    const fileName = `dub_${assignmentId}_${Date.now()}.${file.name.split('.').pop() || 'wav'}`;
    
    const formData = new FormData();
    formData.append('subDir', subDir);
    formData.append('fileName', fileName);
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: formData
      });
      const { data } = await res.json();
      
      // Save to DB
      await fetch(`/api/episodes/${currentEpisode.id}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'DUBBER_FILE',
          path: data.url,
          uploadedById: currentEpisode.assignments.find(a => a.id === assignmentId)?.dubberId,
          assignmentId
        })
      });

      // Update assignment status to RECORDED
      await fetch(`/api/assignments/${assignmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECORDED' }),
      });

      // Check if all assignments are recorded or approved
      const allRecorded = currentEpisode.assignments?.every(a => 
        a.id === assignmentId ? true : a.status === 'RECORDED' || a.status === 'APPROVED'
      ) || false;
      
      if (allRecorded && currentEpisode.status === 'FIXES') {
        await fetch(`/api/episodes/${currentEpisode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'QA' }),
        });
      }
      
      onRefresh();
    } catch (error) {
      console.error('Upload error:', error);
    }
  };

  if (!currentEpisode) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Выберите серию в Дашборде для проверки качества
      </div>
    );
  }

  return (
    <div className="flex h-full bg-neutral-950 overflow-hidden w-full">
      {/* Sidebar - Tracks List */}
      <div className="w-80 border-r border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="font-bold text-white">Список дорожек</h2>
          <span className="text-xs text-neutral-500">{tracks.length} ролей</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
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
                  {track.status}
                </span>
                {track.fileUrl && <CheckCircle className="w-3 h-3 text-green-500" />}
              </div>
              <div className="text-white font-medium">{track.character}</div>
              <div className="text-xs text-neutral-400">{track.participant}</div>
              
              {!track.fileUrl && (
                <div className="mt-2">
                  <label className="cursor-pointer text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded block text-center">
                    Загрузить аудио
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="audio/*" 
                      onChange={(e) => handleFileUpload(e, track.id)} 
                    />
                  </label>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content - Player & Comments */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTrack ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Video & Waveform */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group">
                  <video 
                    ref={videoRef}
                    src={currentEpisode.rawPath || undefined}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={togglePlay} className="p-4 bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-md text-white">
                      {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 fill-current" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                          {selectedTrack.participant.charAt(0)}
                        </div>
                        <div>
                          <div className="text-white font-bold">{selectedTrack.character}</div>
                          <div className="text-xs text-neutral-400">{selectedTrack.participant}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'approved')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'approved' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-green-400'}`}
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'fixes_needed')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'fixes_needed' ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-yellow-400'}`}
                        >
                          <AlertCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'rejected')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'rejected' ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-red-400'}`}
                        >
                          <XCircle className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <Volume2 className="w-4 h-4 text-neutral-500" />
                        <input 
                          type="range" min="0" max="1" step="0.1" value={volume} 
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setVolume(v);
                            if (wavesurferRef.current) wavesurferRef.current.setVolume(v);
                          }}
                          className="flex-1 accent-blue-500"
                        />
                        <span className="text-[10px] text-neutral-500 w-8">DUB</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <Volume2 className="w-4 h-4 text-neutral-500" />
                        <input 
                          type="range" min="0" max="1" step="0.1" value={originalVolume} 
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setOriginalVolume(v);
                            if (videoRef.current) videoRef.current.volume = v;
                          }}
                          className="flex-1 accent-neutral-500"
                        />
                        <span className="text-[10px] text-neutral-500 w-8">RAW</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-[200px] flex flex-col">
                    <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Правки и комментарии
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                      {selectedTrack.comments.map(comment => (
                        <div key={comment.id} className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/50">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[10px] font-bold text-blue-400 uppercase">{comment.author}</span>
                            <span className="text-[10px] text-neutral-500">{new Date(comment.timestamp * 1000).toISOString().substr(14, 5)}</span>
                          </div>
                          <p className="text-sm text-neutral-200">{comment.text}</p>
                        </div>
                      ))}
                      {selectedTrack.comments.length === 0 && (
                        <div className="h-full flex items-center justify-center text-neutral-600 text-sm italic">
                          Комментариев пока нет
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Waveform Section */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
                <div ref={containerRef} className="mb-4" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={togglePlay} className="w-12 h-12 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white transition-all shadow-lg shadow-blue-500/20">
                      {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                    </button>
                    <div className="text-2xl font-mono text-white">
                      {new Date(currentTime * 1000).toISOString().substr(14, 5)}
                      <span className="text-neutral-600"> / {new Date(duration * 1000).toISOString().substr(14, 5)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Добавить комментарий на этой секунде..."
                      className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-4 py-2 w-80 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <button 
                      onClick={handleAddComment}
                      className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors"
                    >
                      Отправить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-600 italic">
            Выберите дорожку для начала проверки
          </div>
        )}
      </div>
    </div>
  );
}
