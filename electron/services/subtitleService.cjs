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
        
        // The Text field is the last one and can contain commas.
        // But how many parts are NOT Text? 
        // If we split by comma, the number of parts that are NOT Text is totalFields - 1.
        // But if Name has commas, this is not true.
        
        // Let's assume fields other than Name and Text do NOT contain commas.
        // So, fields 0 to nameIndex-1 are beforeName.
        // Fields textIndex to end are Text (joined).
        // Fields between nameIndex and textIndex are... wait.
        
        // Let's try this:
        // Parts 0...nameIndex-1 are fixed.
        // Parts (last - (totalFields - 1 - textIndex)) to (last) are Text? No.
        
        // Standard ASS Dialogue line:
        // Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        // If totalFields = 10.
        // Layer(0), Start(1), End(2), Style(3) -> indices 0,1,2,3
        // MarginL(5), MarginR(6), MarginV(7), Effect(8) -> these are 4 fields.
        // Text(9) -> last field.
        
        const fieldsBefore = allParts.slice(0, nameIndex);
        const fieldsAfterIncludingText = allParts.slice(allParts.length - (totalFields - nameIndex - 1));
        
        // The fields between Name and Text
        const fieldsBetween = fieldsAfterIncludingText.slice(0, numBetween);
        const textPart = allParts.slice(allParts.length - (totalFields - textIndex)).join(',');
        
        // The Name field is everything else in the middle
        const namePart = allParts.slice(nameIndex, allParts.length - (totalFields - nameIndex - 1)).join(',');

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

        const fieldsBefore = allParts.slice(0, nameIndex);
        const fieldsAfterIncludingText = allParts.slice(allParts.length - (totalFields - nameIndex - 1));
        const fieldsBetween = fieldsAfterIncludingText.slice(0, textIndex - nameIndex - 1);
        const textPart = allParts.slice(allParts.length - (totalFields - textIndex)).join(',');

        const newName = updatesMap.get(i) || '';
        
        lines[i] = `${prefix}${fieldsBefore.join(',')},${newName},${fieldsBetween.join(',')},${textPart}`;
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
}

async function splitSubsByActor(assFilePath, outputDirectory, participantsData) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const { actors: uniqueActors } = await getRawSubtitles(assFilePath);
  
  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const actor of uniqueActors) {
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
          const data = line.substring(9);
          const allParts = data.split(',');
          const totalFields = formatParts.length;

          const currentNameRawPart = allParts.slice(nameIndex, allParts.length - (totalFields - nameIndex - 1)).join(',');
          const currentNames = currentNameRawPart.split(',').map(n => n.trim()).filter(n => n !== '');

          if (currentNames.includes(actor)) {
            newLines.push(line);
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

    const outputPath = path.join(outputDirectory, `${actor} (${lineCount}).ass`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    generatedFiles.push(outputPath);
  }

  return { generatedFiles };
}

async function splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData) {
  console.log(`Starting splitSubsByDubber for ${assFilePath}`);
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const dubberIds = Array.from(new Set(assignments.map(a => a.dubberId).filter(id => id)));
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
      .filter(a => a.dubberId === dubberId)
      .map(a => a.characterName.trim());

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
          const data = line.substring(9);
          const allParts = data.split(',');
          const totalFields = formatParts.length;

          // Robust name extraction
          const currentNameRawPart = allParts.slice(nameIndex, allParts.length - (totalFields - nameIndex - 1)).join(',');
          const currentNames = currentNameRawPart.split(',').map(n => n.trim()).filter(n => n !== '');

          const isAssigned = currentNames.some(name => assignedCharacters.includes(name));

          if (isAssigned) {
            newLines.push(line);
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
    if (!assignment.dubberId) continue;
    const dubber = participantsData.find(p => p.id === assignment.dubberId);
    if (dubber) {
      mapping[assignment.characterName.trim()] = dubber.nickname;
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

        const fieldsBefore = allParts.slice(0, nameIndex);
        const fieldsAfterIncludingText = allParts.slice(allParts.length - (totalFields - nameIndex - 1));
        const fieldsBetween = fieldsAfterIncludingText.slice(0, textIndex - nameIndex - 1);
        const textPart = allParts.slice(allParts.length - (totalFields - textIndex)).join(',');
        
        const currentNameRawPart = allParts.slice(nameIndex, allParts.length - (totalFields - nameIndex - 1)).join(',');
        const currentNames = currentNameRawPart.split(',').map(n => n.trim()).filter(n => n !== '');
        
        // Map each character name to its assigned dubber name
        let changed = false;
        const mappedNames = currentNames.map(name => {
          if (mapping[name]) {
            changed = true;
            return mapping[name];
          }
          return name;
        });
        
        if (changed) {
          const newName = mappedNames.join(', ');
          lines[i] = `${prefix}${fieldsBefore.join(',')},${newName},${fieldsBetween.join(',')},${textPart}`;
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

module.exports = {
  getRawSubtitles,
  saveRawSubtitles,
  splitSubsByActor,
  splitSubsByDubber,
  exportFullAssWithRoles
};
