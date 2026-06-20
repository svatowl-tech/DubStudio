const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');

const SIGN_KEYWORDS = ["НАДПИСЬ", "Надпись", "надпись", "НАДПИСИ", "Надписи", "надписи", "SIGNS", "Signs", "signs", "SIGN", "Sign", "sign", "TEXT", "Text", "text", "ТЕКСТ", "Текст", "текст", '"текст"'];

// Cache for parsed subtitles to avoid memory spikes when multiple components request the same file concurrently
const subtitleCache = new Map();
const groupKeywords = ["гуры", "все"];

function assTimeToSrtTime(assTime) {
  const parts = assTime.split(':');
  if (parts.length !== 3) return '00:00:00,000';
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  const sParts = parts[2].split('.');
  const s = sParts[0].padStart(2, '0');
  const ms = (sParts[1] || '00').padEnd(3, '0').substring(0, 3);
  return `${h}:${m}:${s},${ms}`;
}

function cleanAssText(text) {
  return text.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n');
}

/**
 * Вспомогательная функция для парсинга строки Dialogue в ASS файле.
 */
function parseDialogueLine(line, formatParts) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const nameIndex = formatParts.indexOf('Name');
  const textIndex = formatParts.indexOf('Text');
  const startIndex = formatParts.indexOf('Start');
  const endIndex = formatParts.indexOf('End');
  const styleIndex = formatParts.indexOf('Style');
  const totalFields = formatParts.length;

  if (nameIndex === -1 || textIndex === -1) return null;

  const data = line.substring(colonIndex + 1);
  const allParts = data.split(',');
  
  // Standard ASS parsing: split by totalFields - 1 commas
  const standardParts = allParts.slice(0, totalFields - 1);
  standardParts.push(allParts.slice(totalFields - 1).join(','));

  return {
    start: standardParts[startIndex]?.trim() || '',
    end: standardParts[endIndex]?.trim() || '',
    style: standardParts[styleIndex]?.trim() || '',
    name: standardParts[nameIndex]?.trim() || '',
    text: standardParts[textIndex],
    standardParts,
    prefix: line.substring(0, colonIndex).trim() + ': ',
    formatInfo: { nameIndex, textIndex, startIndex, endIndex, styleIndex, totalFields }
  };
}

/**
 * Создает техническую строку "ШУМЫ" для ASS.
 */
function createNoiseLine(formatParts) {
  const dataParts = new Array(formatParts.length).fill('0');
  const startIndex = formatParts.indexOf('Start');
  const endIndex = formatParts.indexOf('End');
  const nameIndex = formatParts.indexOf('Name');
  const textIndex = formatParts.indexOf('Text');
  const styleIndex = formatParts.indexOf('Style');
  
  formatParts.forEach((part, i) => {
    if (i === startIndex || i === endIndex) dataParts[i] = '0:00:00.00';
    else if (i === nameIndex || i === textIndex) dataParts[i] = 'ШУМЫ';
    else if (i === styleIndex) dataParts[i] = 'Default';
    else dataParts[i] = '0';
  });
  
  return 'Dialogue: ' + dataParts.join(',');
}

async function cleanAssFile(assFilePath) {
  try {
    const content = await fs.readFile(assFilePath, 'utf-8');
    const lines = content.split('\n');
    let currentSection = '';
    let formatParts = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('[')) {
        currentSection = trimmedLine;
        continue;
      }
      
      if (currentSection === '[Script Info]') {
        if (trimmedLine.startsWith('Video Zoom Percent:') || 
            trimmedLine.startsWith('Scroll Position:') || 
            trimmedLine.startsWith('Active Line:')) {
          lines[i] = null; // Mark for deletion
          continue;
        }
      }
      
      if (currentSection === '[V4+ Styles]') {
        if (trimmedLine.startsWith('Style:')) {
          // Field separators in Style lines must remain commas.
          // The previous aggressive regex was merging integer fields.
        }
      }
      
      if (currentSection === '[Events]') {
        const prefixMatch = line.match(/^(Dialogue|Comment):/);
        if (prefixMatch) {
          const prefix = prefixMatch[0] + ' ';
          const rest = line.substring(prefixMatch[0].length).trimStart();
          const parts = rest.split(',');
          if (parts.length >= 10) {
            for (let j = 0; j < 9; j++) {
              parts[j] = parts[j].trim();
            }
            lines[i] = prefix + parts.slice(0, 9).join(',') + ',' + parts.slice(9).join(',');
          }
        }
      }
    }
    
    const newContent = lines.filter(l => l !== null).join('\n');
    await fs.writeFile(assFilePath, newContent, 'utf-8');
    return { success: true };
  } catch (error) {
    log.error('Error cleaning ASS file:', error);
    return { success: false, error: error.message };
  }
}

