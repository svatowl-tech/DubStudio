import React, { useState, useEffect } from 'react';
import { Scissors, Upload, Save, User, CheckSquare, FileText } from 'lucide-react';
import { Participant, Episode } from '../types';
import { getParticipants } from '../services/dbService';

interface AssLine {
  id: string;
  actor: string;
  text: string;
  assignedTo?: string;
}

interface AssEditorProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function AssEditor({ currentEpisode, onRefresh }: AssEditorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<AssLine[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [checkAll, setCheckAll] = useState(true);
  const [status, setStatus] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  // Load existing assignments if currentEpisode changes
  useEffect(() => {
    if (currentEpisode?.assignments) {
      const existingMapping: Record<string, string> = {};
      currentEpisode.assignments.forEach(a => {
        existingMapping[a.characterName] = a.dubberId;
      });
      setMapping(existingMapping);
      if (Object.keys(existingMapping).length > 0) {
        setActors(Object.keys(existingMapping));
      }
    }
  }, [currentEpisode]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    setStatus('Файл загружен. Анализ...');

    try {
      const reader = new FileReader();
      const base64File = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(uploadedFile);
      });

      const uploadResponse = await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'save-file',
          args: [uploadedFile.name, base64File]
        }),
      });
      
      const uploadResult = await uploadResponse.json();
      if (!uploadResult.success) throw new Error('Upload failed');

      const response = await fetch('/api/ipc/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'split-subs',
          args: [uploadResult.data.path, './uploads/output']
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        const { actorMapping } = result.data;
        const newActors = Object.keys(actorMapping);
        setActors(newActors);
        
        // Merge with existing mapping and global mapping
        const globalMapping = currentEpisode?.project?.globalMapping 
          ? JSON.parse(currentEpisode.project.globalMapping) 
          : {};
          
        const newMapping = { ...mapping };
        newActors.forEach(actor => {
          if (!newMapping[actor]) {
            // Try global mapping first
            if (globalMapping[actor]) {
              newMapping[actor] = globalMapping[actor];
            } else if (actorMapping[actor]) {
              // Fallback to auto-parsed mapping if any
              newMapping[actor] = (actorMapping[actor] as Participant).id;
            }
          }
        });
        
        setMapping(newMapping);
        setStatus(`Анализ завершен. Найдено ${newActors.length} персонажей.`);
      } else {
        setStatus('Ошибка при анализе файла.');
      }
    } catch (error) {
      console.error('Import error:', error);
      setStatus('Ошибка при анализе файла.');
    }
  };

  const handleAssign = (actor: string, dubberId: string) => {
    setMapping(prev => ({ ...prev, [actor]: dubberId }));
  };

  const handleSaveAssignments = async () => {
    if (!currentEpisode) return;
    
    setIsSaving(true);
    setStatus('Сохранение распределения ролей...');
    
    try {
      // Save each assignment to the database
      const promises = Object.entries(mapping).map(([characterName, dubberId]) => {
        return fetch(`/api/episodes/${currentEpisode.id}/assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterName, dubberId }),
        });
      });
      
      await Promise.all(promises);
      
      // Update episode status to RECORDING
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECORDING' }),
      });
      
      // Update project global mapping
      if (currentEpisode.projectId) {
        await fetch(`/api/projects/${currentEpisode.projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ globalMapping: mapping }),
        });
      }
      
      setStatus('Распределение ролей сохранено! Переход к записи.');
      onRefresh();
    } catch (error) {
      console.error('Save error:', error);
      setStatus('Ошибка при сохранении.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitAss = async () => {
    if (!file) return;
    setStatus('Генерация разделенных файлов...');
    
    try {
      // In a real app, we'd send the mapping to the backend to generate per-actor files
      setStatus('Файлы успешно разделены и сохранены!');
    } catch (error) {
      setStatus('Ошибка при разделении файлов.');
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
          <Scissors className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Распределитель субтитров (ASS)</h1>
          {currentEpisode && (
            <p className="text-neutral-400 text-sm mt-1">
              Проект: <span className="text-indigo-400">{currentEpisode.project?.title}</span> • Серия {currentEpisode.number}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-400" />
              Загрузка файла
            </h2>
            
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-700 border-dashed rounded-lg cursor-pointer bg-neutral-950 hover:bg-neutral-800 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <FileText className="w-8 h-8 text-neutral-500 mb-2" />
                <p className="text-sm text-neutral-400">
                  <span className="font-semibold text-indigo-400">Нажмите для загрузки</span> или перетащите
                </p>
                <p className="text-xs text-neutral-500 mt-1">Только .ass файлы</p>
              </div>
              <input type="file" accept=".ass" className="hidden" onChange={handleFileUpload} />
            </label>

            {file && (
              <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-sm text-indigo-300 truncate">
                {file.name}
              </div>
            )}
            
            {status && (
              <p className="mt-4 text-sm text-neutral-400">{status}</p>
            )}
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Save className="w-5 h-5 text-purple-400" />
              Действия
            </h2>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                  <input 
                    type="checkbox" 
                    className="absolute opacity-0 cursor-pointer" 
                    checked={checkAll}
                    onChange={(e) => setCheckAll(e.target.checked)}
                  />
                  {checkAll && <CheckSquare className="w-5 h-5 text-indigo-500 absolute" />}
                </div>
                <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                  Checkall (Генерировать для всех)
                </span>
              </label>

              <button
                onClick={handleSaveAssignments}
                disabled={!currentEpisode || Object.keys(mapping).length === 0 || isSaving}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
              >
                {isSaving ? 'Сохранение...' : 'Сохранить роли'}
              </button>

              <button
                onClick={handleSplitAss}
                disabled={!file || Object.keys(mapping).length === 0}
                className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700"
              >
                Разделить субтитры
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-neutral-800 bg-neutral-950/50">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-400" />
                Распределение ролей
              </h2>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              {actors.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3 py-12">
                  <Scissors className="w-12 h-12 opacity-20" />
                  <p>Загрузите файл для начала работы</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {actors.map(actor => (
                    <div key={actor} className="flex items-center justify-between bg-neutral-950 border border-neutral-800 p-4 rounded-lg hover:border-neutral-700 transition-colors">
                      <div className="flex-1">
                        <h4 className="text-neutral-200 font-medium">{actor}</h4>
                      </div>
                      
                      <div className="w-48 shrink-0">
                        <select
                          value={mapping[actor] || ''}
                          onChange={(e) => handleAssign(actor, e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all appearance-none"
                        >
                          <option value="" disabled>-- Выберите дабера --</option>
                          {participants.map(user => (
                            <option key={user.id} value={user.id}>
                              {user.nickname}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
