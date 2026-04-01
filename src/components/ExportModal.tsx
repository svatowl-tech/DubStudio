import React, { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  role: 'DABBER' | 'SOUND_ENGINEER';
  onExport: (targetDir: string, skipConversion: boolean, smartExport?: boolean) => void;
  isExporting?: boolean;
  progress?: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({ 
  isOpen, 
  onClose, 
  episode, 
  role, 
  onExport,
  isExporting = false,
  progress = 0
}) => {
  const [targetDir, setTargetDir] = useState('');
  const [skipConversion, setSkipConversion] = useState(false);
  const [smartExport, setSmartExport] = useState(true);

  if (!isOpen) return null;

  const handleSelectFolder = async () => {
    const res = await ipcSafe.invoke('select-folder');
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
            disabled={isExporting}
            title="Закрыть окно экспорта"
            className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors disabled:opacity-30"
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
              disabled={isExporting}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg border border-neutral-700 transition-colors disabled:opacity-30"
              title="Выбрать папку"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                checked={skipConversion}
                onChange={(e) => setSkipConversion(e.target.checked)}
                disabled={isExporting}
                className="peer sr-only"
              />
              <div className="w-5 h-5 border-2 border-neutral-700 rounded bg-neutral-950 peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all duration-200 group-hover:border-neutral-500" />
              <svg
                className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
              Не конвертировать (только копирование)
            </span>
          </label>
          <p className="text-[10px] text-neutral-500 mt-1 ml-8">
            Видео будет скопировано как есть, без сжатия и наложения субтитров
          </p>
        </div>

        {role === 'SOUND_ENGINEER' && (
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={smartExport}
                  onChange={(e) => setSmartExport(e.target.checked)}
                  disabled={isExporting}
                  className="peer sr-only"
                />
                <div className="w-5 h-5 border-2 border-neutral-700 rounded bg-neutral-950 peer-checked:bg-purple-600 peer-checked:border-purple-600 transition-all duration-200 group-hover:border-neutral-500" />
                <svg
                  className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                Умная сортировка дорожек (Фиксы)
              </span>
            </label>
            <p className="text-[10px] text-neutral-500 mt-1 ml-8">
              Если фикс меньше оригинала — экспортируются оба. Если фикс больше или равен — только фикс.
            </p>
          </div>
        )}

        {isExporting && (
          <div className="mb-6 space-y-2">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Прогресс экспорта...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-indigo-500 h-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        
        <div className="flex justify-end gap-3">
          <button 
            onClick={onClose} 
            disabled={isExporting}
            title="Отменить экспорт и закрыть окно"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors border border-neutral-700 disabled:opacity-30"
          >
            Отмена
          </button>
          <button 
            onClick={() => onExport(targetDir, skipConversion, smartExport)} 
            title="Начать экспорт"
            disabled={!targetDir || isExporting}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            {isExporting ? 'Экспортируем...' : 'Экспорт'}
          </button>
        </div>
      </div>
    </div>
  );
};