async function getRawSubtitles(assFilePath) {
  try {
    try {
      await fs.access(assFilePath);
    } catch {
      // File does not exist, return empty structure instead of crashing the UI
      return { lines: [], actors: [] };
    }

    const stats = await fs.stat(assFilePath);
    const mtime = stats.mtimeMs;
    
    if (subtitleCache.has(assFilePath)) {
      const cached = subtitleCache.get(assFilePath);
      if (cached.mtime === mtime) {
        return cached.data;
      }
    }

    const content = await fs.readFile(assFilePath, 'utf-8');
    const lines = content.split('\n');
    const result = [];
    
    let inEvents = false;
    let formatParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          result.push({
            id: i,
            start: parsed.start,
            end: parsed.end,
            style: parsed.style,
            name: parsed.name,
            text: parsed.text,
            rawLineIndex: i,
            standardParts: parsed.standardParts,
            prefix: parsed.prefix,
            formatInfo: parsed.formatInfo
          });
        }
      } else if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
    }

    const actors = new Set();
    
    for (const line of result) {
      if (line.name) {
        const names = line.name.split(',').map(n => n.trim()).filter(n => n !== '');
        names.forEach(n => {
          if (!SIGN_KEYWORDS.includes(n)) {
            actors.add(n);
          }
        });
      }
    }

    const data = {
      lines: result,
      actors: Array.from(actors)
    };

    subtitleCache.set(assFilePath, { mtime, data });
    
    // Keep cache size manageable
    if (subtitleCache.size > 10) {
      const firstKey = subtitleCache.keys().next().value;
      subtitleCache.delete(firstKey);
    }

    return data;
  } catch (error) {
    log.error("Error reading subtitles:", error);
    throw error;
  }
}

async function saveRawSubtitles(assFilePath, updates) {
  let content = '';
  let lines = [];
  try {
    content = await fs.readFile(assFilePath, 'utf-8');
    lines = content.split('\n');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File does not exist! We will generate it from scratch using updates
      const assLines = [];
      assLines.push('[Script Info]');
      assLines.push('Title: Generated Subtitles');
      assLines.push('ScriptType: v4.00+');
      assLines.push('PlayResX: 640');
      assLines.push('PlayResY: 360');
      assLines.push('');
      assLines.push('[V4+ Styles]');
      assLines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
      assLines.push('Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1');
      assLines.push('');
      assLines.push('[Events]');
      assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
      
      for (const line of updates) {
        const start = line.start || '0:00:00.00';
        const end = line.end || '0:00:00.00';
        const style = line.style || 'Default';
        const name = (line.name || '').replace(/,/g, ';');
        const text = line.text || '';
        assLines.push(`Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`);
      }
      
      const newContent = assLines.join('\n');
      await fs.writeFile(assFilePath, newContent, 'utf-8');
      return;
    } else {
      throw err;
    }
  }
  
  let inEvents = false;
  let formatParts = [];

  const updatesMap = new Map();
  for (const update of updates) {
    updatesMap.set(update.rawLineIndex, { name: update.name, text: update.text });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (updatesMap.has(i)) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const update = updatesMap.get(i);
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          
          if (update.name !== undefined) {
            standardParts[parsed.formatInfo.nameIndex] = (update.name || '').replace(/,/g, ';');
          }
          if (update.text !== undefined) {
            standardParts[parsed.formatInfo.textIndex] = update.text;
          }
          
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
  await cleanAssFile(assFilePath);
}

