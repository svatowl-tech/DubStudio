import React, { useState, useEffect } from "react";
import { Languages, FileText, Loader2, RefreshCw, Save, Edit3, Check, X, AlertCircle, ChevronDown, BrainCircuit } from "lucide-react";
import { ipcSafe } from "../lib/ipcSafe";
import { Episode } from "../types";

interface TranslatePanelProps {
  currentEpisode: Episode | null;
}

const GENRES = [
  { id: 'shonen', name: 'Сёнен (Экшен, Энергично)', prompt: 'Тон: энергичный, молодежный, много восклицаний, боевой дух.' },
  { id: 'shojo', name: 'Сёдзе (Романтика, Эмоции)', prompt: 'Тон: эмоциональный, нежный, вежливый, акцент на чувствах.' },
  { id: 'seinen', name: 'Сейнен (Серьезно, Мрачно)', prompt: 'Тон: взрослый, реалистичный, иногда грубый или философский.' },
  { id: 'comedy', name: 'Комедия (Юмор, Сленг)', prompt: 'Тон: забавный, ироничный, использование современного сленга.' },
  { id: 'drama', name: 'Драма (Трагедия, Официоз)', prompt: 'Тон: тяжелый, официальный, глубокий, без лишнего сленга.' },
];

const LANGUAGES = [
  { code: 'ja', name: 'Японский' },
  { code: 'en', name: 'Английский' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: 'Китайский' },
  { code: 'ko', name: 'Корейский' },
];

