import React, { useState, useEffect } from 'react';
import { X, Plus, Image as ImageIcon } from 'lucide-react';
import { Project, Participant } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';

interface CharacterManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProject: Project | null;
  participants: Participant[];
  onRefresh: () => void;
}

export default function CharacterManagementModal({ isOpen, onClose, selectedProject, participants, onRefresh }: CharacterManagementModalProps) {
  if (!isOpen || !selectedProject) return null;

  let mapping: {characterName: string, dubberId: string, photoUrl?: string}[] = [];
  try {
    const parsed = JSON.parse(selectedProject.globalMapping || '[]');
    if (Array.isArray(parsed)) {
      mapping = parsed;
    } else if (parsed && typeof parsed === 'object') {
      mapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
    }
  } catch (e) {
    console.error(e);
  }
  const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
  
  // Group aliases by main character
  const aliasesByMain: Record<string, string[]> = {};
  Object.entries(aliases).forEach(([alias, main]) => {
    if (!aliasesByMain[main]) aliasesByMain[main] = [];
    aliasesByMain[main].push(alias);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Управление персонажами и алиасами</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
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
                  {mapping.map((char, idx) => (
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
                          {participants.map((p, pIdx) => (
                            <option key={(p.id || 'p') + pIdx} value={p.id}>{p.nickname}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input 
                          type="text"
                          defaultValue={(aliasesByMain[char.characterName] || []).join(', ')}
                          onBlur={async (e) => {
                            const newAliasesList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                            const updatedAliases = { ...aliases };
                            
                            // Remove old aliases for this character
                            Object.keys(updatedAliases).forEach(k => {
                              if (updatedAliases[k] === char.characterName) {
                                delete updatedAliases[k];
                              }
                            });
                            
                            // Add new aliases
                            newAliasesList.forEach(a => {
                              updatedAliases[a] = char.characterName;
                            });
                            
                            await ipcSafe.invoke('save-project', { ...selectedProject, characterAliases: JSON.stringify(updatedAliases) });
                            onRefresh();
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 text-white rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                          placeholder="Напр: Наруто, Узумаки"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button 
                          onClick={async () => {
                            if (window.confirm(`Удалить персонажа ${char.characterName}?`)) {
                              const updatedMapping = mapping.filter((_, i) => i !== idx);
                              const updatedAliases = { ...aliases };
                              Object.keys(updatedAliases).forEach(k => {
                                if (updatedAliases[k] === char.characterName) {
                                  delete updatedAliases[k];
                                }
                              });
                              await ipcSafe.invoke('save-project', { 
                                ...selectedProject, 
                                globalMapping: JSON.stringify(updatedMapping),
                                characterAliases: JSON.stringify(updatedAliases)
                              });
                              onRefresh();
                            }
                          }}
                          className="text-neutral-500 hover:text-red-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {mapping.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                        Персонажи не добавлены.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-neutral-800 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