async function splitSubsByActor(assFilePath, outputDirectory, options) {
  log.info(`Splitting subtitles by actor: ${assFilePath} -> ${outputDirectory}`);
  const {
    distributeGroups = false,
    distributeMultipleRoles = false,
    saveSignsInAss = false,
    outputFormat = 'ass' // 'ass' or 'srt'
  } = options || {};

  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];

  const parsedLines = [];
  const uniqueActors = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      parsedLines.push({ type: 'header', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      parsedLines.push({ type: 'format', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        parsedLines.push({ 
          type: 'dialogue', 
          text: line, 
          names: currentNames,
          start: parsed.start,
          end: parsed.end,
          textContent: parsed.text
        });

        for (const name of currentNames) {
          if (SIGN_KEYWORDS.includes(name)) continue;
          if (groupKeywords.includes(name)) continue;
          if (name.startsWith('!')) continue;
          uniqueActors.add(name);
        }
      } else {
        parsedLines.push({ type: 'other', text: line });
      }
    } else {
      if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
      parsedLines.push({ type: 'other', text: line });
    }
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const originalFileName = path.basename(assFilePath, '.ass');

  const totalActors = uniqueActors.size;
  let currentActorIdx = 0;

  for (const actor of uniqueActors) {
    currentActorIdx++;
    if (options && options.onProgress) {
      options.onProgress({ percent: Math.round((currentActorIdx / totalActors) * 100) });
    }
    const actorLines = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        let include = false;
        const names = parsed.names;

        if (names.length === 0) continue;

        if (names.some(n => SIGN_KEYWORDS.includes(n))) {
          continue;
        }

        if (names.some(n => n.startsWith('!'))) {
          const exclusions = names.map(n => n.startsWith('!') ? n.substring(1).trim() : n);
          if (!exclusions.includes(actor)) include = true;
        } else if (names.some(n => groupKeywords.includes(n))) {
           if (distributeGroups) include = true;
        } else if (names.length > 1) {
           if (distributeMultipleRoles && names.includes(actor)) include = true;
        } else if (names.length === 1 && names[0] === actor) {
           include = true;
        }

        if (include) {
          if (outputFormat === 'ass') {
            actorLines.push(parsed.text);
          } else {
            if (srtIndex === 1) {
               actorLines.push('1\n00:00:00,000 --> 00:00:00,000\nШУМЫ\n');
               srtIndex++;
            }
            actorLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
            srtIndex++;
          }
          lineCount++;
        }
      } else {
        if (outputFormat === 'ass') {
          actorLines.push(parsed.text);
          if (parsed.type === 'format') {
            actorLines.push(createNoiseLine(formatParts));
          }
        }
      }
    }

    if (lineCount > 0) {
      const ext = outputFormat === 'ass' ? '.ass' : '.srt';
      const outputPath = path.join(outputDirectory, `${originalFileName} - ${actor} - (${lineCount})${ext}`);
      log.info(`Writing split file for ${actor}: ${outputPath}`);
      await fs.writeFile(outputPath, actorLines.join('\n'), 'utf-8');
      if (ext === '.ass') await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  if (saveSignsInAss) {
    log.info('Extracting signs to separate file...');
    const signLines = [];
    let signCount = 0;
    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        if (parsed.names.some(n => SIGN_KEYWORDS.includes(n))) {
          signLines.push(parsed.text);
          signCount++;
        }
      } else {
        signLines.push(parsed.text);
      }
    }
    if (signCount > 0) {
      const outputPath = path.join(outputDirectory, `${originalFileName} - Надписи.ass`);
      await fs.writeFile(outputPath, signLines.join('\n'), 'utf-8');
      await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  return { success: true, generatedFiles };
}

async function splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData, options) {
  log.info(`Splitting subtitles by dubber: ${assFilePath} -> ${outputDirectory}`);
  const {
    saveSignsInAss = false,
    outputFormat = 'ass', // 'ass' or 'srt'
    baseFileName = path.basename(assFilePath, '.ass')
  } = options || {};

  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const dubberIds = Array.from(new Set(assignments.map(a => a.substituteId || a.dubberId).filter(id => id)));
  const dubbers = dubbersData.filter(d => dubberIds.includes(d.id));
  
  const dubberMap = new Map();
  for (const dubber of dubbers) {
    dubberMap.set(dubber.id, dubber);
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const originalFileName = path.basename(assFilePath, '.ass');

  const totalDubbers = dubberIds.length;
  let currentDubberIdx = 0;

  for (const dubberId of dubberIds) {
    currentDubberIdx++;
    if (options && options.onProgress) {
      options.onProgress({ percent: Math.round((currentDubberIdx / totalDubbers) * 100) });
    }
    const dubber = dubberMap.get(dubberId);
    if (!dubber) continue;

    const assignedCharacters = assignments
      .filter(a => (a.substituteId || a.dubberId) === dubberId)
      .map(a => a.characterName.trim());

    const mapping = {};
    for (const assignment of assignments) {
      const targetId = assignment.substituteId || assignment.dubberId;
      if (targetId === dubberId) {
        const charName = assignment.characterName.trim();
        const d = dubberMap.get(targetId);
        if (d) {
          if (!mapping[charName]) mapping[charName] = [];
          mapping[charName].push(d.nickname);
        }
      }
    }

    const newLines = [];
    let inEvents = false;
    let formatParts = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        if (outputFormat === 'ass') newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        if (outputFormat === 'ass') {
          newLines.push(line);
          newLines.push(createNoiseLine(formatParts));
        }
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
          const isAssigned = currentNames.some(name => assignedCharacters.includes(name));

          if (isAssigned) {
            const mappedNames = currentNames.flatMap(name => {
              if (mapping[name] && mapping[name].length > 0) {
                return mapping[name];
              }
              return [name];
            });

            if (outputFormat === 'ass') {
              const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
              standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
              newLines.push(`${parsed.prefix}${standardParts.join(',')}`);
            } else {
              if (srtIndex === 1) {
                newLines.push('1\n00:00:00,000 --> 00:00:00,000\nШУМЫ\n');
                srtIndex++;
              }
              newLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
              srtIndex++;
            }
            lineCount++;
          }
        } else if (outputFormat === 'ass') {
          newLines.push(line);
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        if (outputFormat === 'ass') newLines.push(line);
      }
    }

    const ext = outputFormat === 'ass' ? '.ass' : '.srt';
    const outputPath = path.join(outputDirectory, `${baseFileName}_[${dubber.nickname}]_${lineCount}${ext}`);
    log.info(`Writing file for dubber ${dubber.nickname}: ${outputPath}`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    if (outputFormat === 'ass') await cleanAssFile(outputPath);
    generatedFiles.push(outputPath);
  }

  if (saveSignsInAss) {
    log.info('Extracting signs to separate file...');
    const signLines = [];
    let signCount = 0;
    let inEvents = false;
    let formatParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        signLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        signLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const names = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
          if (names.some(n => SIGN_KEYWORDS.includes(n))) {
            signLines.push(line);
            signCount++;
          }
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        signLines.push(line);
      }
    }

    if (signCount > 0) {
      const outputPath = path.join(outputDirectory, `${originalFileName} - Надписи.ass`);
      await fs.writeFile(outputPath, signLines.join('\n'), 'utf-8');
      await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  return { success: true, generatedFiles };
}

