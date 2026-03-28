import React, { useState, useEffect } from "react";
import {
  Scissors,
  Upload,
  Save,
  User,
  CheckSquare,
  FileText,
  Edit3,
  Download,
  FileUp,
  Languages,
  Trash2,
} from "lucide-react";
import { Participant, Episode, RoleAssignment } from "../types";
import { getParticipants } from "../services/dbService";
import RawSubtitleEditor from "./RawSubtitleEditor";
import { exportMappingToJson, importMappingFromJson } from "../lib/mappingExport";
import { ipcRenderer } from "../lib/ipc";
import { latinToCyrillic, polivanovToHepburn } from "../lib/translit";

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

export default function AssEditor({
  currentEpisode,
  onRefresh,
}: AssEditorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<AssLine[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [checkAll, setCheckAll] = useState(true);
  const [status, setStatus] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"roles" | "raw">("roles");
  const lastAnalyzedEpisodeId = React.useRef<string | null>(null);

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const saveToDatabase = async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode) return;
    
    try {
      const cleanAssignments = currentAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };
      
      await ipcRenderer.invoke('save-episode', updatedEpisode);
      
      // Also update global mapping if needed
      if (currentEpisode.projectId && currentEpisode.project) {
        const mapping = currentAssignments.reduce((acc, a) => {
          if (a.dubberId) acc[a.characterName] = a.dubberId;
          return acc;
        }, {} as Record<string, string>);
        
        const updatedProject = {
          ...currentEpisode.project,
          globalMapping: JSON.stringify(mapping)
        };
        await ipcRenderer.invoke('save-project', updatedProject);
      }
      
      onRefresh();
    } catch (error) {
      console.error("Auto-save error:", error);
    }
  };

  const handleAnalyzeExisting = async () => {
    if (!currentEpisode?.subPath) return;
    
    // Prevent redundant analysis for the same episode if we already have assignments
    if (lastAnalyzedEpisodeId.current === currentEpisode.id && assignments.length > 0) {
      return;
    }

    setStatus("Анализ существующих субтитров...");
    try {
      const result = await ipcRenderer.invoke('get-raw-subtitles', currentEpisode.subPath);
      
      if (result && result.actors) {
        const newActors = result.actors;
        setActors(newActors);

        const globalMapping = currentEpisode?.project?.globalMapping
          ? JSON.parse(currentEpisode.project.globalMapping)
          : {};

        setAssignments(prev => {
          const existingNames = new Set(prev.map(a => a.characterName));
          const toAdd = newActors.filter((name: string) => !existingNames.has(name));
          
          if (toAdd.length > 0) {
            const newAssignments = toAdd.map((actor: string) => {
              // Priority 1: Global mapping
              let dubberId = globalMapping[actor] || "";
              
              // Priority 2: Case-insensitive nickname match if no global mapping
              if (!dubberId) {
                const matchedParticipant = participants.find(
                  p => p.nickname.toLowerCase() === actor.toLowerCase()
                );
                if (matchedParticipant) {
                  dubberId = matchedParticipant.id;
                }
              }

              const dubber = participants.find(p => p.id === dubberId);
              return {
                id: Math.random().toString(),
                episodeId: currentEpisode.id,
                characterName: actor,
                dubberId: dubberId,
                dubber: dubber,
                status: "PENDING" as const
              };
            });

            const updated = [...prev, ...newAssignments];
            // Auto-save the combined assignments
            saveToDatabase(updated);
            return updated;
          }
          return prev;
        });

        lastAnalyzedEpisodeId.current = currentEpisode.id;
        setStatus(`Анализ завершен. Найдено ${newActors.length} персонажей.`);
      } else {
        setStatus("Ошибка при анализе файла.");
      }
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("Ошибка при анализе файла.");
    }
  };

  // Load existing assignments if currentEpisode changes
  useEffect(() => {
    if (!currentEpisode) return;

    if (currentEpisode.assignments && currentEpisode.assignments.length > 0) {
      setAssignments(currentEpisode.assignments);
      setActors(currentEpisode.assignments.map(a => a.characterName));
      lastAnalyzedEpisodeId.current = currentEpisode.id;
    } else {
      // Only clear if it's a different episode
      if (lastAnalyzedEpisodeId.current !== currentEpisode.id) {
        setAssignments([]);
        setActors([]);
        if (currentEpisode.subPath) {
          handleAnalyzeExisting();
        }
      }
    }
  }, [currentEpisode?.id, currentEpisode?.subPath]);

  const handleTransliterateNames = () => {
    if (assignments.length === 0) return;
    
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: latinToCyrillic(a.characterName)
    }));
    
    setAssignments(newAssignments);
    saveToDatabase(newAssignments);
    setStatus("Имена персонажей транслитерированы.");
  };

  const handlePolivanovToHepburn = () => {
    if (assignments.length === 0) return;
    
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: polivanovToHepburn(a.characterName)
    }));
    
    setAssignments(newAssignments);
    saveToDatabase(newAssignments);
    setStatus("Имена персонажей переведены на систему Хэпберна.");
  };

  const handleExportMapping = () => {
    const mapping: Record<string, string> = assignments.reduce((acc, a) => ({ ...acc, [a.characterName]: a.dubberId }), {});
    const json = exportMappingToJson(mapping, participants);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapping_${currentEpisode?.project?.title || 'project'}_ep${currentEpisode?.number || 0}.json`;
    a.click();
  };

  const handleImportMapping = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const json = event.target?.result as string;
      const newMapping = importMappingFromJson(json, participants);
      
      setAssignments(prev => prev.map(a => ({
        ...a,
        dubberId: newMapping[a.characterName] || a.dubberId
      })));
      setStatus("Распределение ролей импортировано!");
    };
    reader.readAsText(file);
  };

  const handleAssign = async (actor: string, dubberId: string) => {
    const dubber = participants.find(p => p.id === dubberId);
    const newAssignments = assignments.map(a => a.characterName === actor ? {...a, dubberId, dubber} : a);
    setAssignments(newAssignments);
    
    // Auto-save
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };

  const handleSetSubstitute = async (assignmentId: string, substituteId: string) => {
    const newAssignments = assignments.map(a => a.id === assignmentId ? {...a, substituteId} : a);
    setAssignments(newAssignments);
    
    // Auto-save
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };


  const handleClearAssignments = async () => {
    if (!window.confirm("Вы уверены, что хотите очистить ВСЕ распределения ролей для этого эпизода?")) return;
    setAssignments([]);
    setActors([]);
    if (currentEpisode) {
      await saveToDatabase([]);
    }
    setStatus("Все распределения ролей очищены.");
  };

  const handleStartRecording = async () => {
    if (!currentEpisode) return;

    setIsSaving(true);
    setStatus("Перевод эпизода в статус 'ЗАПИСЬ'...");

    try {
      const updatedEpisode = {
        ...currentEpisode,
        status: "RECORDING" as const
      };
      await ipcRenderer.invoke('save-episode', updatedEpisode);
      setStatus("Статус обновлен! Теперь можно приступать к записи.");
      onRefresh();
    } catch (error) {
      console.error("Status update error:", error);
      setStatus("Ошибка при обновлении статуса.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setStatus("Генерация разделенных файлов...");

    try {
      const projectTitle = currentEpisode.project?.title || "Project";
      const subDir = `${projectTitle}/Episode_${currentEpisode.number || "0"}/Subtitles/output_dubbers`;
      
      const config = await ipcRenderer.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputDirectory = `${baseDir}/${subDir}`;

      const data = await ipcRenderer.invoke('split-subs-by-dubber', {
        assFilePath: currentEpisode.subPath,
        outputDirectory,
        assignments
      });

      if (data && data.success) {
        setStatus(
          `Файлы успешно разделены и сохранены в папке output_dubbers! Сгенерировано файлов: ${data.generatedFiles.length}`,
        );
      } else {
        setStatus("Ошибка при разделении файлов: " + (data?.error || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error("Split error:", error);
      setStatus("Ошибка при разделении файлов.");
    }
  };

  const handleExportFullAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setStatus("Экспорт полного файла с ролями...");

    try {
      const projectTitle = currentEpisode.project?.title || "Project";
      const subDir = `${projectTitle}/Episode_${currentEpisode.number || "0"}/Subtitles`;
      
      const config = await ipcRenderer.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputPath = `${baseDir}/${subDir}/${projectTitle}_Ep${currentEpisode.number}_Full_Roles.ass`;

      const result = await ipcRenderer.invoke('export-full-ass-with-roles', {
        assFilePath: currentEpisode.subPath,
        outputPath,
        assignments
      });

      if (result) {
        setStatus(`Полный файл успешно экспортирован: ${outputPath}`);
      } else {
        setStatus("Ошибка при экспорте полного файла.");
      }
    } catch (error) {
      console.error("Export error:", error);
      setStatus("Ошибка при экспорте полного файла.");
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Работа с субтитрами
            </h1>
            {currentEpisode && (
              <p className="text-neutral-400 text-sm mt-1">
                Проект:{" "}
                <span className="text-indigo-400">
                  {currentEpisode.project?.title}
                </span>{" "}
                • Серия {currentEpisode.number}
              </p>
            )}
          </div>
        </div>

        <div className="flex bg-neutral-900 rounded-lg p-1 border border-neutral-800">
          <button
            onClick={() => setActiveTab("raw")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "raw"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <Edit3 className="w-4 h-4" />
            Разметка реплик
          </button>
          <button
            onClick={() => setActiveTab("roles")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "roles"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <User className="w-4 h-4" />
            Распределение ролей
          </button>
        </div>
      </div>

      {activeTab === "raw" ? (
        <RawSubtitleEditor
          currentEpisode={currentEpisode}
          onRefresh={onRefresh}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" />
                Загрузка файла
              </h2>

              {currentEpisode?.subPath && (
                <button
                  onClick={handleAnalyzeExisting}
                  className="w-full mb-4 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  <Scissors className="w-4 h-4" />
                  Анализировать загруженные субтитры
                </button>
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
                    {checkAll && (
                      <CheckSquare className="w-5 h-5 text-indigo-500 absolute" />
                    )}
                  </div>
                  <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                    Выбрать все (Генерировать для всех)
                  </span>
                </label>

                <button
                  onClick={handleStartRecording}
                  disabled={
                    !currentEpisode ||
                    assignments.length === 0 ||
                    isSaving ||
                    currentEpisode.status === "RECORDING"
                  }
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
                >
                  {isSaving ? "Обработка..." : currentEpisode?.status === "RECORDING" ? "Уже в записи" : "Начать запись (Статус)"}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleExportMapping}
                    className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700"
                  >
                    <Download className="w-4 h-4" />
                    Экспорт
                  </button>
                  <label className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 cursor-pointer">
                    <FileUp className="w-4 h-4" />
                    Импорт
                    <input type="file" accept=".json" className="hidden" onChange={handleImportMapping} />
                  </label>
                </div>

                <button
                  onClick={handleExportFullAss}
                  disabled={!currentEpisode?.subPath || assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Экспортировать полный ASS
                </button>

                <button
                  onClick={handleClearAssignments}
                  disabled={assignments.length === 0}
                  className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-red-900/50 flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Очистить все роли
                </button>

                <button
                  onClick={handleSplitAss}
                  disabled={!currentEpisode?.subPath || assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                >
                  <Scissors className="w-4 h-4" />
                  Разделить по актерам (Пак)
                </button>

                <button
                  onClick={handleTransliterateNames}
                  disabled={assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                  title="Транслитерация имен (Латиница -> Кириллица)"
                >
                  <Languages className="w-4 h-4" />
                  Транслит (Lat &rarr; Cyr)
                </button>

                <button
                  onClick={handlePolivanovToHepburn}
                  disabled={assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                  title="Поливанов -> Хэпберн (Кириллица)"
                >
                  <Languages className="w-4 h-4 text-amber-400" />
                  Поливанов &rarr; Хэпберн
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
                {assignments.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3 py-12">
                    <Scissors className="w-12 h-12 opacity-20" />
                    <p>Загрузите файл для начала работы</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="flex items-center justify-between bg-neutral-950 border border-neutral-800 p-4 rounded-lg hover:border-neutral-700 transition-colors"
                      >
                        <div className="flex-1">
                          <h4 className="text-neutral-200 font-medium">
                            {assignment.characterName}
                          </h4>
                          <p className="text-xs text-neutral-500">
                            Дабер: {assignment.dubber?.nickname || "Не назначен"}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <select
                            value={assignment.dubberId}
                            onChange={(e) =>
                              handleAssign(assignment.characterName, e.target.value)
                            }
                            className="bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all appearance-none"
                          >
                            <option value="" disabled>
                              -- Выберите дабера --
                            </option>
                            {participants
                              .filter(p => 
                                !currentEpisode?.project?.assignedDubberIds || 
                                currentEpisode.project.assignedDubberIds.length === 0 ||
                                currentEpisode.project.assignedDubberIds.includes(p.id)
                              )
                              .map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.nickname}
                                </option>
                              ))}
                          </select>
                          
                          <select
                            value={assignment.substituteId || ""}
                            onChange={(e) =>
                              handleSetSubstitute(assignment.id, e.target.value)
                            }
                            className="bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all appearance-none"
                          >
                            <option value="">-- Замена --</option>
                            {participants.map((user) => (
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
      )}
    </div>
  );
}
