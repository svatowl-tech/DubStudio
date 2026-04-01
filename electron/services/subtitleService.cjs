const fs = require('fs/promises');
const path = require('path');
const { parse } = require('ass-compiler');

async function getRawSubtitles(assFilePath) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  const result = [];
  
  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
  let startIndex = -1;
  let endIndex = -1;
  let styleIndex = -1;
  let textIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      nameIndex = formatParts.indexOf('Name');
      startIndex = formatParts.indexOf('Start');
      endIndex = formatParts.indexOf('End');
      styleIndex = formatParts.indexOf('Style');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (nameIndex !== -1 && textIndex !== -1) {
        const data = line.substring(9);
        const allParts = data.split(',');
        
        // Robust parsing:
        // Fields before Name are fixed
        const beforeName = allParts.slice(0, nameIndex);
        
        // Fields after Name but before Text are fixed (counting from the end of the non-text parts)
        // Number of fields between Name and Text
        const numBetween = textIndex - nameIndex - 1;
        
        // Total fields in Format
        const totalFields = formatParts.length;
        
        // Standard ASS parsing: split by totalFields - 1 commas
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));
        
        const fieldsBefore = standardParts.slice(0, nameIndex);
        const fieldsBetween = standardParts.slice(nameIndex + 1, textIndex);
        const textPart = standardParts[textIndex];
        const namePart = standardParts[nameIndex];

        result.push({
          id: i,
          start: fieldsBefore[startIndex]?.trim() || '',
          end: fieldsBefore[endIndex]?.trim() || '',
          style: fieldsBefore[styleIndex]?.trim() || '',
          name: namePart.trim(),
          text: textPart,
          rawLineIndex: i,
          // Store other fields to reconstruct exactly
          fieldsBefore,
          fieldsBetween,
          formatInfo: { nameIndex, textIndex, totalFields }
        });
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  const actors = new Set();
  for (const line of result) {
    if (line.name && line.name.trim() !== '') {
      const names = line.name.split(',').map(n => n.trim()).filter(n => n !== '');
      names.forEach(n => actors.add(n));
    }
  }

  return {
    lines: result,
    actors: Array.from(actors)
  };
}

async function saveRawSubtitles(assFilePath, updates) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
  let textIndex = -1;

  const updatesMap = new Map();
  for (const update of updates) {
    updatesMap.set(update.rawLineIndex, update.name);
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
      nameIndex = formatParts.indexOf('Name');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (updatesMap.has(i) && nameIndex !== -1 && textIndex !== -1) {
        const prefix = line.substring(0, 9);
        const data = line.substring(9);
        const allParts = data.split(',');
        const totalFields = formatParts.length;

        // Standard ASS parsing: split by totalFields - 1 commas
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));

        const newName = updatesMap.get(i) || '';
        standardParts[nameIndex] = newName;
        
        lines[i] = `${prefix}${standardParts.join(',')}`;
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
}

async function splitSubsByActor(assFilePath, outputDirectory, options) {
  const {
    distributeGroups = false,
    distributeMultipleRoles = false,
    saveSignsInAss = false,
    outputFormat = 'ass' // 'ass' or 'srt'
  } = options || {};

  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const signKeywords = ["НАДПИСЬ", "Надпись", "надпись", "НАДПИСИ", "Надписи", "надписи", "SIGNS", "Signs", "signs", "SIGN", "Sign", "sign", "TEXT", "Text", "text", "ТЕКСТ", "Текст", '"текст"'];
  const groupKeywords = ["гуры", "все"];

  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
  let textIndex = -1;
  let startIndex = -1;
  let endIndex = -1;

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
      nameIndex = formatParts.indexOf('Name');
      textIndex = formatParts.indexOf('Text');
      startIndex = formatParts.indexOf('Start');
      endIndex = formatParts.indexOf('End');
      parsedLines.push({ type: 'format', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (nameIndex !== -1 && textIndex !== -1) {
        const data = line.substring(9);
        const allParts = data.split(',');
        const totalFields = formatParts.length;

        // Standard ASS parsing: split by totalFields - 1 commas
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));

        const currentNameRawPart = standardParts[nameIndex];
        const currentNames = currentNameRawPart.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        const textPart = standardParts[textIndex];
        const startPart = standardParts[startIndex];
        const endPart = standardParts[endIndex];

        parsedLines.push({ 
          type: 'dialogue', 
          text: line, 
          names: currentNames,
          start: startPart,
          end: endPart,
          textContent: textPart
        });

        for (const name of currentNames) {
          if (signKeywords.includes(name)) continue;
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

  for (const actor of uniqueActors) {
    const actorLines = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        let include = false;
        const names = parsed.names;

        if (names.length === 0) continue;

        if (names.some(n => signKeywords.includes(n))) {
          continue;
        }

        if (names.some(n => n.startsWith('!'))) {
           const exclusions = names.filter(n => n.startsWith('!')).map(n => n.substring(1));
           if (distributeMultipleRoles && !exclusions.includes(actor)) include = true;
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
               actorLines.push('1\n00:00:00,000 --> 00:00:00,000\n \n');
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
        }
      }
    }

    if (lineCount > 0) {
      const ext = outputFormat === 'ass' ? '.ass' : '.srt';
      const outputPath = path.join(outputDirectory, `${originalFileName} - ${actor} - (${lineCount})${ext}`);
      await fs.writeFile(outputPath, actorLines.join('\n'), 'utf-8');
      generatedFiles.push(outputPath);
    }
  }

  if (saveSignsInAss) {
    const signLines = [];
    let signCount = 0;
    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        if (parsed.names.some(n => signKeywords.includes(n))) {
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
      generatedFiles.push(outputPath);
    }
  }

  return { success: true, generatedFiles };
}

