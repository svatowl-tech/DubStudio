import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, CheckCircle, XCircle, AlertCircle, MessageSquare, Volume2, Check, X, Activity, User, Clock, FileAudio, Send, Video, Trash2, Mic, Sparkles, Save, SkipForward, Scissors, Zap, VolumeX, Volume1 } from 'lucide-react';
import { ipcSafe } from '../lib/ipcSafe';
import { Episode, RoleAssignment, Participant } from '../types';
import { sanitizeFolderName } from '../lib/pathUtils';
import { TrackWaveform } from './qa/TrackWaveform';
import { TrackSidebar } from './qa/TrackSidebar';
import { generateFixesIssuedMessage, generateStatusMessage } from '../lib/templates';
import { getParticipants } from '../services/dbService';
import { ExportModal } from './ExportModal';
import { useVideoContext } from '../contexts/VideoContext';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

interface QAPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface Track {
  id: string;
  participant: string;
  character: string;
  status: 'pending' | 'approved' | 'rejected' | 'fixes_needed';
  files: { id: string; path: string; createdAt: string; type?: 'DUBBER_FILE' | 'FIXES' }[];
  selectedFileId?: string;
  comments: Comment[];
}

interface Comment {
  id: string;
  text: string;
  timestamp: number;
  author: string;
  subId?: string; // Link to .ass line ID/index
}