export default function TranslatePanel({ currentEpisode }: TranslatePanelProps) {
  const [sourceLang, setSourceLang] = useState("ja");
  const [destLang, setDestLang] = useState("ru");
  const [selectedGenre, setSelectedGenre] = useState(GENRES[0].id);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [translatedLines, setTranslatedLines] = useState<any[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState<string | null>(null);

  useEffect(() => {
    ipcSafe.invoke('get-config').then(config => {
      if (config?.openRouterKey) {
        setOpenRouterKey(config.openRouterKey);
      }
    });
  }, []);

  useEffect(() => {
    setTranslatedLines([]);
    setStatus("");
    setEditingIndex(null);
  }, [currentEpisode]);

  const handleTranslate = async () => {
    if (!currentEpisode?.subPath) {
      setStatus("Файл субтитров не найден.");
      return;
    }

    setIsProcessing(true);
    setStatus("Загрузка субтитров...");

    try {
      // 1. Get raw subtitles
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines = data.lines || data;
      
      const genreInfo = GENRES.find(g => g.id === selectedGenre);
      const sourceLangName = LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang;
      const destLangName = LANGUAGES.find(l => l.code === destLang)?.name || destLang;

      const newTranslatedLines = [...lines];

      if (openRouterKey) {
        setStatus("Перевод через AI (OpenRouter)...");
        
        // Batch translation for efficiency and context window management
        // Free models often have smaller context windows, so we use a smaller batch size
        const BATCH_SIZE = 15;
        
        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
          const batch = lines.slice(i, i + BATCH_SIZE);
          const batchToTranslate = batch.filter((l: any) => l.text && l.text.trim());
          
          if (batchToTranslate.length === 0) continue;

          setStatus(`AI Перевод: ${i + 1} - ${Math.min(i + BATCH_SIZE, lines.length)}...`);

          const prompt = `
            Переведи следующие реплики из аниме с языка "${sourceLangName}" на язык "${destLangName}".
            Жанр аниме: ${genreInfo?.name}.
            ${genreInfo?.prompt}
            
            Верни ответ СТРОГО в формате JSON объекта:
            {
              "translations": ["перевод 1", "перевод 2", ...]
            }
            
            Количество элементов в массиве "translations" должно быть ровно ${batchToTranslate.length}.
            Не добавляй никаких пояснений, только JSON.
            
            Реплики для перевода:
            ${batchToTranslate.map((l: any, idx: number) => `${idx}: ${l.text}`).join('\n')}
          `;

          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openRouterKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": window.location.origin,
              "X-Title": "Anime Dub Manager"
            },
            body: JSON.stringify({
              model: "google/gemini-2.0-flash-lite-preview-02-05:free",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" }
            })
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData?.error?.message || `Ошибка API: ${response.status}`);
          }

          const resultData = await response.json();
          const content = resultData.choices[0].message.content;
          
          let results: string[] = [];
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed.translations)) {
              results = parsed.translations;
            } else if (Array.isArray(parsed)) {
              results = parsed;
            } else {
              // Поиск первого попавшегося массива
              const firstArray = Object.values(parsed).find(v => Array.isArray(v));
              if (firstArray) results = firstArray as string[];
            }
          } catch (e) {
            const match = content.match(/\[.*\]/s);
            if (match) {
              results = JSON.parse(match[0]);
            }
          }

          let resultIdx = 0;
          for (let j = 0; j < batch.length; j++) {
            const lineIndex = i + j;
            if (lines[lineIndex].text && lines[lineIndex].text.trim()) {
              newTranslatedLines[lineIndex] = { 
                ...lines[lineIndex], 
                originalText: lines[lineIndex].text,
                text: results[resultIdx] || lines[lineIndex].text 
              };
              resultIdx++;
            } else {
              newTranslatedLines[lineIndex] = {
                ...lines[lineIndex],
                originalText: lines[lineIndex].text
              };
            }
          }
        }
      } else {
        setStatus("AI ключ не найден. Использую стандартный перевод...");
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.text && line.text.trim()) {
            setStatus(`Перевод реплики ${i + 1} / ${lines.length}...`);
            const result = await ipcSafe.invoke('translate-text', {
              text: line.text,
              sourceLang,
              destLang
            });
            newTranslatedLines[i] = {
              ...line,
              originalText: line.text,
              text: result['destination-text']
            };
          } else {
            newTranslatedLines[i] = { ...line, originalText: line.text };
          }
        }
      }

      setTranslatedLines(newTranslatedLines);
      setStatus("Перевод завершен!");
    } catch (error: any) {
      console.error("Translation error:", error);
      setStatus(`Ошибка: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!currentEpisode?.subPath || translatedLines.length === 0) return;
    
    setIsProcessing(true);
    setStatus("Сохранение перевода...");
    
    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines
      });
      setStatus("Перевод успешно сохранен в файл!");
    } catch (error) {
      console.error("Save error:", error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditing = (index: number, text: string) => {
    setEditingIndex(index);
    setEditText(text);
  };

  const saveEdit = (index: number) => {
    const newLines = [...translatedLines];
    newLines[index].text = editText;
    setTranslatedLines(newLines);
    setEditingIndex(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="p-2 bg-indigo-600/20 rounded-lg">
            <Languages className="w-6 h-6 text-indigo-400" />
          </div>
          Умный перевод субтитров
        </h2>
        {currentEpisode && (
          <div className="px-4 py-1.5 bg-neutral-800 rounded-full text-xs font-medium text-neutral-400 border border-neutral-700">
            Серия {currentEpisode.number}
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Исходный язык</label>
                <div className="relative">
                  <select 
                    value={sourceLang} 
                    onChange={e => setSourceLang(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Язык перевода</label>
                <div className="relative">
                  <select 
                    value={destLang} 
                    onChange={e => setDestLang(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Жанр / Тон перевода</label>
                <div className="relative">
                  <select 
                    value={selectedGenre} 
                    onChange={e => setSelectedGenre(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {GENRES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>
            
            <div className="pt-4 space-y-3">
              <button
                onClick={handleTranslate}
                disabled={isProcessing || !currentEpisode?.subPath}
                className="w-full px-4 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/20"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                {isProcessing ? "Обработка..." : "Запустить AI перевод"}
              </button>
              
              <button
                onClick={handleSave}
                disabled={isProcessing || translatedLines.length === 0}
                className="w-full px-4 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-600/20"
              >
                <Save className="w-5 h-5" />
                Применить и сохранить
              </button>
            </div>
            
            {status && (
              <div className={`p-4 rounded-xl text-xs flex gap-3 ${status.includes('Ошибка') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'}`}>
                {status.includes('Ошибка') ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                <p>{status}</p>
              </div>
            )}
          </div>
        </div>

        {/* Lines List */}
        <div className="lg:col-span-2">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl flex flex-col h-[700px]">
            <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Список реплик</span>
              </div>
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                Всего: {translatedLines.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {translatedLines.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-neutral-900 z-10">
                    <tr className="border-b border-neutral-800">
                      <th className="p-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest w-1/2">Оригинал ({sourceLang})</th>
                      <th className="p-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest w-1/2">Перевод ({destLang})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {translatedLines.map((line, idx) => (
                      <tr key={idx} className="border-b border-neutral-800/50 hover:bg-white/5 transition-colors group">
                        <td className="p-4 text-sm text-neutral-400 italic font-light border-r border-neutral-800/50">
                          {line.originalText || line.text}
                        </td>
                        <td className="p-4 text-sm text-white relative">
                          {editingIndex === idx ? (
                            <div className="flex gap-2">
                              <textarea
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                className="flex-1 bg-neutral-950 border border-indigo-500 rounded-lg p-2 text-sm text-white focus:outline-none min-h-[60px]"
                                autoFocus
                              />
                              <div className="flex flex-col gap-2">
                                <button onClick={() => saveEdit(idx)} className="p-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-500">
                                  <Check className="w-4 h-4" />
                                </button>
                                <button onClick={() => setEditingIndex(null)} className="p-2 bg-neutral-800 rounded-lg text-white hover:bg-neutral-700">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between items-start gap-4">
                              <span>{line.text}</span>
                              <button 
                                onClick={() => startEditing(idx, line.text)}
                                className="p-1.5 text-neutral-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-4">
                  <Languages className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium uppercase tracking-widest opacity-40">Запустите перевод для отображения списка</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
