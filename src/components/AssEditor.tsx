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
} from "lucide-react";
import { Participant, Episode, RoleAssignment } from "../types";
import { getParticipants } from "../services/dbService";
import RawSubtitleEditor from "./RawSubtitleEditor";
import { exportMappingToJson, importMappingFromJson } from "../lib/mappingExport";

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

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  // Load existing assignments if currentEpisode changes
  useEffect(() => {
    if (currentEpisode?.assignments) {
      setAssignments(currentEpisode.assignments);
      if (currentEpisode.assignments.length > 0) {
        setActors(currentEpisode.assignments.map(a => a.characterName));
      }
    }
  }, [currentEpisode]);

  const handleAnalyzeExisting = async () => {
    if (!currentEpisode?.subPath) return;
    setStatus("Анализ существующих субтитров...");
    try {
      const response = await fetch(
        `/api/episodes/${currentEpisode.id}/parse-subs`,
        {
          method: "POST",
        },
      );
      const result = await response.json();
      if (result.success) {
        const { actorMapping } = result.data;
        const newActors = Object.keys(actorMapping);
        setActors(newActors);

        // Merge with existing assignments and global mapping
        const globalMapping = currentEpisode?.project?.globalMapping
          ? JSON.parse(currentEpisode.project.globalMapping)
          : {};

        const newAssignments = [...assignments];
        newActors.forEach((actor) => {
          if (!newAssignments.find(a => a.characterName === actor)) {
            let dubberId = "";
            if (globalMapping[actor]) {
              dubberId = globalMapping[actor];
            } else if (actorMapping[actor]) {
              dubberId = (actorMapping[actor] as Participant).id;
            }
            
            if (dubberId) {
              newAssignments.push({
                id: Math.random().toString(), // Temporary ID
                episodeId: currentEpisode.id,
                characterName: actor,
                dubberId: dubberId,
                status: "PENDING"
              });
            }
          }
        });

        setAssignments(newAssignments);
        setStatus(`Анализ завершен. Найдено ${newActors.length} персонажей.`);
      } else {
        setStatus("Ошибка при анализе файла.");
      }
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("Ошибка при анализе файла.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile || !currentEpisode) return;

    setFile(uploadedFile);
    setStatus("Файл загружен. Анализ...");

    try {
      const projectTitle = currentEpisode.project?.title || "Project";
      const subDir = `${projectTitle}/Episode_${currentEpisode.number || "0"}/Subtitles`;

      const formData = new FormData();
      formData.append("subDir", subDir);
      formData.append("fileName", uploadedFile.name);
      formData.append("file", uploadedFile);

      const uploadResponse = await fetch("/api/upload-file", {
        method: "POST",
        body: formData,
      });

      const uploadResult = await uploadResponse.json();
      if (!uploadResult.success) throw new Error("Upload failed");

      // Update episode with new subPath
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subPath: uploadResult.data.path }),
      });
      onRefresh(); // Refresh to update currentEpisode in parent

      // Now call parse-subs endpoint instead of IPC
      const response = await fetch(
        `/api/episodes/${currentEpisode.id}/parse-subs`,
        {
          method: "POST",
        },
      );

      const result = await response.json();
      if (result.success) {
        const { actorMapping } = result.data;
        const newActors = Object.keys(actorMapping);
        setActors(newActors);

        // Merge with existing assignments and global mapping
        const globalMapping = currentEpisode?.project?.globalMapping
          ? JSON.parse(currentEpisode.project.globalMapping)
          : {};

        const newAssignments = [...assignments];
        newActors.forEach((actor) => {
          if (!newAssignments.find(a => a.characterName === actor)) {
            let dubberId = "";
            if (globalMapping[actor]) {
              dubberId = globalMapping[actor];
            } else if (actorMapping[actor]) {
              dubberId = (actorMapping[actor] as Participant).id;
            }
            
            if (dubberId) {
              newAssignments.push({
                id: Math.random().toString(), // Temporary ID
                episodeId: currentEpisode.id,
                characterName: actor,
                dubberId: dubberId,
                status: "PENDING"
              });
            }
          }
        });

        setAssignments(newAssignments);
        setStatus(`Анализ завершен. Найдено ${newActors.length} персонажей.`);
      } else {
        setStatus("Ошибка при анализе файла.");
      }
    } catch (error) {
      console.error("Import error:", error);
      setStatus("Ошибка при анализе файла.");
    }
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

  const handleAssign = (actor: string, dubberId: string) => {
    setAssignments(prev => prev.map(a => a.characterName === actor ? {...a, dubberId} : a));
  };

  const handleSetSubstitute = async (assignmentId: string, substituteId: string) => {
    try {
      const response = await fetch(`/api/assignments/${assignmentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substituteId }),
      });
      
      if (response.ok) {
        setAssignments(prev => prev.map(a => a.id === assignmentId ? {...a, substituteId} : a));
        setStatus("Замена назначена!");
      } else {
        setStatus("Ошибка при назначении замены.");
      }
    } catch (error) {
      console.error("Substitution error:", error);
      setStatus("Ошибка при назначении замены.");
    }
  };

  const handleSaveAssignments = async () => {
    if (!currentEpisode) return;

    setIsSaving(true);
    setStatus("Сохранение распределения ролей...");

    try {
      // Save each assignment to the database
      const promises = assignments.map(
        (assignment) => {
          return fetch(`/api/episodes/${currentEpisode.id}/assignments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(assignment),
          });
        },
      );

      await Promise.all(promises);

      // Update episode status to RECORDING
      await fetch(`/api/episodes/${currentEpisode.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RECORDING" }),
      });

      // Update project global mapping
      if (currentEpisode.projectId) {
        await fetch(`/api/projects/${currentEpisode.projectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ globalMapping: JSON.stringify(assignments.reduce((acc, a) => ({ ...acc, [a.characterName]: a.dubberId }), {})) }),
        });
      }

      setStatus("Распределение ролей сохранено! Переход к записи.");
      onRefresh();
    } catch (error) {
      console.error("Save error:", error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitAss = async () => {
    if (!currentEpisode) return;
    setStatus("Генерация разделенных файлов...");

    try {
      const response = await fetch(
        `/api/episodes/${currentEpisode.id}/split-subs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        },
      );

      const data = await response.json();
      if (data.success) {
        setStatus(
          `Файлы успешно разделены и сохранены в папке output_dubbers! Сгенерировано файлов: ${data.data.generatedFiles.length}`,
        );
      } else {
        setStatus("Ошибка при разделении файлов: " + data.error);
      }
    } catch (error) {
      console.error("Split error:", error);
      setStatus("Ошибка при разделении файлов.");
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

              <div className="flex items-center gap-4 mb-4">
                <div className="h-px bg-neutral-800 flex-1"></div>
                <span className="text-xs text-neutral-500 uppercase tracking-wider">
                  Или загрузить новый
                </span>
                <div className="h-px bg-neutral-800 flex-1"></div>
              </div>

              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-700 border-dashed rounded-lg cursor-pointer bg-neutral-950 hover:bg-neutral-800 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <FileText className="w-8 h-8 text-neutral-500 mb-2" />
                  <p className="text-sm text-neutral-400">
                    <span className="font-semibold text-indigo-400">
                      Нажмите для загрузки
                    </span>{" "}
                    или перетащите
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Только .ass файлы
                  </p>
                </div>
                <input
                  type="file"
                  accept=".ass"
                  className="hidden"
                  onChange={handleFileUpload}
                />
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
                    {checkAll && (
                      <CheckSquare className="w-5 h-5 text-indigo-500 absolute" />
                    )}
                  </div>
                  <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                    Checkall (Генерировать для всех)
                  </span>
                </label>

                <button
                  onClick={handleSaveAssignments}
                  disabled={
                    !currentEpisode ||
                    assignments.length === 0 ||
                    isSaving
                  }
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
                >
                  {isSaving ? "Сохранение..." : "Сохранить роли"}
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
                  onClick={handleSplitAss}
                  disabled={!file || assignments.length === 0}
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
                            {participants.map((user) => (
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