export default function QAPanel({ currentEpisode, onRefresh }: QAPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [soloTrack, setSoloTrack] = useState<string | null>(null);
  const [commentModal, setCommentModal] = useState<{ isOpen: boolean, region: any } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [subLines, setSubLines] = useState<any[]>([]);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [currentDubberNickname, setCurrentDubberNickname] = useState<string | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBaking, setIsBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeStatus, setBakeStatus] = useState('');
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false);
  const [silenceThreshold, setSilenceThreshold] = useState(0.01); // Default threshold
  const [currentSubId, setCurrentSubId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const { registerPlayer, unregisterPlayer } = useVideoContext();

  useEffect(() => {
    loadParticipants();
  }, []);

  const loadParticipants = async () => {
    const p = await getParticipants();
    setParticipants(p);
  };

  const parseAssTime = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const [audioRefsUpdated, setAudioRefsUpdated] = useState(0);
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
  }, [isPlaying, audioRefsUpdated]);

  // Update audio volumes
  useEffect(() => {
    console.log('Updating audio volumes', { volumes, isMuted, selectedTrackId, audioRefs: Object.keys(audioRefs.current) });
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (audio instanceof HTMLAudioElement) {
        const volume = isMuted ? 0 : (volumes[id] ?? 0.8);
        console.log(`Setting volume for ${id} to ${volume}`);
        audio.volume = volume;
      }
    });
    if (wavesurferRef.current && selectedTrackId) {
      const volume = isMuted ? 0 : (volumes[selectedTrackId] ?? 0.8);
      console.log(`Setting wavesurfer volume to ${volume}`);
      wavesurferRef.current.setVolume(volume);
    }
  }, [volumes, isMuted, selectedTrackId, audioRefsUpdated]);

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
      setAudioRefsUpdated(prev => prev + 1);
    };
  }, [currentEpisode?.id]);

  // Initialize audio elements for all tracks (except selected one which is handled by WaveSurfer)
  useEffect(() => {
    if (!currentEpisode) return;
    
    let updated = false;
    tracks.forEach(track => {
      // If we are viewing a specific track, we ONLY want to hear that track (via wavesurfer)
      // So we should not create/play audio elements for other tracks unless we are in 'all' mode
      if (selectedTrackId !== 'all' || track.id === selectedTrackId) {
        // If it was previously in audioRefs, remove it
        if (audioRefs.current[track.id]) {
          audioRefs.current[track.id].pause();
          delete audioRefs.current[track.id];
          updated = true;
        }
        return;
      }

      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      if (selectedFile && selectedFile.path && !audioRefs.current[track.id]) {
        const audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        const audio = new Audio(audioUrl);
        audio.volume = volumes[track.id] ?? 0.8;
        audioRefs.current[track.id] = audio;
        updated = true;
      } else if (selectedFile && selectedFile.path && audioRefs.current[track.id]) {
        const audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        // Update source if it changed
        if (audioRefs.current[track.id].src !== audioUrl) {
          audioRefs.current[track.id].src = audioUrl;
          updated = true;
        }
      }
    });
    if (updated) setAudioRefsUpdated(prev => prev + 1);
  }, [tracks, currentEpisode, selectedTrackId]);

  // Map assignments to tracks (grouped by dubber)
  useEffect(() => {
    if (!currentEpisode) return;
    
    const dubberTracks: Record<string, Track> = {};
    
    currentEpisode.assignments?.forEach(as => {
      const dubberId = as.dubberId;
      const dubberName = as.dubber?.nickname || 'Неизвестно';
      
    // Find ALL DUBBER_FILEs and FIXES for this dubber in this episode
    const dubberFiles = currentEpisode.uploads?.filter(u => 
      (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
      (u.assignmentId === as.id || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.dubberId === dubberId)
    ).map(u => ({ id: u.id, path: u.path, createdAt: u.createdAt, type: u.type })) || [];
      
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
          files: dubberFiles,
          selectedFileId: dubberFiles.length > 0 ? dubberFiles[0].id : undefined,
          comments
        };
      } else {
        // Append character name if multiple
        if (!dubberTracks[dubberId].character.includes(as.characterName)) {
          dubberTracks[dubberId].character += `, ${as.characterName}`;
        }
        // Merge files (avoid duplicates)
        dubberFiles.forEach(f => {
          if (!dubberTracks[dubberId].files.find(existing => existing.id === f.id)) {
            dubberTracks[dubberId].files.push(f);
          }
        });
        // Merge comments
        dubberTracks[dubberId].comments = [...dubberTracks[dubberId].comments, ...comments];
      }
    });
    
    const mappedTracks = Object.values(dubberTracks);
    
    // Add original track
    const originalTrack: Track = {
      id: 'original',
      participant: 'Оригинал',
      character: 'Оригинал',
      status: 'approved',
      files: [{ id: 'orig', path: currentEpisode.rawPath, createdAt: '', type: 'DUBBER_FILE' }],
      selectedFileId: 'orig',
      comments: []
    };
    
    setTracks([originalTrack, ...mappedTracks]);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode]);

  // Load subtitles for auto-detection
  useEffect(() => {
    const loadSubs = async () => {
      if (currentEpisode?.subPath) {
        try {
          const res = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
          if (res && res.lines) {
            const processedLines = res.lines.map((l: any) => ({
              ...l,
              startSec: typeof l.start === 'number' ? l.start : parseAssTime(l.start || ''),
              endSec: typeof l.end === 'number' ? l.end : parseAssTime(l.end || '')
            })).sort((a: any, b: any) => a.startSec - b.startSec);
            setSubLines(processedLines);
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
    if (subLines.length === 0) return;

    // subLines is already sorted by startSec
    let lastStartedSub = null;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (currentTime >= subLines[i].startSec) {
        lastStartedSub = subLines[i];
        break;
      }
    }

    if (lastStartedSub) {
      const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
      const mainName = aliases[lastStartedSub.name] || lastStartedSub.name;
      setCurrentCharacter(mainName);
      setCurrentSubId(lastStartedSub.id || lastStartedSub.index?.toString() || null);
      
      // Find dubber nickname for this character
      const assignment = currentEpisode?.assignments?.find(a => a.characterName.toLowerCase() === mainName.toLowerCase());
      if (assignment) {
        setCurrentDubberNickname(assignment.dubber?.nickname || null);
      } else {
        setCurrentDubberNickname(null);
      }

      // Only show text if we are within the subtitle duration
      if (currentTime <= lastStartedSub.endSec) {
        setCurrentSubtitleText(lastStartedSub.text);
      } else {
        setCurrentSubtitleText(null);
      }
    } else {
      setCurrentCharacter(null);
      setCurrentDubberNickname(null);
      setCurrentSubtitleText(null);
    }
  }, [currentTime, subLines, currentEpisode?.project?.characterAliases, currentEpisode?.assignments]);

  const selectedTrack = tracks.find(t => t.id === selectedTrackId);

  const togglePlay = useCallback(() => {
    const newPlaying = !isPlaying;
    setIsPlaying(newPlaying);
    
    const time = wavesurferRef.current?.getCurrentTime() || 0;

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
          audio.currentTime = time;
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
    });
  }, [isPlaying]);

  const seekToNext = useCallback(() => {
    if (subLines.length === 0) return;

    const nextSub = subLines.find(l => {
      return l.startSec > currentTime + 0.1; // Add a small buffer
    });

    if (nextSub) {
      const nextTime = nextSub.startSec;
      
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(nextTime);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime;
      }
      setCurrentTime(nextTime);
    }
  }, [subLines, currentTime]);

  useEffect(() => {
    registerPlayer({ togglePlayPause: togglePlay, seekToNext });
    return () => unregisterPlayer();
  }, [registerPlayer, unregisterPlayer, togglePlay, seekToNext]);

  const handleAddComment = useCallback(async (textOverride?: string) => {
    const commentText = textOverride || newComment;
    if (!commentText.trim() || !currentEpisode) return;

    // Use selected track if available, otherwise try to auto-detect
    let targetTrackId = selectedTrackId === 'all' ? null : selectedTrackId;
    
    // If we have a detected character, we can use it to find the specific assignment
    // but we should stay on the selected track if it's one of the dubber's roles
    const dubberAssignments = targetTrackId ? (currentEpisode.assignments?.filter(a => a.dubberId === targetTrackId) || []) : [];
    const matchingAssignment = dubberAssignments.find(
      a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
    );

    // If no track selected or 'all' selected, try to auto-detect from character
    if (!targetTrackId && currentCharacter) {
      const autoAssignment = currentEpisode.assignments?.find(
        a => a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      );
      if (autoAssignment) {
        targetTrackId = autoAssignment.dubberId;
      }
    }

    if (!targetTrackId) {
      // Fallback: if we have tracks, use the first one
      if (tracks.length > 0) {
        targetTrackId = tracks[0].id;
      } else {
        alert("Не удалось определить дабера для фикса. Выберите дорожку вручную.");
        return;
      }
    }

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      text: commentText,
      timestamp: currentTime,
      author: 'Куратор',
      subId: currentSubId || undefined
    };

    // Update local state immediately for responsiveness
    const updatedTracks = tracks.map(t => 
      t.id === targetTrackId ? { 
        ...t, 
        comments: [...t.comments, comment],
        status: 'fixes_needed' as const
      } : t
    );
    
    setTracks(updatedTracks);
    if (!textOverride) setNewComment('');

    // Save to DB
    try {
      // Determine which assignment to attach the comment to
      // If the dubber has multiple roles, we try to match the current character,
      // otherwise we use the first assignment of that dubber.
      const targetDubberAssignments = currentEpisode.assignments?.filter(a => a.dubberId === targetTrackId) || [];
      const bestAssignmentMatch = targetDubberAssignments.find(
        a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      ) || targetDubberAssignments[0];

      if (!bestAssignmentMatch) return;

      const updatedAssignments = currentEpisode.assignments?.map(a => {
        if (a.id === bestAssignmentMatch.id) {
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

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });
      onRefresh();
    } catch (error) {
      console.error('Save comment error:', error);
    }
  }, [newComment, currentEpisode, selectedTrackId, tracks, currentCharacter, currentTime, currentSubId, onRefresh]);

  const detectSilence = async () => {
    if (!wavesurferRef.current || !regionsRef.current) return;
    
    setIsAnalyzingSilence(true);
    regionsRef.current.clearRegions();
    
    try {
      const buffer = wavesurferRef.current.getDecodedData();
      if (!buffer) return;
      
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const silenceRegions: { start: number; end: number }[] = [];
      
      let isSilence = false;
      let silenceStart = 0;
      
      // Analyze in chunks for performance
      const chunkSize = Math.floor(sampleRate * 0.1); // 100ms chunks
      for (let i = 0; i < channelData.length; i += chunkSize) {
        let maxAmp = 0;
        for (let j = 0; j < chunkSize && i + j < channelData.length; j++) {
          maxAmp = Math.max(maxAmp, Math.abs(channelData[i + j]));
        }
        
        const time = i / sampleRate;
        
        if (maxAmp < silenceThreshold) {
          if (!isSilence) {
            isSilence = true;
            silenceStart = time;
          }
        } else {
          if (isSilence) {
            isSilence = false;
            // Only count as silence if it's longer than 0.5s
            if (time - silenceStart > 0.5) {
              silenceRegions.push({ start: silenceStart, end: time });
            }
          }
        }
      }
      
      // Add regions to wavesurfer
      silenceRegions.forEach(region => {
        regionsRef.current.addRegion({
          start: region.start,
          end: region.end,
          color: 'rgba(255, 0, 0, 0.2)',
          drag: false,
          resize: false,
          content: 'Silence'
        });
      });
      
    } catch (e) {
      console.error('Silence detection error', e);
    } finally {
      setIsAnalyzingSilence(false);
    }
  };

  // Hotkeys for instant edit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key.toLowerCase() === 'f') { // 'F' for Fix
        e.preventDefault();
        const text = currentSubtitleText ? `Правка: ${currentSubtitleText}` : 'Правка';
        handleAddComment(text);
      }
      
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, currentSubtitleText, currentSubId, togglePlay, handleAddComment]);

  // Sync wavesurfer with video when scrubbing
  useEffect(() => {
    if (!wavesurferRef.current || isPlaying) return;
    
    const wsTime = wavesurferRef.current.getCurrentTime();
    if (Math.abs(wsTime - currentTime) > 0.05) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  const handlePause = () => {
    setIsPlaying(false);
    if (wavesurferRef.current) wavesurferRef.current.pause();
    if (videoRef.current) videoRef.current.pause();
    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) audio.pause();
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

  const handleGenerateFixesMessage = () => {
    if (!currentEpisode) return;
    const msg = generateFixesIssuedMessage(currentEpisode, participants);
    if (msg) {
      setGeneratedMessage(msg);
      setIsMessageModalOpen(true);
    } else {
      setGeneratedMessage(`✏️ ВЫПИСАНЫ ФИКСЫ: ${currentEpisode.project?.title}\n👾 Серия: ${currentEpisode.number}\n\n✅ Фиксов не обнаружено! Все даберы молодцы! ✨`);
      setIsMessageModalOpen(true);
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    const msg = generateStatusMessage(currentEpisode, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  };

  const handleExportSoundEngineer = async (targetDir: string, skipConversion: boolean, smartExport?: boolean) => {
    if (!currentEpisode) return;
    setIsUploading(true);
    const res = await ipcSafe.invoke('export-sound-engineer-files', { episode: currentEpisode, targetDir, skipConversion, smartExport });
    setIsUploading(false);
    setIsExportModalOpen(false);
    if (res.success) {
      alert('Экспорт для звукорежиссера успешно завершен!');
    } else {
      alert('Ошибка экспорта: ' + res.error);
    }
  };

  const handleBakeSubtitles = async () => {
    if (!currentEpisode) return;
    setIsBaking(true);
    setBakeProgress(0);
    setBakeStatus('Запуск FFmpeg...');
    
    let removeListener: (() => void) | undefined;
    removeListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      setBakeProgress(percent);
      setBakeStatus(`Рендеринг: ${percent}%`);
    });

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      await ipcSafe.invoke('bake-subtitles', {
        videoPath: currentEpisode.rawPath, 
        finalAssPath: currentEpisode.subPath, 
        outputPath: `${subDir}/final_release.mp4`
      });
      
      setBakeStatus('Видео успешно отрендерено!');
      setBakeProgress(100);
    } catch (err: any) {
      setBakeStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsBaking(false);
      if (removeListener) removeListener();
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

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments 
      });
      onRefresh();
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

      await ipcSafe.invoke('save-episode', { 
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
        a.dubberId === id ? { ...a, status: dbStatus } : a
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

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: newStatus
      });

      onRefresh();
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const handleFileUpload = async (e: any, trackId: string, type: 'DUBBER_FILE' | 'FIXES' = 'DUBBER_FILE') => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    // Find one of the assignments for this dubber to link the upload to
    const assignment = currentEpisode.assignments?.find(a => a.dubberId === trackId);
    if (!assignment) return;

    const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
    const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
    const subDir = `${projectTitle}/${episodeFolder}/${type === 'FIXES' ? 'Fixes' : 'QAFixes'}`;
    const prefix = type === 'FIXES' ? 'fix' : 'dub';
    const fileName = `${prefix}_${assignment.id}_${Date.now()}.${file.name.split('.').pop() || 'wav'}`;
    
    try {
      let res;
      if (file.path) {
        res = await ipcSafe.invoke('copy-file', {
          sourcePath: file.path,
          targetDir: subDir,
          fileName
        });
      } else {
        // Browser fallback: read as buffer to avoid "src argument must be string" error
        const buffer = await file.arrayBuffer();
        res = await ipcSafe.invoke('save-file-buffer', {
          buffer,
          targetDir: subDir,
          fileName
        });
      }
      
      if (!res.success) throw new Error(res.error);
      
      const newUpload = {
        id: Math.random().toString(36).substr(2, 9),
        episodeId: currentEpisode.id,
        type,
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
      
      await ipcSafe.invoke('save-episode', { 
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
    <>
    <div className="flex h-full bg-neutral-950 overflow-hidden w-full">
        <TrackSidebar 
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          setSelectedTrackId={setSelectedTrackId}
          handleApproveAll={handleApproveAll}
          handleFileUpload={handleFileUpload}
          setTracks={setTracks}
          onGenerateFixesMessage={handleGenerateFixesMessage}
          onGenerateReminderMessage={handleGenerateReminderMessage}
          onExportSoundEngineer={() => setIsExportModalOpen(true)}
          onBakeSubtitles={handleBakeSubtitles}
          isBaking={isBaking}
          bakeProgress={bakeProgress}
          bakeStatus={bakeStatus}
        />

      {/* Main Content - Player & Comments */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTrackId === 'all' ? (
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-6">
            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group max-h-[50vh] mx-auto w-full">
              <video 
                ref={videoRef}
                src={currentEpisode.rawPath || undefined}
                className="w-full h-full object-contain"
                onTimeUpdate={(e) => {
                  setCurrentTime(e.currentTarget.currentTime);
                }}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                }}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <div className="flex flex-col gap-2 w-full">
                  <input 
                    type="range" 
                    min={0} 
                    max={duration || 100} 
                    value={currentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value);
                      setCurrentTime(time);
                      if (videoRef.current) videoRef.current.currentTime = time;
                      Object.values(audioRefs.current).forEach(audio => {
                        if (audio instanceof HTMLAudioElement) audio.currentTime = time;
                      });
                    }}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={togglePlay} 
                        className="p-2 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-all"
                        title={isPlaying ? "Пауза" : "Играть"}
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                      </button>
                      <button 
                        onClick={seekToNext} 
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                        title="К следующей реплике (Стрелка вправо)"
                      >
                        <SkipForward className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleStop} 
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                        title="Стоп"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
                      <Clock className="w-3 h-3 text-blue-400" />
                      <span className="text-xs font-mono text-white">
                        {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex-1 flex flex-col min-h-0">
              <h3 className="text-lg font-bold text-white mb-4 shrink-0">Громкость даберов</h3>
              <div className="space-y-4 overflow-y-auto pr-2 shrink-0 max-h-[40%]">
                <div className="flex items-center gap-4 p-3 bg-neutral-800/50 rounded-lg">
                  <Volume2 className="w-5 h-5 text-neutral-400" />
                  <div className="w-32 text-sm font-medium text-white">Оригинал (РАВ)</div>
                  <input 
                    type="range" min="0" max="1" step="0.1" value={originalVolume} 
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setOriginalVolume(v);
                      if (videoRef.current) videoRef.current.volume = v;
                    }}
                    className="flex-1 accent-neutral-500"
                  />
                  <span className="text-xs text-neutral-500 w-8 text-right">{Math.round(originalVolume * 100)}%</span>
                </div>

                {tracks.map(track => (
                  <div key={track.id} className="flex items-center gap-4 p-3 bg-neutral-800/50 rounded-lg">
                    <Volume2 className="w-5 h-5 text-blue-400" />
                    <div className="w-32">
                      <div className="text-sm font-medium text-white truncate">{track.participant}</div>
                      <div className="text-xs text-neutral-500 truncate">{track.character}</div>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.1" value={volumes[track.id] ?? 0.8} 
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setVolumes(prev => ({ ...prev, [track.id]: v }));
                      }}
                      className="flex-1 accent-blue-500"
                    />
                    <span className="text-xs text-neutral-500 w-8 text-right">{Math.round((volumes[track.id] ?? 0.8) * 100)}%</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t border-neutral-800 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <div className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${currentCharacter ? 'text-blue-400' : 'text-neutral-500'}`}>
                      <User className="w-4 h-4" />
                      {currentCharacter ? (
                        <span>
                          {currentDubberNickname ? `${currentDubberNickname} (${currentCharacter})` : currentCharacter}
                        </span>
                      ) : 'Никто не говорит'}
                    </div>
                    {currentSubtitleText && (
                      <div className="text-xs text-neutral-400 italic mt-1 line-clamp-1">
                        "{currentSubtitleText}"
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newComment}
                      onChange={(e) => {
                        setNewComment(e.target.value);
                        if (isPlaying && e.target.value.length > 0) {
                          handlePause(); // Auto-pause when typing
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
                      onClick={() => handleAddComment()}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-bold"
                    >
                      Отправить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : selectedTrack ? (
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
                      <button 
                        onClick={seekToNext} 
                        className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md text-white transition-all"
                        title="К следующей реплике (Стрелка вправо)"
                      >
                        <SkipForward className="w-6 h-6" />
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
                          onClick={detectSilence}
                          disabled={isAnalyzingSilence}
                          className={`p-2 rounded-lg transition-colors ${isAnalyzingSilence ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-800 text-neutral-400 hover:text-blue-400'}`}
                          title="Детектор тишины"
                        >
                          <Scissors className={`w-5 h-5 ${isAnalyzingSilence ? 'animate-pulse' : ''}`} />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'approved')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'approved' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-green-400'}`}
                          title="Одобрить"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'fixes_needed')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'fixes_needed' ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-yellow-400'}`}
                          title="Требуются исправления"
                        >
                          <AlertCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'rejected')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'rejected' ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-red-400'}`}
                          title="Отклонить"
                        >
                          <XCircle className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <Volume2 className="w-4 h-4 text-neutral-500" />
                        <input 
                          type="range" min="0" max="1" step="0.1" value={originalVolume} 
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setOriginalVolume(v);
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
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
                {tracks.map(track => (
                  <div key={track.id} className="bg-neutral-800/50 p-4 rounded-lg border border-neutral-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-white">{track.participant} ({track.character})</span>
                      <div className="flex gap-2">
                        <button onClick={() => setMutedTracks(prev => {
                          const next = new Set(prev);
                          if (next.has(track.id)) next.delete(track.id);
                          else next.add(track.id);
                          return next;
                        })} className={`p-1 rounded ${mutedTracks.has(track.id) ? 'text-red-500' : 'text-neutral-400'}`}>
                          {mutedTracks.has(track.id) ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                        <button onClick={() => setSoloTrack(prev => prev === track.id ? null : track.id)} className={`p-1 rounded ${soloTrack === track.id ? 'text-blue-500' : 'text-neutral-400'}`}>
                          <Activity className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <TrackWaveform 
                      track={track}
                      currentTime={currentTime}
                      isPlaying={isPlaying}
                      subLines={subLines}
                      onTimeUpdate={setCurrentTime}
                      onPlayPause={togglePlay}
                      volume={soloTrack && soloTrack !== track.id ? 0 : (mutedTracks.has(track.id) ? 0 : (volumes[track.id] ?? 0.8))}
                      isMuted={isMuted}
                      onRegionClick={(region) => {
                        setCommentModal({ isOpen: true, region });
                      }}
                    />
                  </div>
                ))}
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

      {/* Comment Modal */}
      {commentModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-700 w-96">
            <h3 className="text-white font-bold mb-4">Добавить правку</h3>
            <input 
              type="text" 
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-4 py-2 w-full mb-4"
              placeholder="Введите комментарий..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCommentModal(null)} className="text-neutral-400">Отмена</button>
              <button onClick={() => {
                handleAddComment();
                setCommentModal(null);
              }} className="bg-blue-600 text-white px-4 py-2 rounded">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {isExportModalOpen && currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role="SOUND_ENGINEER"
          onExport={handleExportSoundEngineer}
          isExporting={isUploading}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h2 className="text-xl font-semibold text-white">Сформированное сообщение</h2>
              </div>
              <button onClick={() => setIsMessageModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <pre className="bg-black/50 border border-neutral-800 rounded-xl p-6 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar">
                {generatedMessage}
              </pre>
              
              <div className="mt-6 flex gap-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedMessage);
                    alert('Скопировано в буфер обмена!');
                  }}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Save className="w-5 h-5" />
                  Скопировать текст
                </button>
                <button 
                  onClick={() => setIsMessageModalOpen(false)}
                  className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold transition-all"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Baking Progress Overlay */}
      {isBaking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-md p-8 text-center space-y-6">
            <div className="relative w-32 h-32 mx-auto">
              <div className="absolute inset-0 border-4 border-neutral-800 rounded-full" />
              <div 
                className="absolute inset-0 border-4 border-blue-500 rounded-full transition-all duration-500"
                style={{ 
                  clipPath: `inset(${100 - bakeProgress}% 0 0 0)`,
                  filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))'
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(bakeProgress)}%</span>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Рендеринг видео</h3>
              <p className="text-neutral-400 text-sm">{bakeStatus}</p>
            </div>
            <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${bakeProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
