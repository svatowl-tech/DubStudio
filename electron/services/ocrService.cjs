const { createWorker } = require('tesseract.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');

async function extractHardsub(videoPath, outputAssPath, onProgress) {
  const tempDir = path.join(path.dirname(videoPath), 'temp_ocr_' + Date.now());
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // 1. Extract frames
    log.info('Extracting frames for OCR...');
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions('-vf', 'fps=0.5') // 1 frame every 2 seconds
        .output(path.join(tempDir, 'frame_%04d.png'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 2. Perform OCR
    log.info('Performing OCR...');
    const worker = await createWorker('rus+eng');
    const files = (await fs.readdir(tempDir)).sort();
    const subtitles = [];

    for (let i = 0; i < files.length; i++) {
      const framePath = path.join(tempDir, files[i]);
      const { data: { text } } = await worker.recognize(framePath);
      
      if (text.trim()) {
        subtitles.push({
          start: i * 2, // 2 seconds interval
          end: (i + 1) * 2,
          text: text.trim()
        });
      }
      if (onProgress) onProgress(Math.round(((i + 1) / files.length) * 100));
    }
    await worker.terminate();

    // 3. Save to ASS
    log.info('Saving subtitles...');
    let assContent = `[Script Info]
Title: Hardsub Extraction
ScriptType: v4.00+
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;

    subtitles.forEach(sub => {
      const start = new Date(sub.start * 1000).toISOString().substr(11, 8);
      const end = new Date(sub.end * 1000).toISOString().substr(11, 8);
      assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${sub.text.replace(/\n/g, '\\N')}\n`;
    });

    await fs.writeFile(outputAssPath, assContent);
    return { success: true };
  } catch (error) {
    log.error('OCR Error:', error);
    return { success: false, error: error.message };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { extractHardsub };
