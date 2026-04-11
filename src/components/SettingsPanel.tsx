import { useState, useEffect } from 'react';
import { Settings, Save, Folder, Cpu, Key, Terminal } from 'lucide-react';
import { ipcSafe } from '../lib/ipcSafe';

export default function SettingsPanel() {
  const [settings, setSettings] = useState({
    baseDir: '',
    ffmpegPath: '',
    useNvenc: false,
    gpuIndex: '0',
    openRouterKey: '',
    aiModel: 'google/gemini-2.0-flash:free'
  });

  const aiModels = [
    { id: 'google/gemini-2.0-flash:free', name: 'Google: Gemini 2.0 Flash (free)' },
    { id: 'google/gemma-2-27b-it:free', name: 'Google: Gemma 2 27B (free)' },
    { id: 'google/gemma-2-9b-it:free', name: 'Google: Gemma 2 9B (free)' },
    { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)' },
    { id: 'meta-llama/llama-3.1-70b-instruct:free', name: 'Meta: Llama 3.1 70B Instruct (free)' },
    { id: 'arcee-ai/arcee-trinity:free', name: 'Arcee AI: Trinity Large Preview (free)' },
    { id: 'openrouter/auto', name: 'Free Models Router (Auto)' }
  ];

  const [gpus, setGpus] = useState<{ name: string, index: string }[]>([]);

  useEffect(() => {
    ipcSafe.invoke('get-config').then(data => {
      if (data) {
        setSettings(prev => ({ 
          ...prev, 
          ...data,
          // Ensure defaults if missing
          baseDir: data.baseDir || '',
          ffmpegPath: data.ffmpegPath || '',
          useNvenc: !!data.useNvenc,
          gpuIndex: data.gpuIndex || '0',
          openRouterKey: data.openRouterKey || '',
          aiModel: data.aiModel || 'google/gemini-2.0-flash:free'
        }));
      }
    });

    ipcSafe.invoke('get-gpus').then(setGpus);
  }, []);

  const handleSelectFolder = async (key: 'baseDir') => {
    const res = await ipcSafe.invoke('select-folder');
    if (res.success) {
      setSettings(prev => ({ ...prev, [key]: res.data.path }));
    }
  };

  const handleSave = async () => {
    try {
      await ipcSafe.invoke('save-config', settings);
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
              <label className="block text-sm text-neutral-400 mb-2">Рабочая директория (База проектов)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.baseDir}
                  onChange={(e) => setSettings({...settings, baseDir: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                  placeholder="Выберите папку для хранения проектов"
                />
                <button 
                  onClick={() => handleSelectFolder('baseDir')}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg transition-colors"
                  title="Выбрать папку"
                >
                  <Folder className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-neutral-400 mb-2">Путь к FFmpeg (ffmpeg.exe)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.ffmpegPath}
                  onChange={(e) => setSettings({...settings, ffmpegPath: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                  placeholder="Оставьте пустым для использования встроенного"
                />
                <button 
                  onClick={async () => {
                    const res = await ipcSafe.invoke('select-file', {
                      filters: [{ name: 'Executables', extensions: ['exe', 'bin', 'sh'] }]
                    });
                    if (res.success) {
                      setSettings({...settings, ffmpegPath: res.data.path});
                    }
                  }}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg transition-colors"
                  title="Выбрать файл"
                >
                  <Terminal className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </section>


        {/* Видеокарта */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-400" />
            API Ключи
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-2">OpenRouter API Key (для AI перевода)</label>
              <div className="relative">
                <input 
                  type="password" 
                  value={settings.openRouterKey}
                  onChange={(e) => setSettings({...settings, openRouterKey: e.target.value})}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-amber-500 outline-none"
                  placeholder="sk-or-v1-..."
                />
                <Key className="w-4 h-4 text-neutral-600 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <p className="text-[10px] text-neutral-500 mt-2">
                Используется для перевода через бесплатные модели OpenRouter. Если ключ не указан, будет использован стандартный Google Translate API.
              </p>
            </div>

            <div>
              <label className="block text-sm text-neutral-400 mb-2">Модель AI для перевода</label>
              <select 
                value={settings.aiModel}
                onChange={(e) => setSettings({...settings, aiModel: e.target.value})}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-amber-500 outline-none appearance-none cursor-pointer"
              >
                {aiModels.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Видеокарта */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Аппаратное ускорение (NVENC)
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input 
                type="checkbox" 
                id="useNvenc"
                checked={settings.useNvenc}
                onChange={(e) => setSettings({...settings, useNvenc: e.target.checked})}
                className="w-5 h-5 rounded border-neutral-800 bg-neutral-950 text-green-600 focus:ring-green-500 focus:ring-offset-neutral-900"
              />
              <label htmlFor="useNvenc" className="text-white cursor-pointer select-none">
                Использовать NVENC для рендеринга и транскодирования
              </label>
            </div>

            {settings.useNvenc && (
              <div>
                <label className="block text-sm text-neutral-400 mb-2">Выберите видеокарту</label>
                <select 
                  value={settings.gpuIndex}
                  onChange={(e) => setSettings({...settings, gpuIndex: e.target.value})}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:border-green-500 outline-none appearance-none cursor-pointer"
                >
                  {gpus.map(gpu => (
                    <option key={gpu.index} value={gpu.index}>GPU {gpu.index}: {gpu.name}</option>
                  ))}
                  {gpus.length === 0 && <option value="0">Видеокарта по умолчанию (0)</option>}
                </select>
              </div>
            )}
          </div>
        </section>

        <button 
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-lg font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
        >
          <Save className="w-5 h-5" />
          Сохранить настройки
        </button>
      </div>
    </div>
  );
}
