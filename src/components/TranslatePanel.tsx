import React, { useState } from "react";
import { Languages, FileText, Loader2, RefreshCw, Save } from "lucide-react";
import { ipcRenderer } from "../lib/ipc";
import { Episode } from "../types";

interface TranslatePanelProps {
  currentEpisode: Episode | null;
}

export default function TranslatePanel({ currentEpisode }: TranslatePanelProps) {
  const [sourceLang, setSourceLang] = useState("en");
  const [destLang, setDestLang] = useState("ru");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [translatedLines, setTranslatedLines] = useState<any[]>([]);

  const handleTranslate = async () => {
    if (!currentEpisode?.subPath) {
      setStatus("Файл субтитров не найден.");
      return;
    }

    setIsProcessing(true);
    setStatus("Загрузка и перевод субтитров...");

    try {
      // 1. Get raw subtitles
      const data = await ipcRenderer.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines = data.lines || data;
      
      // 2. Translate lines
      const newTranslatedLines = [];
      for (const line of lines) {
        if (line.text && line.text.trim()) {
          const result = await ipcRenderer.invoke('translate-text', {
            text: line.text,
            sourceLang,
            destLang
          });
          newTranslatedLines.push({ ...line, text: result['destination-text'] });
        } else {
          newTranslatedLines.push(line);
        }
      }

      setTranslatedLines(newTranslatedLines);
      setStatus("Перевод завершен! Нажмите 'Сохранить', чтобы применить изменения.");
    } catch (error) {
      console.error("Translation error:", error);
      setStatus("Ошибка при переводе.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!currentEpisode?.subPath || translatedLines.length === 0) return;
    
    setIsProcessing(true);
    setStatus("Сохранение перевода...");
    
    try {
      await ipcRenderer.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines
      });
      setStatus("Перевод сохранен!");
    } catch (error) {
      console.error("Save error:", error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2">
        <Languages className="w-5 h-5 text-indigo-400" />
        Перевод субтитров
      </h2>
      
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm text-neutral-400 mb-1">Исходный язык</label>
            <input type="text" value={sourceLang} onChange={e => setSourceLang(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 text-white rounded-lg px-3 py-2" />
          </div>
          <div className="flex-1">
            <label className="block text-sm text-neutral-400 mb-1">Язык перевода</label>
            <input type="text" value={destLang} onChange={e => setDestLang(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 text-white rounded-lg px-3 py-2" />
          </div>
        </div>
        
        <div className="flex gap-4">
          <button
            onClick={handleTranslate}
            disabled={isProcessing || !currentEpisode?.subPath}
            className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            {isProcessing ? "Перевод..." : "Запустить перевод"}
          </button>
          
          <button
            onClick={handleSave}
            disabled={isProcessing || translatedLines.length === 0}
            className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            Сохранить
          </button>
        </div>
        
        {status && <p className="text-sm text-neutral-400 text-center">{status}</p>}
      </div>
    </div>
  );
}
