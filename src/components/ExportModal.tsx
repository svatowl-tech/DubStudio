import React, { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { Episode } from '../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  role: 'DABBER' | 'SOUND_ENGINEER';
  onExport: (targetDir: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, episode, role, onExport }) => {
  const [targetDir, setTargetDir] = useState('');

  if (!isOpen) return null;

  const handleSelectFolder = async () => {
    const res = await window.electronAPI.invoke('select-folder');
    if (res.success) {
      setTargetDir(res.data.path);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">
            Экспорт {role === 'DABBER' ? 'Даберам' : 'Звукорежиссеру'}
          </h2>
          <button 
            onClick={onClose}
            title="Закрыть окно экспорта"
            className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-neutral-400 mb-2">Папка экспорта</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={targetDir}
              readOnly
              className="flex-grow bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="Выберите папку..."
            />
            <button 
              onClick={handleSelectFolder} 
              className="p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg border border-neutral-700 transition-colors"
              title="Выбрать папку"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex justify-end gap-3">
          <button 
            onClick={onClose} 
            title="Отменить экспорт и закрыть окно"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors border border-neutral-700"
          >
            Отмена
          </button>
          <button 
            onClick={() => onExport(targetDir)} 
            title="Начать экспорт"
            disabled={!targetDir}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            Экспорт
          </button>
        </div>
      </div>
    </div>
  );
};
