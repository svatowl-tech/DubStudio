import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Type, Palette, LayoutTemplate, Image as ImageIcon, X, Sliders, Sparkles, Settings, Save } from 'lucide-react';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';

interface CoverGeneratorProps {
  currentEpisode: Episode | null;
}

const FONTS = [
  'Inter', 'Roboto', 'Oswald', 'Montserrat', 'Playfair Display',
  'Russo One', 'Caveat', 'Creepster', 'Press Start 2P', 'Impact', 'Arial', 'Times New Roman'
];

const DIVIDER_STYLES = [
  { id: 'none', label: 'Нет (только линия)' },
  { id: 'barbed-wire', label: 'Колючая проволока' },
  { id: 'stars', label: 'Звёзды' },
  { id: 'floral', label: 'Лесной узор (цветы/листья)' },
  { id: 'runic', label: 'Рунные символы' },
  { id: 'scifi', label: 'Sci-Fi / Неон' },
  { id: 'hearts', label: 'Сердца' },
];

export default function CoverGenerator({ currentEpisode }: CoverGeneratorProps) {
  // Активная вкладка в панели управления
  const [activeTab, setSettingsTab] = useState<'images' | 'text' | 'effects' | 'backing' | 'logo'>('images');

  // Флаг для рендера
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [watermarkImage, setWatermarkImage] = useState<HTMLImageElement | null>(null);
  
  // Текст серии и тайтла (поддержка переносов)
  const [title, setTitle] = useState(currentEpisode?.project?.title || 'ТАЙТЛ');
  const [episodeNumber, setEpisodeNumber] = useState(currentEpisode ? `${currentEpisode.number} серия` : '1 серия');
  
  // Шрифт и размеры базовые
  const [fontFamily, setFontFamily] = useState('Russo One');
  const [titleSize, setTitleSize] = useState(140);
  const [episodeSize, setEpisodeSize] = useState(80);
  const [titleColor, setTitleColor] = useState('#ffffff');
  const [episodeColor, setEpisodeColor] = useState('#ffffff');

  // Положение текста на холсте (в пикселях) и межстрочный интервал
  const [textX, setTextX] = useState(80);
  const [textY, setTextY] = useState(756);
  const [lineSpacing, setLineSpacing] = useState(1.25);
  
  // Стили шрифта
  const [fontBold, setFontBold] = useState(true);
  const [fontItalic, setFontItalic] = useState(false);
  const [textTransform, setTextTransform] = useState<'none' | 'uppercase'>('uppercase');

  // Параметры подложки (координаты углов в процентах от ширины)
  const [cutTopXPercent, setCutTopXPercent] = useState(15);
  const [cutBottomXPercent, setCutBottomXPercent] = useState(55);
  const [cutColor, setCutColor] = useState('#000000');
  const [cutOpacity, setCutOpacity] = useState(0.85);
  
  // Разделитель
  const [dividerStyle, setDividerStyle] = useState('barbed-wire');
  const [dividerColor, setDividerColor] = useState('#00e5ff');
  
  // Обводка текста
  const [strokeEnabled, setStrokeEnabled] = useState(true);
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(8);

  // Кастомные тени
  const [shadowColor, setShadowColor] = useState('#000000');
  const [shadowBlur, setShadowBlur] = useState(15);
  const [shadowOffsetX, setShadowOffsetX] = useState(4);
  const [shadowOffsetY, setShadowOffsetY] = useState(4);

  // Кастомное название в виде логотипа
  const [customTitleLogo, setCustomTitleLogo] = useState<HTMLImageElement | null>(null);
  const [logoX, setLogoX] = useState(25); // Положение по X на холсте в %
  const [logoY, setLogoY] = useState(75); // Положение по Y на холсте в %
  const [logoWidth, setLogoWidth] = useState(600); // Ширина логотипа в пикселях
  const [logoRotation, setLogoRotation] = useState(0); // Поворот логотипа в градусах

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(120); // default to 2 min
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Авто-синхронизация при смене серии
  useEffect(() => {
    if (currentEpisode) {
      let loadedTitle = currentEpisode.project?.title || 'ТАЙТЛ';
      
      // Сброс настроек до дефолтных на случай, если у нового проекта нет настроек
      setFontFamily('Russo One');
      setTitleSize(140);
      setEpisodeSize(80);
      setTitleColor('#ffffff');
      setEpisodeColor('#ffffff');
      setFontBold(true);
      setFontItalic(false);
      setTextTransform('uppercase');
      setCutTopXPercent(15);
      setCutBottomXPercent(55);
      setCutColor('#000000');
      setCutOpacity(0.85);
      setDividerStyle('barbed-wire');
      setDividerColor('#00e5ff');
      setStrokeEnabled(true);
      setStrokeColor('#000000');
      setStrokeWidth(8);
      setShadowColor('#000000');
      setShadowBlur(15);
      setShadowOffsetX(4);
      setShadowOffsetY(4);
      setLogoX(25);
      setLogoY(75);
      setLogoWidth(600);
      setLogoRotation(0);
      setTextX(80);
      setTextY(756);
      setLineSpacing(1.25);
      
      if (currentEpisode.project?.coverSettings) {
        try {
          const s = JSON.parse(currentEpisode.project.coverSettings);
          if (s.fontFamily) setFontFamily(s.fontFamily);
          if (s.titleSize) setTitleSize(s.titleSize);
          if (s.episodeSize) setEpisodeSize(s.episodeSize);
          if (s.titleColor) setTitleColor(s.titleColor);
          if (s.episodeColor) setEpisodeColor(s.episodeColor);
          if (s.fontBold !== undefined) setFontBold(s.fontBold);
          if (s.fontItalic !== undefined) setFontItalic(s.fontItalic);
          if (s.textTransform) setTextTransform(s.textTransform);
          if (s.cutTopXPercent !== undefined) setCutTopXPercent(s.cutTopXPercent);
          if (s.cutBottomXPercent !== undefined) setCutBottomXPercent(s.cutBottomXPercent);
          if (s.cutColor) setCutColor(s.cutColor);
          if (s.cutOpacity !== undefined) setCutOpacity(s.cutOpacity);
          if (s.dividerStyle) setDividerStyle(s.dividerStyle);
          if (s.dividerColor) setDividerColor(s.dividerColor);
          if (s.strokeEnabled !== undefined) setStrokeEnabled(s.strokeEnabled);
          if (s.strokeColor) setStrokeColor(s.strokeColor);
          if (s.strokeWidth !== undefined) setStrokeWidth(s.strokeWidth);
          if (s.shadowColor) setShadowColor(s.shadowColor);
          if (s.shadowBlur !== undefined) setShadowBlur(s.shadowBlur);
          if (s.shadowOffsetX !== undefined) setShadowOffsetX(s.shadowOffsetX);
          if (s.shadowOffsetY !== undefined) setShadowOffsetY(s.shadowOffsetY);
          if (s.logoX !== undefined) setLogoX(s.logoX);
          if (s.logoY !== undefined) setLogoY(s.logoY);
          if (s.logoWidth !== undefined) setLogoWidth(s.logoWidth);
          if (s.logoRotation !== undefined) setLogoRotation(s.logoRotation);
          if (s.textX !== undefined) setTextX(s.textX);
          if (s.textY !== undefined) setTextY(s.textY);
          if (s.lineSpacing !== undefined) setLineSpacing(s.lineSpacing);
          if (s.savedCustomTitle) {
            loadedTitle = s.savedCustomTitle;
          }
        } catch (e) {
          console.error("Failed to parse coverSettings", e);
        }
      }

      setTitle(loadedTitle);
      setEpisodeNumber(`${currentEpisode.number} серия`);

      if (currentEpisode.rawPath) {
        extractFrameFromVideo(currentEpisode.rawPath, videoTime);
      }
    }
  }, [currentEpisode?.id]);

  const saveProjectSettings = async () => {
    if (!currentEpisode?.project) return;
    const settings = {
        fontFamily, titleSize, episodeSize, titleColor, episodeColor,
        fontBold, fontItalic, textTransform,
        cutTopXPercent, cutBottomXPercent, cutColor, cutOpacity,
        dividerStyle, dividerColor,
        strokeEnabled, strokeColor, strokeWidth,
        shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY,
        logoX, logoY, logoWidth, logoRotation,
        textX, textY, lineSpacing,
        savedCustomTitle: title
    };
    try {
        const updatedProject = { ...currentEpisode.project, coverSettings: JSON.stringify(settings) };
        await ipcSafe.invoke('save-project', updatedProject);
        alert('Настройки обложки успешно сохранены для проекта!');
    } catch (e) {
        console.error("Failed to save coverSettings", e);
        alert('Ошибка при сохранении настроек.');
    }
  };

  // Загрузка сохраненного водяного знака
  useEffect(() => {
    const savedWatermark = localStorage.getItem('anime_dub_watermark');
    if (savedWatermark) {
      const img = new window.Image();
      img.src = savedWatermark;
      img.onload = () => setWatermarkImage(img);
    }
  }, []);

  const extractFrameFromVideo = (videoPath: string, timeSec: number) => {
    if (!videoRef.current) {
      videoRef.current = document.createElement('video');
      videoRef.current.crossOrigin = 'anonymous';
      
      videoRef.current.onloadedmetadata = () => {
        setVideoDuration(videoRef.current?.duration || 0);
      };

      videoRef.current.onseeked = () => {
        const video = videoRef.current;
        if (!video) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          const img = new window.Image();
          img.src = dataUrl;
          img.onload = () => setBgImage(img);
        }
      };

      videoRef.current.onerror = () => {
        console.warn("Could not auto-extract frame from video path:", videoPath);
      };
    }
    
    let src = videoPath;
    if (!src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('blob:')) {
        src = `file://${src}`;
    }
    if (videoRef.current.src !== src) {
      videoRef.current.src = src;
    }
    videoRef.current.currentTime = timeSec;
  };

  const handleVideoTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setVideoTime(time);
    if (currentEpisode?.rawPath) {
      extractFrameFromVideo(currentEpisode.rawPath, time);
    }
  };

  useEffect(() => {
    // Подгрузка шрифтов из Google Web Fonts
    const loadFont = async (font: string) => {
      try {
        const url = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;700&display=swap`;
        const link = document.createElement('link');
        link.href = url;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      } catch (e) {
        console.error("Font loading error:", e);
      }
    };
    if (fontFamily && !['Arial', 'Times New Roman', 'Impact'].includes(fontFamily)) {
      loadFont(fontFamily);
    }
  }, [fontFamily]);

  const drawDividerPattern = (
    ctx: CanvasRenderingContext2D, 
    x1: number, y1: number, 
    x2: number, y2: number, 
    style: string, 
    color: string
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    
    // Draw base line
    if (style !== 'none') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    const step = 60; // spacing between pattern elements
    const count = Math.floor(length / step);
    
    for (let i = 1; i < count; i++) {
      const x = i * step;
      ctx.save();
      ctx.translate(x, 0);
      
      switch (style) {
        case 'barbed-wire':
          ctx.beginPath();
          ctx.moveTo(-10, -10);
          ctx.lineTo(10, 10);
          ctx.moveTo(10, -10);
          ctx.lineTo(-10, 10);
          ctx.stroke();
          // Wrap
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'stars':
          const drawStar = (cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) => {
            let rot = Math.PI / 2 * 3;
            let currentX = cx;
            let currentY = cy;
            let stepRotation = Math.PI / spikes;
            ctx.beginPath();
            ctx.moveTo(cx, cy - outerRadius);
            for (let j = 0; j < spikes; j++) {
              currentX = cx + Math.cos(rot) * outerRadius;
              currentY = cy + Math.sin(rot) * outerRadius;
              ctx.lineTo(currentX, currentY);
              rot += stepRotation;
              currentX = cx + Math.cos(rot) * innerRadius;
              currentY = cy + Math.sin(rot) * innerRadius;
              ctx.lineTo(currentX, currentY);
              rot += stepRotation;
            }
            ctx.lineTo(cx, cy - outerRadius);
            ctx.closePath();
            ctx.fill();
          };
          drawStar(0, 0, 4, 15, 4);
          ctx.shadowBlur = 10;
          ctx.shadowColor = color;
          drawStar(0, 0, 4, 10, 2);
          ctx.shadowBlur = 0;
          break;
        case 'floral':
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(10, -20, 20, -5);
          ctx.quadraticCurveTo(5, -10, 0, 0);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(10, 20, 20, 5);
          ctx.quadraticCurveTo(5, 10, 0, 0);
          ctx.fill();
          break;
        case 'runic':
          ctx.beginPath();
          ctx.moveTo(-5, -15);
          ctx.lineTo(5, -5);
          ctx.lineTo(-5, 5);
          ctx.lineTo(5, 15);
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.font = '20px sans-serif';
          ctx.fillText(['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ'][i%7], -10, 0);
          break;
        case 'scifi':
          ctx.shadowBlur = 15;
          ctx.shadowColor = color;
          ctx.fillRect(-15, -4, 30, 8);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-10, -2, 20, 4);
          ctx.shadowBlur = 0;
          ctx.fillStyle = color;
          break;
        case 'hearts':
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(0, -5, -5, -15, -15, -15);
          ctx.bezierCurveTo(-25, -15, -25, -2.5, -25, -2.5);
          ctx.bezierCurveTo(-25, 10, -10, 15, 0, 25);
          ctx.bezierCurveTo(10, 15, 25, 10, 25, -2.5);
          ctx.bezierCurveTo(25, -2.5, 25, -15, 15, -15);
          ctx.bezierCurveTo(5, -15, 0, -5, 0, 0);
          ctx.fill();
          break;
      }
      ctx.restore();
    }
    
    ctx.restore();
  };

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw BG Image
    if (bgImage) {
      const scale = Math.max(canvas.width / bgImage.width, canvas.height / bgImage.height);
      const w = bgImage.width * scale;
      const h = bgImage.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
      ctx.drawImage(bgImage, x, y, w, h);
    } else {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '50px Inter, sans-serif';
      ctx.fillStyle = '#4b5563';
      ctx.textAlign = 'center';
      ctx.fillText('Загрузите фон или выберите кадр', canvas.width / 2, canvas.height / 2);
    }

    // Convert hex to rgb for opacity
    const hexToRgb = (hex: string) => {
      let r = 0, g = 0, b = 0;
      if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
      }
      return `${r},${g},${b}`;
    };

    // Настраиваемая диагональная подложка (угол и положение)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const topX = canvas.width * (cutTopXPercent / 100);
    const bottomX = canvas.width * (cutBottomXPercent / 100);
    ctx.lineTo(topX, 0);
    ctx.lineTo(bottomX, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = `rgba(${hexToRgb(cutColor)}, ${cutOpacity})`;
    ctx.fill();

    // Линия-разделитель узора
    drawDividerPattern(ctx, topX, 0, bottomX, canvas.height, dividerStyle, dividerColor);

     // Базовые параметры текста
    const textCenterY = textY;
    const textCenterX = textX;
 
     // Стилизация шрифта
     const fontModifier = `${fontItalic ? 'italic ' : ''}${fontBold ? 'bold ' : ''}`;
 
     // Настройка кастомных теней
     ctx.shadowColor = shadowColor;
     ctx.shadowBlur = shadowBlur;
     ctx.shadowOffsetX = shadowOffsetX;
     ctx.shadowOffsetY = shadowOffsetY;
 
     // 1. Отрисовка номера серии
     ctx.textAlign = 'left';
     ctx.textBaseline = 'bottom';
     ctx.font = `${fontModifier}${episodeSize}px "${fontFamily}", sans-serif`;
     ctx.fillStyle = episodeColor;
     
     const formattedEpisode = textTransform === 'uppercase' ? episodeNumber.toUpperCase() : episodeNumber;
     ctx.fillText(formattedEpisode, textCenterX, textCenterY - 20);
     
     if (strokeEnabled) {
       ctx.save();
       ctx.shadowColor = 'transparent'; // выключаем тень для обводки
       ctx.strokeStyle = strokeColor;
       ctx.lineWidth = strokeWidth;
       ctx.strokeText(formattedEpisode, textCenterX, textCenterY - 20);
       ctx.restore();
     }
 
     // 2. Отрисовка тайтла с поддержкой ПЕРЕНОСА СТРОК
     ctx.textBaseline = 'top';
     ctx.font = `${fontModifier}${titleSize}px "${fontFamily}", sans-serif`;
     ctx.fillStyle = titleColor;
 
     const rawTitle = textTransform === 'uppercase' ? title.toUpperCase() : title;
     const titleLines = rawTitle.split('\n');
     let currentY = textCenterY + 15;
 
     titleLines.forEach((line) => {
       ctx.fillText(line, textCenterX, currentY);
       if (strokeEnabled) {
         ctx.save();
         ctx.shadowColor = 'transparent'; // выключаем тень для обводки
         ctx.strokeStyle = strokeColor;
         ctx.lineWidth = strokeWidth;
         ctx.strokeText(line, textCenterX, currentY);
         ctx.restore();
       }
       // Перемещаем Y на высоту шрифта с небольшим межстрочным интервалом
       currentY += titleSize * lineSpacing;
     });
 
     // Сброс тени перед отрисовкой логотипов
     ctx.shadowBlur = 0;
     ctx.shadowOffsetX = 0;
     ctx.shadowOffsetY = 0;
 
     // 3. Рисуем кастомный логотип названия, если загружен
     if (customTitleLogo) {
       ctx.save();
       const lx = canvas.width * (logoX / 100);
       const ly = canvas.height * (logoY / 100);
       // Переносим контекст в точку центра логотипа
       ctx.translate(lx, ly);
       ctx.rotate(logoRotation * Math.PI / 180);
       
       const w = logoWidth;
       const h = logoWidth * (customTitleLogo.height / customTitleLogo.width);
       
       ctx.drawImage(customTitleLogo, -w / 2, -h / 2, w, h);
       ctx.restore();
     }
 
     // 4. Отрисовка водяного знака студии
     if (watermarkImage) {
       const maxW = 350;
       const maxH = 250;
       const scale = Math.min(maxW / watermarkImage.width, maxH / watermarkImage.height);
       const w = watermarkImage.width * scale;
       const h = watermarkImage.height * scale;
       const p = 50;
       ctx.drawImage(watermarkImage, canvas.width - w - p, p, w, h);
     }
   }, [
     bgImage, watermarkImage, title, episodeNumber, fontFamily, titleSize, episodeSize, 
     titleColor, episodeColor, cutColor, cutOpacity, dividerStyle, dividerColor, 
     shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY, cutTopXPercent, cutBottomXPercent,
     fontBold, fontItalic, textTransform, strokeEnabled, strokeColor, strokeWidth,
     customTitleLogo, logoX, logoY, logoWidth, logoRotation,
     textX, textY, lineSpacing
   ]);

  useEffect(() => {
    document.fonts.ready.then(() => {
      renderCanvas();
    });
    const t = setTimeout(renderCanvas, 200);
    return () => clearTimeout(t);
  }, [renderCanvas]);

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>, 
    setter: React.Dispatch<React.SetStateAction<HTMLImageElement | null>>, 
    isWatermark?: boolean
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = url;
      img.onload = () => {
        setter(img);
        if (isWatermark) {
          // Сохраняем водяной знак в localStorage
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            try {
              localStorage.setItem('anime_dub_watermark', canvas.toDataURL('image/png'));
            } catch (err) {
              console.warn("Could not save watermark to localStorage", err);
            }
          }
        }
        renderCanvas();
      };
    }
  };

  const removeWatermark = () => {
    setWatermarkImage(null);
    localStorage.removeItem('anime_dub_watermark');
    renderCanvas();
  };

  const downloadImage = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    // Очищаем имя от спецсимволов и переносов для скачивания
    const safeTitle = title.replace(/\n/g, '_').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_ -]/g, '');
    a.download = `Cover_${safeTitle}_${episodeNumber.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '')}.png`;
    a.click();
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = url;
      img.onload = () => {
        setCustomTitleLogo(img);
        renderCanvas();
      };
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6" id="cover_generator_root">
      <div className="flex justify-between items-center bg-neutral-900 p-4 rounded-xl border border-neutral-800" id="cover_head">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <ImageIcon className="w-6 h-6 text-pink-500" />
          Генератор мобильных обложек
        </h1>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 min-h-0" id="cover_body_grid">
        {/* Панель Управления */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 overflow-y-auto flex flex-col lg:col-span-1" id="cover_controls">
          
          {/* Вкладки Редактора */}
          <div className="flex bg-neutral-950 p-1 rounded-lg border border-neutral-800 gap-1 shrink-0 mb-4" id="cover_tabs">
            <button 
              id="tab_images"
              onClick={() => setSettingsTab('images')} 
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${activeTab === 'images' ? 'bg-blue-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'}`}
            >
              <ImageIcon className="w-4 h-4" />
              Фон/Вода
            </button>
            <button 
              id="tab_text"
              onClick={() => setSettingsTab('text')} 
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${activeTab === 'text' ? 'bg-blue-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'}`}
            >
              <Type className="w-4 h-4" />
              Текст
            </button>
            <button 
              id="tab_effects"
              onClick={() => setSettingsTab('effects')} 
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${activeTab === 'effects' ? 'bg-blue-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'}`}
            >
              <Sparkles className="w-4 h-4" />
              Эффекты
            </button>
            <button 
              id="tab_backing"
              onClick={() => setSettingsTab('backing')} 
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${activeTab === 'backing' ? 'bg-blue-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'}`}
            >
              <Palette className="w-4 h-4" />
              Срез
            </button>
            <button 
              id="tab_logo"
              onClick={() => setSettingsTab('logo')} 
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${activeTab === 'logo' ? 'bg-blue-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'}`}
            >
              <LayoutTemplate className="w-4 h-4" />
              Лого
            </button>
          </div>

          <div className="flex-1 space-y-4" id="tab_content_wrapper">
            
            {/* ТАБ 1: ИЗОБРАЖЕНИЯ (ФОН И ВОДЯНОЙ ЗНАК) */}
            {activeTab === 'images' && (
              <div className="space-y-4 fade-in" id="panel_images">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-blue-400" />
                  Управление медиа-файлами
                </h3>
                
                <div>
                  <label className="block text-xs text-neutral-400 mb-2 font-medium">Загрузить фон (скриншот)</label>
                  <label id="upload_bg_label" className="w-full h-24 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-blue-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer">
                    <input id="input_upload_bg" type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, setBgImage)} />
                    <ImageIcon className="w-6 h-6 text-neutral-500 mb-1" />
                    <span className="text-xs text-neutral-300">Выбрать файл (.jpg, .png)</span>
                  </label>
                  {bgImage && !currentEpisode?.rawPath && <p className="text-xs text-green-400 mt-2 font-medium">✓ Кастомный фон загружен успешно</p>}

                  {currentEpisode?.rawPath && (
                    <div className="mt-4 bg-neutral-950 p-3 rounded-lg border border-neutral-800" id="video_ кадр_сек">
                      <label className="block text-xs text-neutral-400 flex justify-between font-medium">
                        <span>Кадр из видео:</span>
                        <span className="text-blue-400 font-mono font-bold">
                          {Math.floor(videoTime / 60)}:{Math.floor(videoTime % 60).toString().padStart(2, '0')}
                        </span>
                      </label>
                      <input 
                        id="video_time_range"
                        type="range" 
                        min="0" 
                        max={videoDuration || 1400} 
                        value={videoTime} 
                        onChange={handleVideoTimeChange} 
                        className="w-full mt-2 accent-blue-500 cursor-pointer" 
                      />
                      <p className="text-[10px] text-neutral-500 mt-1 leading-tight">Перетащите ползунок для авто-извлечения кадра из оригинала серии</p>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <label className="block text-xs text-neutral-400 mb-2 font-medium">Водяной знак студии (копирайт)</label>
                  <label id="upload_watermark_label" className="w-full h-16 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-pink-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer">
                    <input id="input_upload_watermark" type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, setWatermarkImage, true)} />
                    <span className="text-xs text-neutral-300">Загрузить логотип копирайта</span>
                  </label>
                  {watermarkImage && (
                    <div className="mt-2 flex items-center justify-between text-xs bg-neutral-950 p-2 rounded border border-neutral-800" id="watermark_info">
                      <span className="text-neutral-400 truncate">Лого: {watermarkImage.width}x{watermarkImage.height} px</span>
                      <button id="btn_remove_watermark" onClick={removeWatermark} title="Удалить" className="text-red-400 hover:text-red-300 p-1 transition-colors">
                        <X className="w-4 h-4"/>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ТАБ 2: ТЕКСТ И ШРИФТЫ */}
            {activeTab === 'text' && (
              <div className="space-y-4 fade-in" id="panel_text">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Type className="w-4 h-4 text-pink-400" />
                  Конфигурация типографики
                </h3>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1 font-medium">Семейство шрифтов</label>
                  <select 
                    id="font_family_select"
                    value={fontFamily} 
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500 font-medium"
                  >
                    {FONTS.map(font => <option key={font} value={font} style={{fontFamily: font}}>{font}</option>)}
                  </select>
                </div>

                {/* Настройки начертания */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="text_style_modifiers">
                  <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider mb-1">Стили начертания</span>
                  <div className="flex gap-2">
                    <button 
                      id="btn_font_bold"
                      onClick={() => setFontBold(!fontBold)}
                      className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors flex-1 ${fontBold ? 'bg-pink-600 text-white border-pink-500' : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'}`}
                    >
                      B (Жирный)
                    </button>
                    <button 
                      id="btn_font_italic"
                      onClick={() => setFontItalic(!fontItalic)}
                      className={`px-3 py-1.5 rounded text-xs italic font-bold border transition-colors flex-1 ${fontItalic ? 'bg-pink-600 text-white border-pink-500' : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'}`}
                    >
                      I (Курсив)
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      id="btn_text_transform_upper"
                      onClick={() => setTextTransform(textTransform === 'uppercase' ? 'none' : 'uppercase')}
                      className={`px-3 py-1.5 rounded text-[11px] font-bold uppercase border transition-colors flex-1 ${textTransform === 'uppercase' ? 'bg-pink-600 text-white border-pink-500' : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'}`}
                    >
                      TT (ВСЕ ЗАГЛАВНЫЕ)
                    </button>
                  </div>
                </div>

                {/* Поле номера серии */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="episode_field_group">
                  <div className="flex justify-between items-center text-xs text-neutral-400">
                    <span className="font-medium">Номер / Текст серии</span>
                    <span className="font-mono text-pink-400 font-bold">{episodeSize}px</span>
                  </div>
                  <input 
                    id="input_episode_number"
                    type="text" 
                    value={episodeNumber} 
                    onChange={(e) => setEpisodeNumber(e.target.value)} 
                    className="w-full bg-neutral-900 border border-neutral-800 roundedpx px-3 py-1.5 text-white text-xs outline-none focus:border-blue-500 rounded" 
                  />
                  <input 
                    id="range_episode_size"
                    type="range" 
                    min="30" 
                    max="180" 
                    value={episodeSize} 
                    onChange={(e) => setEpisodeSize(Number(e.target.value))} 
                    className="w-full accent-pink-500 cursor-pointer" 
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] text-neutral-400 shrink-0">Цвет:</span>
                    <input 
                      id="color_picker_episode"
                      type="color" 
                      value={episodeColor} 
                      onChange={(e) => setEpisodeColor(e.target.value)} 
                      className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer" 
                    />
                    <input 
                      id="input_episode_color_hex"
                      type="text" 
                      value={episodeColor} 
                      onChange={(e) => setEpisodeColor(e.target.value)} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono" 
                    />
                  </div>
                </div>

                {/* Поле названия тайтла (Многострочное) */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="title_field_group">
                  <div className="flex justify-between items-center text-xs text-neutral-400">
                    <span className="font-medium">Название тайтла (Мультистрок)</span>
                    <span className="font-mono text-pink-400 font-bold">{titleSize}px</span>
                  </div>
                  <textarea 
                    id="textarea_title"
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)} 
                    rows={3}
                    placeholder="Введите название тайтла... Нажимайте Enter для новой строки"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-white text-xs outline-none focus:border-blue-500 resize-none leading-normal font-medium" 
                  />
                  <input 
                    id="range_title_size"
                    type="range" 
                    min="40" 
                    max="300" 
                    value={titleSize} 
                    onChange={(e) => setTitleSize(Number(e.target.value))} 
                    className="w-full accent-pink-500 cursor-pointer" 
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] text-neutral-400 shrink-0">Цвет:</span>
                    <input 
                      id="color_picker_title"
                      type="color" 
                      value={titleColor} 
                      onChange={(e) => setTitleColor(e.target.value)} 
                      className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer" 
                    />
                    <input 
                      id="input_title_color_hex"
                      type="text" 
                      value={titleColor} 
                      onChange={(e) => setTitleColor(e.target.value)} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono" 
                    />
                  </div>
                </div>

                {/* Настройка положения текста и межстрочного интервала */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="text_positioning_group">
                  <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">Положение текста и переносы</span>
                  
                  {/* Горизонтальное положение (X) */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs text-neutral-400">
                      <span>Смещение по X</span>
                      <span className="font-mono text-pink-400 font-bold">{textX}px</span>
                    </div>
                    <input 
                      id="range_text_x"
                      type="range" 
                      min="0" 
                      max="1920" 
                      value={textX} 
                      onChange={(e) => setTextX(Number(e.target.value))} 
                      className="w-full accent-pink-500 cursor-pointer" 
                    />
                  </div>

                  {/* Вертикальное положение (Y) */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs text-neutral-400">
                      <span>Смещение по Y</span>
                      <span className="font-mono text-pink-400 font-bold">{textY}px</span>
                    </div>
                    <input 
                      id="range_text_y"
                      type="range" 
                      min="0" 
                      max="1080" 
                      value={textY} 
                      onChange={(e) => setTextY(Number(e.target.value))} 
                      className="w-full accent-pink-500 cursor-pointer" 
                    />
                  </div>

                  {/* Межстрочный интервал (Line Spacing) */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs text-neutral-400">
                      <span>Межстрочный интервал</span>
                      <span className="font-mono text-pink-400 font-bold">{lineSpacing}x</span>
                    </div>
                    <input 
                      id="range_text_line_spacing"
                      type="range" 
                      min="0.5" 
                      max="2.5" 
                      step="0.05"
                      value={lineSpacing} 
                      onChange={(e) => setLineSpacing(Number(e.target.value))} 
                      className="w-full accent-pink-500 cursor-pointer" 
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ТАБ 3: ЭФФЕКТЫ (ОБВОДКА И ТЕНЬ) */}
            {activeTab === 'effects' && (
              <div className="space-y-4 fade-in" id="panel_effects">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Улучшенная стилизация и эффекты
                </h3>

                {/* Обводка текста */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="stroke_settings">
                  <div className="flex items-center justify-between">
                    <label htmlFor="checkbox_stroke_enabled" className="text-xs text-neutral-300 font-semibold select-none cursor-pointer">Включить обводку текста</label>
                    <input 
                      id="checkbox_stroke_enabled"
                      type="checkbox" 
                      checked={strokeEnabled} 
                      onChange={(e) => setStrokeEnabled(e.target.checked)} 
                      className="w-4 h-4 rounded accent-blue-500 cursor-pointer" 
                    />
                  </div>

                  {strokeEnabled && (
                    <div className="space-y-2 pt-1 border-t border-neutral-900">
                      <div className="flex items-center justify-between text-[11px] text-neutral-400">
                        <span>Толщина обводки</span>
                        <span className="font-mono font-bold text-blue-400">{strokeWidth}px</span>
                      </div>
                      <input 
                        id="range_stroke_width"
                        type="range" 
                        min="1" 
                        max="30" 
                        value={strokeWidth} 
                        onChange={(e) => setStrokeWidth(Number(e.target.value))} 
                        className="w-full accent-blue-500 cursor-pointer" 
                      />

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-neutral-400 shrink-0">Цвет обводки:</span>
                        <input 
                          id="color_picker_stroke"
                          type="color" 
                          value={strokeColor} 
                          onChange={(e) => setStrokeColor(e.target.value)} 
                          className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer" 
                        />
                        <input 
                          id="input_stroke_color_hex"
                          type="text" 
                          value={strokeColor} 
                          onChange={(e) => setStrokeColor(e.target.value)} 
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono" 
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Конфигурация тени */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="shadow_settings">
                  <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">Параметры объемной тени</span>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Размытие тени (Blur)</span>
                      <span className="font-mono text-purple-400 font-bold">{shadowBlur}px</span>
                    </div>
                    <input 
                      id="range_shadow_blur"
                      type="range" 
                      min="0" 
                      max="60" 
                      value={shadowBlur} 
                      onChange={(e) => setShadowBlur(Number(e.target.value))} 
                      className="w-full accent-purple-500 cursor-pointer" 
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Смещение X</span>
                      <span className="font-mono text-purple-400 font-bold">{shadowOffsetX}px</span>
                    </div>
                    <input 
                      id="range_shadow_offset_x"
                      type="range" 
                      min="-40" 
                      max="40" 
                      value={shadowOffsetX} 
                      onChange={(e) => setShadowOffsetX(Number(e.target.value))} 
                      className="w-full accent-purple-200 cursor-pointer" 
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Смещение Y</span>
                      <span className="font-mono text-purple-400 font-bold">{shadowOffsetY}px</span>
                    </div>
                    <input 
                      id="range_shadow_offset_y"
                      type="range" 
                      min="-40" 
                      max="40" 
                      value={shadowOffsetY} 
                      onChange={(e) => setShadowOffsetY(Number(e.target.value))} 
                      className="w-full accent-purple-200 cursor-pointer" 
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-neutral-900">
                    <span className="text-[10px] text-neutral-400 shrink-0">Цвет тени:</span>
                    <input 
                      id="color_picker_shadow"
                      type="color" 
                      value={shadowColor.startsWith('rgba') ? '#000000' : shadowColor} 
                      onChange={(e) => setShadowColor(e.target.value)} 
                      className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer" 
                    />
                    <input 
                      id="input_shadow_color_hex"
                      type="text" 
                      value={shadowColor} 
                      onChange={(e) => setShadowColor(e.target.value)} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono" 
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ТАБ 4: СРЕЗ / ПОДЛОЖКА */}
            {activeTab === 'backing' && (
              <div className="space-y-4 fade-in" id="panel_backing">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-cyan-400" />
                  Параметры среза (подложки)
                </h3>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1 font-medium">Стиль узора-разделителя</label>
                  <select 
                    id="divider_style_select"
                    value={dividerStyle} 
                    onChange={(e) => setDividerStyle(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500 font-medium"
                  >
                    {DIVIDER_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>

                {/* Настройка положения, угла и размера подложки */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="backing_angles">
                  <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">Угол и Положение подложки</span>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Верхняя координата (Top-X)</span>
                      <span className="font-mono text-cyan-400 font-bold">{cutTopXPercent}%</span>
                    </div>
                    <input 
                      id="range_cut_top_x"
                      type="range" 
                      min="-20" 
                      max="150" 
                      value={cutTopXPercent} 
                      onChange={(e) => setCutTopXPercent(Number(e.target.value))} 
                      className="w-full accent-cyan-500 cursor-pointer" 
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Нижняя координата (Bottom-X)</span>
                      <span className="font-mono text-cyan-400 font-bold">{cutBottomXPercent}%</span>
                    </div>
                    <input 
                      id="range_cut_bottom_x"
                      type="range" 
                      min="-20" 
                      max="150" 
                      value={cutBottomXPercent} 
                      onChange={(e) => setCutBottomXPercent(Number(e.target.value))} 
                      className="w-full accent-cyan-500 cursor-pointer" 
                    />
                  </div>
                  
                  <p className="text-[10px] text-neutral-500 leading-tight">
                    *Сдвиг обеих координат в одну сторону изменит положение подложки, а изменение разницы между ними изменит угол наклона.
                  </p>
                </div>

                {/* Настройки цвета подложки и разделителя */}
                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="backing_colors">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-neutral-400 font-bold uppercase">Цвет разделителя</label>
                    <div className="flex gap-2 items-center">
                      <input 
                        id="color_picker_divider"
                        type="color" 
                        value={dividerColor} 
                        onChange={(e) => setDividerColor(e.target.value)} 
                        className="w-7 h-7 rounded bg-transparent cursor-pointer" 
                      />
                      <input 
                        id="input_divider_color_hex"
                        type="text" 
                        value={dividerColor} 
                        onChange={(e) => setDividerColor(e.target.value)} 
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-300 font-mono" 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-neutral-900">
                    <div className="flex justify-between items-center">
                      <label className="block text-[11px] text-neutral-400 font-bold uppercase">Цвет подложки</label>
                      <span className="text-[11px] text-neutral-400 font-bold font-mono text-cyan-400">{Math.round(cutOpacity * 100)}%</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input 
                        id="color_picker_cut"
                        type="color" 
                        value={cutColor} 
                        onChange={(e) => setCutColor(e.target.value)} 
                        className="w-7 h-7 rounded bg-transparent cursor-pointer" 
                      />
                      <input 
                        id="range_cut_opacity"
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05" 
                        value={cutOpacity} 
                        onChange={(e) => setCutOpacity(parseFloat(e.target.value))} 
                        className="w-full accent-cyan-500 cursor-pointer" 
                      />
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* ТАБ 5: ЛОГОТИП НАЗВАНИЯ */}
            {activeTab === 'logo' && (
              <div className="space-y-4 fade-in" id="panel_logo">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-emerald-400" />
                  Логотип / Кастомное название
                </h3>

                <div className="space-y-3">
                  <label className="block text-xs text-neutral-400 font-medium">Загрузить лого-название в PNG (на прозрачном фоне)</label>
                  <label id="upload_logo_label" className="w-full h-18 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-emerald-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer">
                    <input id="input_upload_logo" type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    <Upload className="w-5 h-5 text-neutral-500 mb-1" />
                    <span className="text-xs text-neutral-300">Выбрать PNG логотип</span>
                  </label>
                  
                  {customTitleLogo && (
                    <div className="mt-2 text-xs bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="logo_loaded_controls">
                      <div className="flex items-center justify-between text-neutral-300 pb-2 border-b border-neutral-900" id="logo_summary">
                        <span className="font-medium truncate text-emerald-400">✓ Логотип: {customTitleLogo.width}x{customTitleLogo.height}px</span>
                        <button id="btn_remove_logo" onClick={() => setCustomTitleLogo(null)} title="Удалить" className="text-red-400 hover:text-red-300 p-1">
                          <X className="w-4 h-4"/>
                        </button>
                      </div>

                      {/* Тонкие настройки размера, угла и смещения логотипа на холсте */}
                      <div className="space-y-3" id="logo_adjustments">
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-neutral-400">
                            <span>Положение X</span>
                            <span className="font-mono text-emerald-400 font-bold">{logoX}%</span>
                          </div>
                          <input 
                            id="range_logo_x"
                            type="range" 
                            min="-20" 
                            max="120" 
                            value={logoX} 
                            onChange={(e) => setLogoX(Number(e.target.value))} 
                            className="w-full accent-emerald-500 cursor-pointer" 
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-neutral-400">
                            <span>Положение Y</span>
                            <span className="font-mono text-emerald-400 font-bold">{logoY}%</span>
                          </div>
                          <input 
                            id="range_logo_y"
                            type="range" 
                            min="-30" 
                            max="130" 
                            value={logoY} 
                            onChange={(e) => setLogoY(Number(e.target.value))} 
                            className="w-full accent-emerald-500 cursor-pointer" 
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-neutral-400">
                            <span>Ширина ( px )</span>
                            <span className="font-mono text-emerald-400 font-bold">{logoWidth}px</span>
                          </div>
                          <input 
                            id="range_logo_width"
                            type="range" 
                            min="100" 
                            max="1500" 
                            value={logoWidth} 
                            onChange={(e) => setLogoWidth(Number(e.target.value))} 
                            className="w-full accent-emerald-500 cursor-pointer" 
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-neutral-400">
                            <span>Угол поворота</span>
                            <span className="font-mono text-emerald-400 font-bold">{logoRotation}°</span>
                          </div>
                          <input 
                            id="range_logo_rotation"
                            type="range" 
                            min="-180" 
                            max="180" 
                            value={logoRotation} 
                            onChange={(e) => setLogoRotation(Number(e.target.value))} 
                            className="w-full accent-emerald-500 cursor-pointer" 
                          />
                        </div>

                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Секция Предпросмотра */}
        <div className="lg:col-span-2 xl:col-span-3 bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col gap-4 overflow-hidden" id="cover_preview">
          <h2 className="text-lg font-semibold text-white flex justify-between items-center" id="preview_header">
            Предпросмотр результатов
            <span className="text-xs bg-neutral-800 text-neutral-400 px-2 py-1 rounded font-mono">1920x1080px</span>
          </h2>
          <div className="flex-1 bg-black rounded-lg border border-neutral-800 overflow-hidden flex items-center justify-center relative shadow-inner" id="canvas_container">
            <canvas ref={canvasRef} width={1920} height={1080} className="max-w-full max-h-full object-contain shadow-2xl" id="generator_canvas" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
            <button 
              id="btn_save_settings"
              onClick={saveProjectSettings}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mt-auto shadow-lg cursor-pointer"
              title="Сохранить эти настройки штифтов, теней, разделителей как шаблон для проекта"
            >
              <Save className="w-5 h-5" />
              Сохранить шаблон для проекта
            </button>
            <button 
              id="btn_download_cover"
              onClick={downloadImage}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mt-auto shadow-lg cursor-pointer"
            >
              <Download className="w-5 h-5" />
              Экспортировать (PNG, HD)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
