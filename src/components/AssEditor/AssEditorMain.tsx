import React from "react";
import { User, Plus, Trash2, Scissors } from "lucide-react";
import { RoleAssignment, Participant, Episode } from "../../types";

interface AssEditorMainProps {
  assignments: RoleAssignment[];
  participants: Participant[];
  currentEpisode: Episode | null;
  showSigns: boolean;
  linkingCharacter: string | null;
  setLinkingCharacter: (val: string | null) => void;
  globalMapping: {characterName: string, dubberId: string, photoUrl?: string}[];
  getCharacterPortrait: (name: string) => string | undefined;
  setAssignments: (assignments: RoleAssignment[]) => void;
  saveToDatabase: (assignments: RoleAssignment[]) => void;
  handleAddDubberToCharacter: (characterName: string) => void;
  handleLinkAsAlias: (aliasName: string, mainName: string) => void;
  handleAssignById: (assignmentId: string, dubberId: string) => void;
  handleSetSubstitute: (assignmentId: string, substituteId: string) => void;
  handleRemoveAssignment: (assignmentId: string, characterName: string) => void;
}

export default function AssEditorMain({
  assignments,
  participants,
  currentEpisode,
  showSigns,
  linkingCharacter,
  setLinkingCharacter,
  globalMapping,
  getCharacterPortrait,
  setAssignments,
  saveToDatabase,
  handleAddDubberToCharacter,
  handleLinkAsAlias,
  handleAssignById,
  handleSetSubstitute,
  handleRemoveAssignment
}: AssEditorMainProps) {
  const SIGN_KEYWORDS = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];

  return (
    <div className="lg:col-span-2">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-500" />
            <h3 className="font-bold text-white">Распределение ролей</h3>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {assignments.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3 py-12">
              <Scissors className="w-12 h-12 opacity-20" />
              <p>Загрузите файл для начала работы</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(
                assignments
                  .filter(a => {
                    if (showSigns) return true;
                    const name = a.characterName.toLowerCase();
                    return !SIGN_KEYWORDS.some(s => {
                      if (s === 'op' || s === 'ed') {
                        const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
                        return regex.test(name);
                      }
                      return name.includes(s);
                    });
                  })
                  .reduce((acc: Record<string, RoleAssignment[]>, curr: RoleAssignment) => {
                    const dubberId = curr.dubberId || "unassigned";
                    if (!acc[dubberId]) acc[dubberId] = [];
                    acc[dubberId].push(curr);
                    return acc;
                  }, {} as Record<string, RoleAssignment[]>)
              ).map(([dubberId, dubberAssignments]: [string, RoleAssignment[]]) => {
                const dubber = participants.find(p => p.id === dubberId);
                const totalLines = dubberAssignments.reduce((sum: number, a: RoleAssignment) => sum + (a.lineCount || 0), 0);
                
                return (
                  <div key={dubberId} className="bg-neutral-950 border border-neutral-800 rounded-lg overflow-hidden">
                    <div className="bg-neutral-900/50 px-4 py-2 border-b border-neutral-800 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold ${dubberId === 'unassigned' ? 'text-amber-500' : 'text-indigo-400'}`}>
                          {dubber?.nickname || (dubberId === 'unassigned' ? "Не распределено" : "Неизвестный")}
                        </span>
                        <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full border border-neutral-700">
                          {totalLines} реплик
                        </span>
                      </div>
                    </div>
                    
                    <div className="p-3 space-y-3">
                      {dubberAssignments.map((assignment: RoleAssignment) => (
                        <div key={assignment.id} className="flex flex-col gap-1.5 p-2 bg-neutral-900/30 rounded border border-neutral-800/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const portrait = getCharacterPortrait(assignment.characterName);
                                return portrait ? (
                                  <img 
                                    src={portrait || undefined} 
                                    alt="" 
                                    className="w-6 h-6 rounded-full object-cover border border-neutral-700"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-500 border border-neutral-700">
                                    <User className="w-3 h-3" />
                                  </div>
                                );
                              })()}
                              <span className="text-sm text-neutral-200 font-medium">{assignment.characterName}</span>
                              <span className="text-[10px] text-neutral-500">({assignment.lineCount || 0} реп.)</span>
                              <button
                                onClick={() => {
                                  const newAssignments = assignments.map(a => 
                                    a.id === assignment.id ? { ...a, isMain: !a.isMain } : a
                                  );
                                  setAssignments(newAssignments);
                                  saveToDatabase(newAssignments);
                                }}
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors border ${
                                  assignment.isMain 
                                    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' 
                                    : 'bg-neutral-800 text-neutral-500 border-neutral-700 hover:text-indigo-400'
                                }`}
                              >
                                {assignment.isMain ? 'Главная' : 'Втор.'}
                              </button>
                              <button
                                onClick={() => setLinkingCharacter(linkingCharacter === assignment.characterName ? null : assignment.characterName)}
                                className={`text-[10px] px-1 rounded transition-colors ${
                                  linkingCharacter === assignment.characterName 
                                    ? 'bg-amber-500/20 text-amber-400' 
                                    : 'text-neutral-600 hover:text-amber-400'
                                }`}
                              >
                                Связать
                              </button>
                            </div>
                            <button
                              onClick={() => handleAddDubberToCharacter(assignment.characterName)}
                              className="text-[10px] text-indigo-500 hover:text-indigo-400 flex items-center gap-0.5"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              Даббер
                            </button>
                          </div>

                          {linkingCharacter === assignment.characterName && (
                            <div className="my-2 p-2 bg-neutral-900 border border-amber-500/30 rounded text-[10px]">
                              <p className="text-amber-400 mb-1">Связать с персонажем проекта:</p>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {globalMapping.map(m => (
                                  <button
                                    key={m.characterName}
                                    onClick={() => handleLinkAsAlias(assignment.characterName, m.characterName)}
                                    className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700 flex items-center gap-1.5"
                                  >
                                    {getCharacterPortrait(m.characterName) && (
                                      <img 
                                        src={getCharacterPortrait(m.characterName)} 
                                        alt="" 
                                        className="w-4 h-4 rounded-full object-cover border border-neutral-600"
                                        referrerPolicy="no-referrer"
                                      />
                                    )}
                                    <span>{m.characterName}</span>
                                    {m.dubberId && <span className="text-[8px] text-indigo-400">({participants.find(p => p.id === m.dubberId)?.nickname})</span>}
                                  </button>
                                ))}
                              </div>
                              
                              <p className="text-neutral-500 mb-1">Или с другим персонажем из субтитров:</p>
                              <div className="flex flex-wrap gap-1">
                                {Array.from(new Set(assignments.map(a => a.characterName)))
                                  .filter(name => name !== assignment.characterName)
                                  .map((name: string) => (
                                    <button
                                      key={name}
                                      onClick={() => handleLinkAsAlias(assignment.characterName, name)}
                                      className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700"
                                    >
                                      {name}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <select
                              value={assignment.dubberId}
                              onChange={(e) => handleAssignById(assignment.id, e.target.value)}
                              className="flex-1 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                            >
                              <option value="">-- Выберите дабера --</option>
                              {participants
                                .filter(user => 
                                  currentEpisode?.project?.assignedDubberIds?.includes(user.id) || 
                                  user.id === assignment.dubberId
                                )
                                .map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.nickname}
                                  </option>
                                ))}
                            </select>
                            
                            <select
                              value={assignment.substituteId || ""}
                              onChange={(e) => handleSetSubstitute(assignment.id, e.target.value)}
                              className="w-1/3 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                            >
                              <option value="">-- Замена --</option>
                              {participants.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.nickname}
                                </option>
                              ))}
                            </select>

                            <button
                              onClick={() => handleRemoveAssignment(assignment.id, assignment.characterName)}
                              className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