async function splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData) {
  console.log(`Starting splitSubsByDubber for ${assFilePath}`);
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

  for (const dubberId of dubberIds) {
    const dubber = dubberMap.get(dubberId);
    if (!dubber) continue;

    const assignedCharacters = assignments
      .filter(a => (a.substituteId || a.dubberId) === dubberId)
      .map(a => a.characterName.trim());

    // Create mapping for this dubber
    const mapping = {};
    for (const assignment of assignments) {
      const targetId = assignment.substituteId || assignment.dubberId;
      if (targetId === dubberId) {
        const charName = assignment.characterName.trim();
        const dubber = dubberMap.get(targetId);
        if (dubber) {
          if (!mapping[charName]) mapping[charName] = [];
          mapping[charName].push(dubber.nickname);
        }
      }
    }

    console.log(`Processing dubber: ${dubber.nickname}, assigned characters: ${assignedCharacters.join(', ')}`);

    const newLines = [];
    let inEvents = false;
    let formatParts = [];
    let nameIndex = -1;
    let textIndex = -1;
    let lineCount = 0;

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
        nameIndex = formatParts.indexOf('Name');
        textIndex = formatParts.indexOf('Text');
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        if (nameIndex !== -1 && textIndex !== -1) {
          const prefix = line.substring(0, 9);
          const data = line.substring(9);
          const allParts = data.split(',');
          const totalFields = formatParts.length;

          // Standard ASS parsing: split by totalFields - 1 commas
          const standardParts = allParts.slice(0, totalFields - 1);
          standardParts.push(allParts.slice(totalFields - 1).join(','));

          // Robust name extraction
          const currentNameRawPart = standardParts[nameIndex];
          const currentNames = currentNameRawPart.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');

          const isAssigned = currentNames.some(name => assignedCharacters.includes(name));

          if (isAssigned) {
            // Replace names
            const mappedNames = currentNames.flatMap(name => {
              if (mapping[name] && mapping[name].length > 0) {
                return mapping[name];
              }
              return [name];
            });
            standardParts[nameIndex] = mappedNames.join(', ');
            newLines.push(`${prefix}${standardParts.join(',')}`);
            lineCount++;
          }
        } else {
          newLines.push(line);
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        newLines.push(line);
      }
    }

    const outputPath = path.join(outputDirectory, `${dubber.nickname} (${lineCount}).ass`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    generatedFiles.push(outputPath);
    console.log(`Generated file for ${dubber.nickname}: ${outputPath} with ${lineCount} lines`);
  }

  return { success: true, generatedFiles };
}

async function exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData) {
  console.log(`Starting exportFullAssWithRoles for ${assFilePath} to ${outputPath}`);
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

  console.log('Role mapping:', JSON.stringify(mapping));

  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
  let textIndex = -1;
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
      nameIndex = formatParts.indexOf('Name');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (nameIndex !== -1 && textIndex !== -1) {
        const prefix = line.substring(0, 9);
        const data = line.substring(9);
        const allParts = data.split(',');
        const totalFields = formatParts.length;

        // Standard ASS parsing: split by totalFields - 1 commas
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));

        const currentNameRawPart = standardParts[nameIndex];
        const currentNames = currentNameRawPart.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        // Map each character name to its assigned dubber name
        let changed = false;
        const mappedNames = currentNames.flatMap(name => {
          if (mapping[name] && mapping[name].length > 0) {
            changed = true;
            return mapping[name];
          }
          return [name];
        });
        
        if (changed) {
          const newName = mappedNames.join(', ');
          standardParts[nameIndex] = newName;
          lines[i] = `${prefix}${standardParts.join(',')}`;
          replacedCount++;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  console.log(`Export finished. Replaced roles in ${replacedCount} lines.`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  return outputPath;
}

async function saveTranslatedSubtitles(assFilePath, translatedLines) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
  let textIndex = -1;

  const translatedMap = new Map();
  for (const line of translatedLines) {
    translatedMap.set(line.rawLineIndex, line.text);
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
      nameIndex = formatParts.indexOf('Name');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (translatedMap.has(i) && nameIndex !== -1 && textIndex !== -1) {
        const prefix = line.substring(0, 9);
        const data = line.substring(9);
        const allParts = data.split(',');
        const totalFields = formatParts.length;

        // Standard ASS parsing: split by totalFields - 1 commas
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));

        const newText = translatedMap.get(i) || '';
        standardParts[textIndex] = newText;
        
        lines[i] = `${prefix}${standardParts.join(',')}`;
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
}

async function extractSignsAss(assFilePath, outputPath) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  const signKeywords = ["НАДПИСЬ", "Надпись", "надпись", "НАДПИСИ", "Надписи", "надписи", "SIGNS", "Signs", "signs", "SIGN", "Sign", "sign", "TEXT", "Text", "text", "ТЕКСТ", "Текст", '"текст"'];
  
  let inEvents = false;
  let formatParts = [];
  let nameIndex = -1;
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
      nameIndex = formatParts.indexOf('Name');
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (nameIndex !== -1) {
        const prefix = line.substring(0, 9);
        const data = line.substring(9);
        const allParts = data.split(',');
        const totalFields = formatParts.length;
        
        const standardParts = allParts.slice(0, totalFields - 1);
        standardParts.push(allParts.slice(totalFields - 1).join(','));
        
        const currentNameRawPart = standardParts[nameIndex];
        const currentNames = currentNameRawPart.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        if (currentNames.some(n => signKeywords.includes(n))) {
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
    return true;
  }
  return false;
}

module.exports = {
  getRawSubtitles,
  saveRawSubtitles,
  saveTranslatedSubtitles,
  splitSubsByActor,
  splitSubsByDubber,
  exportFullAssWithRoles,
  extractSignsAss
};

