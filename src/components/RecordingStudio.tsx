import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Save, Play, Pause, Video, CheckCircle2, ChevronRight, User } from 'lucide-react';
import { getParticipants } from '../services/dbService';
import { Participant, Episode, RoleAssignment } from '../types';

interface RecordingStudioProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function RecordingStudio({ currentEpisode, onRefresh }: RecordingStudioProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<RoleAssignment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  useEffect(() => {
    if (currentEpisode?.assignments && currentEpisode.assignments.length > 0 && !selectedAssignment) {
      setSelectedAssignment(currentEpisode.assignments[0]);
    }
  }, [currentEpisode, selectedAssignment]);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setAudioBlob(null);
      setStatus('Идет запись...');
    } catch (err) {
      console.error('Ошибка доступа к микрофону:', err);
      setStatus('Ошибка: нет доступа к микрофону');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus('Запись завершена');
    }
  };

  const handleSave = async () => {
    if (!audioBlob || !selectedAssignment || !currentEpisode) return;
    
    setIsUploading(true);
    setStatus('Загрузка записи на сервер...');
    
    try {
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(audioBlob);
      });

      const nickname = participants.find(p => p.id === selectedAssignment.dubberId)?.nickname || 'Unknown';
      const subDir = `${currentEpisode.project?.title}/Episode_${currentEpisode.number}/Recordings/${nickname}`;
      const fileName = `${selectedAssignment.characterName}_${Date.now()}.webm`;
      
      // 1. Save file via IPC
      const saveResponse = await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'save-file',
          args: [fileName, base64Audio, subDir]
        }),
      });
      
      const saveResult = await saveResponse.json();
      if (!saveResult.success) throw new Error('Failed to save file');

      // 2. Create UploadedFile record in DB
      const uploadResponse = await fetch(`/api/episodes/${currentEpisode.id}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'DUBBER_FILE',
          path: saveResult.data.url,
          uploadedById: selectedAssignment.dubberId,
          assignmentId: selectedAssignment.id
        }),
      });

      if (!uploadResponse.ok) throw new Error('Failed to create DB record');

      // 3. Update assignment status to RECORDED
      await fetch(`/api/assignments/${selectedAssignment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECORDED' }),
      });

      // 4. Check if all assignments are recorded, then update episode status to QA
      const allRecorded = currentEpisode.assignments?.every(a => 
        a.id === selectedAssignment.id ? true : a.status === 'RECORDED' || a.status === 'APPROVED'
      ) || false;
      
      if (allRecorded) {
        await fetch(`/api/episodes/${currentEpisode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'QA' }),
        });
      }

      setStatus('Запись успешно сохранена!');
      setAudioBlob(null);
      onRefresh();
    } catch (error) {
      console.error('Upload error:', error);
      setStatus('Ошибка при сохранении записи');
    } finally {
      setIsUploading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex gap-6 h-full w-full max-w-[1600px] mx-auto p-6">
      
      {/* Левая колонка: Список персонажей */}
      <div className="w-64 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl flex flex-col shrink-0 overflow-hidden">
        <div className="p-4 border-b border-neutral-800 bg-neutral-950/50">
          <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Персонажи</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {currentEpisode?.assignments?.map(assignment => (
            <button
              key={assignment.id}
              onClick={() => setSelectedAssignment(assignment)}
              className={`w-full text-left p-3 rounded-lg transition-all flex items-center justify-between group ${
                selectedAssignment?.id === assignment.id 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
              }`}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{assignment.characterName}</span>
                <span className={`text-xs ${selectedAssignment?.id === assignment.id ? 'text-indigo-200' : 'text-neutral-500'}`}>
                  {participants.find(p => p.id === assignment.dubberId)?.nickname || '...'}
                </span>
              </div>
              <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${selectedAssignment?.id === assignment.id ? 'translate-x-1' : 'opacity-0 group-hover:opacity-100'}`} />
            </button>
          ))}
          {(!currentEpisode?.assignments || currentEpisode.assignments.length === 0) && (
            <div className="p-4 text-center text-neutral-500 text-sm italic">
              Роли не распределены
            </div>
          )}
        </div>
      </div>

      {/* Центральная колонка: Рабочая зона */}
      <div className="flex-1 flex flex-col gap-6 min-w-0">
        
        {/* Видеоплеер */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-xl flex flex-col relative aspect-video">
          {!currentEpisode?.rawPath && !isVideoLoaded ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/80">
              <Video className="w-16 h-16 text-neutral-700 mb-4" />
              <p className="text-neutral-400 mb-4">Видео не загружено</p>
              <button 
                onClick={() => setIsVideoLoaded(true)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors border border-neutral-700"
              >
                Выбрать локальный файл
              </button>
            </div>
          ) : (
            <div className="absolute inset-0 bg-black flex items-center justify-center">
              {currentEpisode?.rawPath ? (
                <video 
                  src={currentEpisode.rawPath} 
                  className="w-full h-full object-contain"
                  controls={isPlaying}
                />
              ) : (
                <div className="text-neutral-600 font-mono text-2xl opacity-50">
                  [ ВОСПРОИЗВЕДЕНИЕ ВИДЕО ]
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-4">
                <button onClick={() => setIsPlaying(!isPlaying)} className="text-white hover:text-indigo-400 transition-colors">
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                </button>
                <div className="flex-1 h-1.5 bg-neutral-600 rounded-full overflow-hidden cursor-pointer">
                  <div className="h-full bg-indigo-500 w-1/3"></div>
                </div>
                <span className="text-white text-sm font-mono">00:01:23 / 00:24:00</span>
              </div>
            </div>
          )}
        </div>

        {/* Инфо и запись */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center">
                <User className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">
                  {selectedAssignment?.characterName || 'Выберите персонажа'}
                </h3>
                <p className="text-neutral-400 text-sm">
                  Даббер: {participants.find(p => p.id === selectedAssignment?.dubberId)?.nickname || '...'}
                </p>
              </div>
            </div>
            
            {status && (
              <div className="px-4 py-2 bg-neutral-800 rounded-lg border border-neutral-700 text-sm text-neutral-300">
                {status}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
            <div className="flex items-center gap-6">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={!selectedAssignment}
                  className="w-16 h-16 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white rounded-full flex items-center justify-center transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:shadow-[0_0_30px_rgba(239,68,68,0.5)]"
                >
                  <Mic className="w-8 h-8" />
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="w-16 h-16 bg-neutral-800 hover:bg-neutral-700 text-red-500 rounded-full flex items-center justify-center transition-all border border-red-500/30"
                >
                  <Square className="w-6 h-6 fill-current" />
                </button>
              )}

              <div className="flex flex-col">
                <span className="text-sm text-neutral-400 mb-1">
                  {isRecording ? 'Идет запись...' : 'Готов к записи'}
                </span>
                <span className={`text-3xl font-mono font-bold ${isRecording ? 'text-red-500' : 'text-white'}`}>
                  {formatTime(recordingTime)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {audioBlob && !isRecording && (
                <div className="flex items-center gap-3 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Тейк записан</span>
                </div>
              )}
              
              <button
                onClick={handleSave}
                disabled={!audioBlob || isRecording || isUploading}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/20"
              >
                <Save className="w-5 h-5" />
                {isUploading ? 'Загрузка...' : 'Сохранить тейк'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
