import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, CheckCircle, XCircle, AlertCircle, MessageSquare, Volume2, Check, X, Activity, Download, User, Clock, FileAudio, Send, Video, Trash2 } from 'lucide-react';
import { ipcRenderer } from '../lib/ipc';
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

const STATUS_MAP: Record<string, string> = {
  pending: 'Ожидает',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  fixes_needed: 'Нужны правки'
};

export default function QAPanel({ currentEpisode, onRefresh }: QAPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [originalVolume, setOriginalVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [subLines, setSubLines] = useState<any[]>([]);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync all audio tracks with video/master time
  useEffect(() => {
    if (!isPlaying) {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio instanceof HTMLAudioElement) audio.pause();
      });
      return;
    }

    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        audio.currentTime = currentTime;
        audio.play().catch(e => console.error('Audio play error', e));
      }
    });
  }, [isPlaying]);

  // Update audio volumes
  useEffect(() => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (audio instanceof HTMLAudioElement) {
        audio.volume = isMuted ? 0 : volume;
      }
    });
  }, [volume, isMuted]);

  // Clean up audio elements on unmount or track change
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio instanceof HTMLAudioElement) {
          audio.pause();
          audio.src = '';
        }
      });
      audioRefs.current = {};
    };
  }, [currentEpisode?.id]);

  // Initialize audio elements for all tracks (except selected one which is handled by WaveSurfer)
  useEffect(() => {
    if (!currentEpisode) return;
    
    tracks.forEach(track => {
      if (track.id === selectedTrackId) {
        // If it was previously in audioRefs, remove it
        if (audioRefs.current[track.id]) {
          audioRefs.current[track.id].pause();
          delete audioRefs.current[track.id];
        }
        return;
      }

      if (track.fileUrl && !audioRefs.current[track.id]) {
        const audio = new Audio(track.fileUrl);
        audio.volume = volume;
        audioRefs.current[track.id] = audio;
      } else if (track.fileUrl && audioRefs.current[track.id]) {
        // Update source if it changed
        if (audioRefs.current[track.id].src !== track.fileUrl) {
          audioRefs.current[track.id].src = track.fileUrl;
        }
      }
    });
  }, [tracks, currentEpisode, selectedTrackId]);

  // Map assignments to tracks (grouped by dubber)
  useEffect(() => {
    if (!currentEpisode) return;
    
    const dubberTracks: Record<string, Track> = {};
    
    currentEpisode.assignments?.forEach(as => {
      const dubberId = as.dubberId;
      const dubberName = as.dubber?.nickname || 'Неизвестно';
      
      // Find the latest DUBBER_FILE for this dubber in this episode
      // Note: We look for uploads linked to ANY assignment of this dubber
      const dubberFile = currentEpisode.uploads?.find(u => 
        u.type === 'DUBBER_FILE' && 
        (u.assignmentId === as.id || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.dubberId === dubberId)
      );
      
      let comments: Comment[] = [];
      if (as.comments) {
        try {
          comments = JSON.parse(as.comments);
        } catch (e) {
          console.error('Failed to parse comments', e);
        }
      }

      if (!dubberTracks[dubberId]) {
        dubberTracks[dubberId] = {
          id: dubberId, // Use dubberId as track ID
          participant: dubberName,
          character: as.characterName,
          status: (as.status?.toLowerCase() || 'pending') as Track['status'],
          fileUrl: dubberFile?.path,
          comments
        };
      } else {
        // Append character name if multiple
        if (!dubberTracks[dubberId].character.includes(as.characterName)) {
          dubberTracks[dubberId].character += `, ${as.characterName}`;
        }
        // Merge comments
        dubberTracks[dubberId].comments = [...dubberTracks[dubberId].comments, ...comments];
      }
    });
    
    const mappedTracks = Object.values(dubberTracks);
    setTracks(mappedTracks);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode]);

  // Load subtitles for auto-detection
  useEffect(() => {
    const loadSubs = async () => {
      if (currentEpisode?.subPath) {
        try {
          const res = await ipcRenderer.invoke('get-raw-subtitles', currentEpisode.subPath);
          if (res && res.lines) {
            setSubLines(res.lines);
          }
        } catch (e) {
          console.error('Failed to load subs for QA', e);
        }
      }
    };
    loadSubs();
  }, [currentEpisode?.subPath]);

  // Track current character based on time
  useEffect(() => {
    const line = subLines.find(l => currentTime >= l.Start && currentTime <= l.End);
    setCurrentCharacter(line ? line.Name : null);
  }, [currentTime, subLines]);

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
    const newPlaying = !isPlaying;
    setIsPlaying(newPlaying);
    
    if (wavesurferRef.current) {
      if (newPlaying) wavesurferRef.current.play();
      else wavesurferRef.current.pause();
    }
    
    if (videoRef.current) {
      if (newPlaying) videoRef.current.play();
      else videoRef.current.pause();
    }

    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        if (newPlaying) {
          audio.currentTime = currentTime;
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
    });
  };

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (wavesurferRef.current) {
      wavesurferRef.current.pause();
      wavesurferRef.current.setTime(0);
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentEpisode) return;

    // Auto-detect track based on current character at this timestamp
    let targetTrackId = selectedTrackId;
    if (currentCharacter) {
      const matchingAssignment = currentEpisode.assignments?.find(
        a => a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      );
      if (matchingAssignment) {
        targetTrackId = matchingAssignment.dubberId; // Use dubberId as track ID
        // Switch view to this track so the curator sees where it went
        setSelectedTrackId(targetTrackId);
      }
    }

    if (!targetTrackId) return;

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      text: newComment,
      timestamp: currentTime,
      author: 'Куратор'
    };

    const updatedTracks = tracks.map(t => 
      t.id === targetTrackId ? { 
        ...t, 
        comments: [...t.comments, comment],
        status: 'fixes_needed' as const
      } : t
    );
    
    setTracks(updatedTracks);
    setNewComment('');

    // Save to DB (add comment to the specific assignment matching the character, or the first one if not found)
    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        const isTargetDubber = a.dubberId === targetTrackId;
        const isCurrentChar = currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase();
        
        if (isTargetDubber && (isCurrentChar || !currentCharacter)) {
          // We found the assignment to attach the comment to
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}
          
          return { 
            ...a, 
            comments: JSON.stringify([...existingComments, comment]),
            status: 'FIXES_NEEDED'
          };
        }
        return a;
      }) || [];

      await ipcRenderer.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });
    } catch (error) {
      console.error('Save comment error:', error);
    }
  };

  const handleDeleteComment = async (trackId: string, commentId: string) => {
    if (!currentEpisode) return;

    const updatedTracks = tracks.map(t => 
      t.id === trackId ? { ...t, comments: t.comments.filter(c => c.id !== commentId) } : t
    );
    
    setTracks(updatedTracks);

    try {
      // Remove comment from all assignments of this dubber (since we don't know which one it was on exactly)
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        if (a.dubberId === trackId) {
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}
          const filtered = existingComments.filter(c => c.id !== commentId);
          return { ...a, comments: JSON.stringify(filtered) };
        }
        return a;
      }) || [];

      await ipcRenderer.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments 
      });
    } catch (error) {
      console.error('Delete comment error:', error);
    }
  };

  const handleApproveAll = async () => {
    if (!currentEpisode || !window.confirm('Одобрить ВСЕ дорожки в этом эпизоде?')) return;

    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => ({
        ...a,
        status: 'APPROVED'
      })) || [];

      await ipcRenderer.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: 'SOUND_ENGINEERING'
      });

      onRefresh();
    } catch (error) {
      console.error('Approve all error:', error);
    }
  };

  const handleStatusChange = async (id: string, status: Track['status']) => {
    if (!currentEpisode) return;
    
    // Convert Track status back to RoleAssignment status
    const dbStatus = status.toUpperCase();
    
    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => 
        a.id === id ? { ...a, status: dbStatus } : a
      ) || [];

      // Check if all assignments are approved
      const allApproved = updatedAssignments.every(a => a.status === 'APPROVED');
      const needsFixes = dbStatus === 'FIXES_NEEDED' || dbStatus === 'REJECTED';

      let newStatus = currentEpisode.status;
      if (allApproved) {
        newStatus = 'SOUND_ENGINEERING';
      } else if (needsFixes && currentEpisode.status !== 'FIXES') {
        newStatus = 'FIXES';
      }

      await ipcRenderer.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: newStatus
      });

      onRefresh();
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const handleFileUpload = async (e: any, trackId: string) => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    // Find one of the assignments for this dubber to link the upload to
    const assignment = currentEpisode.assignments?.find(a => a.dubberId === trackId);
    if (!assignment) return;

    const projectTitle = currentEpisode.project?.title || 'Project';
    const subDir = `${projectTitle}/Episode_${currentEpisode.number}/QAFixes`;
    const fileName = `dub_${assignment.id}_${Date.now()}.${file.name.split('.').pop() || 'wav'}`;
    
    try {
      let res;
      if (file.path) {
        res = await ipcRenderer.invoke('copy-file', {
          sourcePath: file.path,
          targetDir: subDir,
          fileName
        });
      } else {
        // Browser fallback: read as buffer to avoid "src argument must be string" error
        const buffer = await file.arrayBuffer();
        res = await ipcRenderer.invoke('save-file-buffer', {
          buffer,
          targetDir: subDir,
          fileName
        });
      }
      
      if (!res.success) throw new Error(res.error);
      
      const newUpload = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'DUBBER_FILE',
        path: res.data.path,
        uploadedById: trackId,
        assignmentId: assignment.id,
        createdAt: new Date().toISOString()
      };

      const updatedUploads = [...(currentEpisode.uploads || []), newUpload];
      
      const updatedAssignments = currentEpisode.assignments?.map(a => 
        a.id === assignment.id ? { ...a, status: 'RECORDED' } : a
      ) || [];

      // Check if all assignments are recorded or approved
      const allRecorded = updatedAssignments.every(a => 
        a.status === 'RECORDED' || a.status === 'APPROVED'
      );
      
      let newStatus = currentEpisode.status;
      if (allRecorded && currentEpisode.status === 'FIXES') {
        newStatus = 'QA';
      }
      
      await ipcRenderer.invoke('save-episode', { 
        ...currentEpisode, 
        uploads: updatedUploads,
        assignments: updatedAssignments,
        status: newStatus
      });
      
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
                  {STATUS_MAP[track.status] || track.status}
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
                    onTimeUpdate={(e) => {
                      // If video is master, sync others
                      if (!wavesurferRef.current?.isPlaying()) {
                        setCurrentTime(e.currentTarget.currentTime);
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-4">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={handleStop} 
                        className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md text-white transition-all"
                        title="Стоп"
                      >
                        <X className="w-6 h-6" />
                      </button>
                      <button 
                        onClick={togglePlay} 
                        className="p-6 bg-blue-600 hover:bg-blue-500 rounded-full shadow-xl shadow-blue-500/40 text-white transition-all transform hover:scale-110"
                        title={isPlaying ? "Пауза" : "Играть"}
                      >
                        {isPlaying ? <Pause className="w-10 h-10" /> : <Play className="w-10 h-10 fill-current ml-1" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 bg-black/60 px-4 py-2 rounded-full backdrop-blur-md">
                      <Clock className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-mono text-white">
                        {new Date(currentTime * 1000).toISOString().substr(14, 5)}
                      </span>
                    </div>
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
                        <button 
                          onClick={() => setIsMuted(!isMuted)}
                          className={`p-1 rounded ${isMuted ? 'text-red-500 bg-red-500/10' : 'text-neutral-500 hover:text-white'}`}
                          title="Приглушить фон"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <span className="text-[10px] text-neutral-500 w-8">ДАБ</span>
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
                        <span className="text-[10px] text-neutral-500 w-8">РАВ</span>
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
                        <div key={comment.id} className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/50 group/comment">
                          <div className="flex justify-between items-start mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-blue-400 uppercase">{comment.author}</span>
                              <span className="text-[10px] text-neutral-500">{new Date(comment.timestamp * 1000).toISOString().substr(14, 5)}</span>
                            </div>
                            <button 
                              onClick={() => handleDeleteComment(selectedTrack.id, comment.id)}
                              className="opacity-0 group-hover/comment:opacity-100 p-1 hover:text-red-400 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
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
                    <div className="flex flex-col">
                      <div className="text-2xl font-mono text-white">
                        {new Date(currentTime * 1000).toISOString().substr(14, 5)}
                        <span className="text-neutral-600"> / {new Date(duration * 1000).toISOString().substr(14, 5)}</span>
                      </div>
                      {currentCharacter && (
                        <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1">
                          <User className="w-3 h-3" />
                          Сейчас говорит: {currentCharacter}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newComment}
                      onChange={(e) => {
                        setNewComment(e.target.value);
                        if (isPlaying && e.target.value.length === 1) {
                          togglePlay(); // Auto-pause when starting to type
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddComment();
                        if (e.key === ' ') {
                          e.stopPropagation(); // Prevent space from toggling play when typing
                        }
                      }}
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