async function exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const mapping = {};
  for (const assignment of assignments) {
    const targetId = assignment.substituteId || assignment.dubberId;
    if (!targetId) continue;
    const dubber = participantsData.find(p => p.id === targetId);
    if (dubber) {
      const charName = assignment.characterName.trim();
      if (!mapping[charName]) {
        mapping[charName] = [];
      }
      mapping[charName].push(dubber.nickname);
    }
  }

  let inEvents = false;
  let formatParts = [];
  let replacedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      lines[i] = line + '\n' + createNoiseLine(formatParts);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        let changed = false;
        const mappedNames = currentNames.flatMap(name => {
          if (mapping[name] && mapping[name].length > 0) {
            changed = true;
            return mapping[name];
          }
          return [name];
        });
        
        if (changed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
          replacedCount++;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  await cleanAssFile(outputPath);
  return outputPath;
}

async function saveTranslatedSubtitles(assFilePath, translatedLines) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  let firstDialogueIndex = -1;
  let lastDialogueIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (trimmedLine.startsWith('[Events]')) inEvents = true;
    else if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
    } else if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (firstDialogueIndex === -1) firstDialogueIndex = i;
      lastDialogueIndex = i;
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  if (firstDialogueIndex === -1) firstDialogueIndex = lines.length;
  if (lastDialogueIndex === -1) lastDialogueIndex = firstDialogueIndex - 1;

  const newDialogueLines = [];
  for (const line of translatedLines) {
    if (line.standardParts && line.prefix && line.formatInfo) {
      const parts = [...line.standardParts];
      parts[line.formatInfo.textIndex] = line.text;
      if (line.start) parts[line.formatInfo.startIndex] = line.start;
      if (line.end) parts[line.formatInfo.endIndex] = line.end;
      if (line.name !== undefined) parts[line.formatInfo.nameIndex] = line.name.replace(/,/g, ';');
      newDialogueLines.push(`${line.prefix}${parts.join(',')}`);
    } else {
      // Fallback for new lines or missing format info
      const start = line.start || '0:00:00.00';
      const end = line.end || '0:00:00.00';
      const style = line.style || 'Default';
      const name = (line.name || '').replace(/,/g, ';');
      const text = line.text || '';
      newDialogueLines.push(`Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`);
    }
  }

  const preLines = lines.slice(0, firstDialogueIndex);
  const postLines = lines.slice(lastDialogueIndex + 1);
  
  // Filter out any stray old Dialogues between first and last if we slice
  // Actually, we just need to drop ALL Dialogue lines from preLines and postLines
  const filterOutDialogue = (l) => !l.trim().startsWith('Dialogue:');
  
  const finalLines = [
    ...preLines.filter(filterOutDialogue),
    ...newDialogueLines,
    ...postLines.filter(filterOutDialogue)
  ];

  await fs.writeFile(assFilePath, finalLines.join('\n'), 'utf-8');
  await cleanAssFile(assFilePath);
}

