import { useState, useEffect } from 'react';
import { Settings, Save, Folder, Cpu, Database } from 'lucide-react';
import { ipcRenderer } from '../lib/ipc';

export default function SettingsPanel() {
  const [settings, setSettings] = useState({
    exportPath: 'C:/PolzaStudio/Exports',
    nvencDevice: '0',
    dbPath: 'C:/PolzaStudio/data.db'
  });

  const [gpus, setGpus] = useState<{ name: string, index: string }[]>([]);

  useEffect(() => {
    ipcRenderer.invoke('get-config').then(data => {
      if (data) {
        setSettings(prev => ({ ...prev, ...data }));
      }
    });

    ipcRenderer.invoke('get-gpus').then(setGpus);
  }, []);

  const handleSelectFolder = async (key: 'exportPath' | 'dbPath') => {
    const path = await ipcRenderer.invoke('select-folder');
    if (path) {
      setSettings(prev => ({ ...prev, [key]: path }));
    }
  };

  const handleSave = async () => {
    try {
      await ipcRenderer.invoke('save-config', settings);
      alert('Настройки сохранены!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Ошибка при сохранении настроек');
    }
  };

  return (
    <div className="p-8 max-w-4xl w-full mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-neutral-800 rounded-xl flex items-center justify-center shadow-lg">
          <Settings className="w-5 h-5 text-neutral-400" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Настройки</h1>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 space-y-8">
        {/* Пути */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Folder className="w-5 h-5 text-blue-400" />
            Пути к файлам
          </h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-2">Папка экспорта</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.exportPath}
                  onChange={(e) => setSettings({...settings, exportPath: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                />
                <button 
                  onClick={() => handleSelectFolder('exportPath')}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg"
                >
                  <Folder className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-neutral-400 mb-2">Путь к БД (SQLite)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.dbPath}
                  onChange={(e) => setSettings({...settings, dbPath: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                />
                <button 
                  onClick={() => handleSelectFolder('dbPath')}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg"
                >
                  <Folder className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Видеокарта */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Видеокарта (NVENC)
          </h2>
          <select 
            value={settings.nvencDevice}
            onChange={(e) => setSettings({...settings, nvencDevice: e.target.value})}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:border-green-500 outline-none appearance-none"
          >
            {gpus.map(gpu => (
              <option key={gpu.index} value={gpu.index}>GPU {gpu.index}: {gpu.name}</option>
            ))}
            {gpus.length === 0 && <option value="0">Видеокарта по умолчанию</option>}
          </select>
        </section>

        <button 
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-lg font-bold transition-colors shadow-lg shadow-blue-500/20"
        >
          <Save className="w-5 h-5" />
          Сохранить настройки
        </button>
      </div>
    </div>
  );
}
