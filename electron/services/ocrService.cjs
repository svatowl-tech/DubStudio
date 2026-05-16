const { createWorker } = require('tesseract.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');
const { cleanAssFile } = require('./subtitleService.cjs');
const { addProcess, removeProcess } = require('./ffmpegService.cjs');

async function extractHardsub(videoPath, outputAssPath, onProgress, options = {}) {
  const { 
    language = 'rus+eng', 
    preprocess = false,
    fps = 0.5 
  } = options;

  const tempDir = path.join(path.dirname(videoPath), 'temp_ocr_' + Date.now());
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // 1. Extract frames
    log.info('Extracting frames for OCR...');
    
    // Choose filter chain based on preprocess flag
    // For subtitles, we want high contrast and sharpness
    // format=gray: converts to grayscale
    // curves=strong_contrast: increases contrast
    // threshold: binarizes the image (black and white only) - helpful for clear text
    const vf = [
      `fps=${fps}`,
      preprocess ? 'format=gray,curves=strong_contrast,unsharp=5:5:1.0:5:5:0.0' : null
    ].filter(Boolean).join(',');

    await new Promise((resolve, reject) => {
      let processId = null;
      const command = ffmpeg(videoPath)
        .outputOptions('-vf', vf)
        .output(path.join(tempDir, 'frame_%04d.png'))
        .on('start', (commandLine) => {
          processId = addProcess(commandLine, command);
        })
        .on('end', () => {
          if (processId) removeProcess(processId);
          resolve();
        })
        .on('error', (err) => {
          log.error('FFmpeg extraction error:', err);
          if (processId) removeProcess(processId);
          reject(err);
        });
      command.run();
    });

    // 2. Perform OCR
    log.info(`Performing OCR with language: ${language}...`);
    const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.png')).sort();
    log.info(`Extracted ${files.length} frames for processing.`);
    const worker = await createWorker(language);
    const subtitles = [];

    if (files.length === 0) {
      log.error('OCR Error: No frames extracted from video');
      throw new Error('No frames extracted from video');
    }

    const interval = 1 / fps;

    for (let i = 0; i < files.length; i++) {
      if (i % 10 === 0) log.info(`OCR progress: ${i}/${files.length} frames processed.`);
      const framePath = path.join(tempDir, files[i]);
      const { data: { text } } = await worker.recognize(framePath);
      
      if (text.trim()) {
        subtitles.push({
          start: i * interval,
          end: (i + 1) * interval,
          text: text.trim()
        });
      }
      if (onProgress) onProgress(Math.round(((i + 1) / files.length) * 100));
    }
    await worker.terminate();
    log.info(`OCR complete. Found ${subtitles.length} lines.`);

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

    function formatAssTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const cs = Math.floor((seconds % 1) * 100);
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    }

    subtitles.forEach(sub => {
      const start = formatAssTime(sub.start);
      const end = formatAssTime(sub.end);
      assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${sub.text.replace(/\n/g, '\\N')}\n`;
    });

    await fs.writeFile(outputAssPath, assContent);
    await cleanAssFile(outputAssPath);
    return { success: true };
  } catch (error) {
    log.error('OCR Error:', error);
    return { success: false, error: error.message };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { extractHardsub };