async function extractSignsAss(assFilePath, outputPath) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  const newLines = [];
  let signCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        // Explicitly ignore technical "ШУМЫ" line
        if (parsed.name === 'ШУМЫ') {
          continue;
        }
        
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        if (currentNames.some(n => SIGN_KEYWORDS.includes(n))) {
          newLines.push(line);
          signCount++;
        }
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  if (signCount > 0) {
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    await cleanAssFile(outputPath);
    return true;
  }
  return false;
}

async function convertSrtToAss(srtFilePath, assFilePath) {
  try {
    const content = await fs.readFile(srtFilePath, 'utf-8');
    // Normalize line endings and split into blocks
    const normalized = content.replace(/\r\n/g, '\n');
    const blocks = normalized.split(/\n\s*\n/);
    const assEvents = [];
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length >= 3) {
        // Try to find the time line (usually second line, but can be preceded by index)
        const timeLineIdx = lines.findIndex(l => l.includes(' --> '));
        if (timeLineIdx === -1) continue;
        
        const timeLine = lines[timeLineIdx];
        const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,. ]\d{2,3}) --> (\d{1,2}:\d{2}:\d{2}[,. ]\d{2,3})/);
        
        if (match) {
          const srtToAssTime = (t) => {
            // SRT: 00:00:00,000 or 0:00:00.00
            const cleanT = t.replace(',', '.');
            const parts = cleanT.split(':');
            const h = parseInt(parts[0]);
            const m = parts[1];
            const sParts = parts[2].split('.');
            const s = sParts[0];
            const ms = (sParts[1] || '0').padEnd(2, '0').substring(0, 2);
            return `${h}:${m}:${s}.${ms}`;
          };
          
          const startTime = srtToAssTime(match[1]);
          const endTime = srtToAssTime(match[2]);
          const text = lines.slice(timeLineIdx + 1).join('\\N');
          assEvents.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
        }
      }
    }

    const assHeader = `[Script Info]
Title: Converted from SRT
ScriptType: v4.00+
Collisions: Normal
PlayResX: 640
PlayResY: 360
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.00,Default,ШУМЫ,0,0,0,,ШУМЫ
`;

    await fs.writeFile(assFilePath, assHeader + assEvents.join('\n'), 'utf-8');
    return { success: true };
  } catch (err) {
    log.error('SRT to ASS conversion failed:', err);
    throw err;
  }
}

module.exports = {
  getRawSubtitles,
  saveRawSubtitles,
  saveTranslatedSubtitles,
  splitSubsByActor,
  splitSubsByDubber,
  exportFullAssWithRoles,
  extractSignsAss,
  cleanAssFile,
  convertSrtToAss
};

