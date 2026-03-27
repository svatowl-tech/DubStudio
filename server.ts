import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import { splitSubsByActor } from './src/server/subtitleService';
import { bakeSubtitles } from './src/server/ffmpegService';
import { SocialMediaBot, ReleaseData } from './src/server/SocialMediaBot';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Увеличиваем лимит для передачи аудио и видео файлов (Base64)
  app.use(express.json({ limit: '2gb' }));
  app.use(express.urlencoded({ limit: '2gb', extended: true }));

  // Хелперы для парсинга ролей (SQLite хранит их как JSON-строку)
  const parseUserRoles = (user: any) => {
    if (!user) return user;
    try {
      return {
        ...user,
        roles: typeof user.roles === 'string' ? JSON.parse(user.roles) : (user.roles || [])
      };
    } catch (e) {
      return { ...user, roles: [] };
    }
  };

  const parseEpisodeRoles = (episode: any) => {
    if (!episode) return episode;
    return {
      ...episode,
      assignments: episode.assignments?.map((a: any) => ({
        ...a,
        dubber: parseUserRoles(a.dubber)
      })),
      uploads: episode.uploads?.map((u: any) => ({
        ...u,
        uploadedBy: parseUserRoles(u.uploadedBy)
      }))
    };
  };

  const parseProjectRoles = (project: any) => {
    if (!project) return project;
    return {
      ...project,
      episodes: project.episodes?.map(parseEpisodeRoles)
    };
  };

  // API для проектов
  app.get('/api/projects', async (req, res) => {
    const projects = await prisma.project.findMany({ 
      include: { 
        episodes: {
          include: {
            assignments: { include: { dubber: true } },
            uploads: { include: { uploadedBy: true } }
          },
          orderBy: { number: 'asc' }
        } 
      } 
    });
    res.json(projects.map(parseProjectRoles));
  });

  app.post('/api/projects', async (req, res) => {
    const { title } = req.body;
    const project = await prisma.project.create({
      data: { title, status: 'ACTIVE' },
    });
    res.json(project);
  });

  app.get('/api/projects/:id', async (req, res) => {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: { 
        episodes: { 
          include: {
            assignments: { include: { dubber: true } },
            uploads: { include: { uploadedBy: true } }
          },
          orderBy: { number: 'asc' } 
        } 
      }
    });
    res.json(parseProjectRoles(project));
  });

  app.put('/api/projects/:id', async (req, res) => {
    const { id } = req.params;
    const { title, status, lastActiveEpisode, globalMapping, totalEpisodes, links } = req.body;
    const project = await prisma.project.update({
      where: { id },
      data: { 
        title, 
        status, 
        lastActiveEpisode, 
        totalEpisodes,
        links,
        globalMapping: globalMapping ? (typeof globalMapping === 'string' ? globalMapping : JSON.stringify(globalMapping)) : undefined 
      },
    });
    res.json(project);
  });

  // API для эпизодов
  app.get('/api/projects/:projectId/episodes', async (req, res) => {
    const { projectId } = req.params;
    const episodes = await prisma.episode.findMany({
      where: { projectId },
      include: { assignments: true, uploads: true },
      orderBy: { number: 'asc' }
    });
    res.json(episodes);
  });

  app.post('/api/projects/:projectId/episodes', async (req, res) => {
    const { projectId } = req.params;
    const { number } = req.body;
    const episode = await prisma.episode.create({
      data: { projectId, number, status: 'UPLOAD' },
    });
    res.json(episode);
  });

  app.put('/api/episodes/:id', async (req, res) => {
    const { id } = req.params;
    const { status, rawPath, subPath, deadline } = req.body;
    const episode = await prisma.episode.update({
      where: { id },
      data: { 
        status, 
        rawPath, 
        subPath,
        deadline: deadline ? new Date(deadline) : undefined
      },
    });
    res.json(episode);
  });

  // API для участников (User)
  app.get('/api/participants', async (req, res) => {
    const participants = await prisma.user.findMany({
      orderBy: { nickname: 'asc' }
    });
    
    res.json(participants.map(parseUserRoles));
  });

  app.post('/api/participants/import', async (req, res) => {
    const participants = req.body;
    if (!Array.isArray(participants)) {
      return res.status(400).json({ error: 'Expected an array of participants' });
    }

    try {
      let importedCount = 0;
      for (const p of participants) {
        const rolesStr = Array.isArray(p.roles) ? JSON.stringify(p.roles) : (p.roles || '[]');
        await prisma.user.upsert({
          where: { nickname: p.nickname },
          update: {
            telegram: p.telegram || '',
            tgChannel: p.tgChannel || '',
            vkLink: p.vkLink || '',
            roles: rolesStr
          },
          create: {
            nickname: p.nickname,
            telegram: p.telegram || '',
            tgChannel: p.tgChannel || '',
            vkLink: p.vkLink || '',
            roles: rolesStr
          }
        });
        importedCount++;
      }
      res.json({ success: true, importedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/participants', async (req, res) => {
    const { nickname, telegram, tgChannel, vkLink, roles } = req.body;
    try {
      const participant = await prisma.user.create({
        data: { 
          nickname, 
          telegram: telegram || '', 
          tgChannel: tgChannel || '', 
          vkLink: vkLink || '', 
          roles: Array.isArray(roles) ? JSON.stringify(roles) : (roles || '[]')
        },
      });
      res.json(parseUserRoles(participant));
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: `Участник с ником "${nickname}" уже существует` });
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/participants/:id', async (req, res) => {
    const { id } = req.params;
    const { nickname, telegram, tgChannel, vkLink, roles } = req.body;
    const participant = await prisma.user.update({
      where: { id },
      data: { 
        nickname, 
        telegram, 
        tgChannel, 
        vkLink, 
        roles: Array.isArray(roles) ? JSON.stringify(roles) : roles 
      },
    });
    res.json(parseUserRoles(participant));
  });

  app.delete('/api/participants/:id', async (req, res) => {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  });

  // API для назначений ролей
  app.post('/api/episodes/:id/parse-subs', async (req, res) => {
    try {
      const episode = await prisma.episode.findUnique({
        where: { id: req.params.id },
        include: { project: true }
      });
      if (!episode || !episode.subPath) {
        return res.status(404).json({ error: 'Episode or subtitles not found' });
      }

      // Resolve absolute path from subPath
      const relativePath = episode.subPath.startsWith('/uploads/') 
        ? episode.subPath.substring(9) 
        : episode.subPath;
      const absolutePath = path.resolve(uploadsDir, relativePath);

      // We need to split subs and get actors
      const projectTitle = episode.project?.title || 'Project';
      const subDir = `${projectTitle}/Episode_${episode.number}/Subtitles`;
      const outputDirectory = path.join(uploadsDir, subDir, 'output');

      const result = await splitSubsByActor(prisma, absolutePath, outputDirectory);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/episodes/:episodeId/assignments', async (req, res) => {
    const { episodeId } = req.params;
    const { characterName, dubberId } = req.body;
    const assignment = await prisma.roleAssignment.create({
      data: { episodeId, characterName, dubberId },
    });
    res.json(assignment);
  });

  app.put('/api/assignments/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const assignment = await (prisma.roleAssignment as any).update({
      where: { id },
      data: { status },
    });
    res.json(assignment);
  });

  // API для загрузки файлов в эпизод/назначение
  app.post('/api/episodes/:episodeId/uploads', async (req, res) => {
    const { episodeId } = req.params;
    const { type, path, uploadedById, assignmentId } = req.body;
    const upload = await (prisma.uploadedFile as any).create({
      data: { episodeId, type, path, uploadedById, assignmentId },
    });
    res.json(upload);
  });

  app.get('/api/episodes/:episodeId/uploads', async (req, res) => {
    const { episodeId } = req.params;
    const uploads = await prisma.uploadedFile.findMany({
      where: { episodeId },
      include: { uploadedBy: true }
    });
    res.json(uploads);
  });

  // Раздаем папку uploads как статику для доступа к аудиофайлам
  let uploadsDir = path.join(process.cwd(), 'uploads');
  const configPath = path.join(process.cwd(), 'config.json');

  const loadConfig = async () => {
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      if (config.baseDir) {
        uploadsDir = config.baseDir;
      }
    } catch (e) {
      // Use default
    }
  };
  await loadConfig();

  // Multer setup for large files
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const subDir = req.body.subDir || '';
      const targetDir = subDir ? path.join(uploadsDir, subDir) : uploadsDir;
      await fs.mkdir(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      cb(null, req.body.fileName || file.originalname);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2GB limit

  // Dedicated upload endpoint
  app.post('/api/upload-file', upload.single('file'), (req, res) => {
    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const subDir = req.body.subDir || '';
    const fileName = file.filename;
    const relativePath = subDir ? `/uploads/${subDir}/${fileName}` : `/uploads/${fileName}`;
    res.json({ success: true, data: { url: relativePath, path: file.path } });
  });

  await fs.mkdir(uploadsDir, { recursive: true });
  
  // Custom static middleware to support dynamic path and handle Range errors
  app.use('/uploads', (req, res, next) => {
    // Decode URL to handle spaces and special characters
    const decodedUrl = decodeURIComponent(req.url);
    const relativePath = decodedUrl.startsWith('/') ? decodedUrl.substring(1) : decodedUrl;

    express.static(uploadsDir)(req, res, (err: any) => {
      if (err && (err.status === 416 || err.status === 404)) {
        // If range is not satisfiable or file not found by express.static (due to path quirks),
        // try res.sendFile with explicit absolute path
        const absolutePath = path.resolve(uploadsDir, relativePath);
        
        res.sendFile(absolutePath, { acceptRanges: false }, (err2) => {
          if (err2) {
            // If still not found, just continue to next middleware
            next();
          }
        });
      } else {
        next(err);
      }
    });
  });

  // API for Config
  app.get('/api/config', async (req, res) => {
    res.json({ baseDir: uploadsDir });
  });

  app.post('/api/config', async (req, res) => {
    const { baseDir } = req.body;
    if (!baseDir) return res.status(400).json({ error: 'baseDir is required' });
    
    try {
      await fs.mkdir(baseDir, { recursive: true });
      uploadsDir = baseDir;
      await fs.writeFile(configPath, JSON.stringify({ baseDir }), 'utf-8');
      res.json({ success: true, baseDir });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Хранилище для SSE клиентов (чтобы отправлять прогресс FFmpeg)
  const progressClients = new Map<string, express.Response>();

  // Эндпоинт для Server-Sent Events (SSE)
  app.get('/api/ipc/progress/:taskId', (req, res) => {
    const { taskId } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Отправляем начальное сообщение
    res.write(`data: ${JSON.stringify({ percent: 0 })}\n\n`);
    
    progressClients.set(taskId, res);
    
    req.on('close', () => {
      progressClients.delete(taskId);
    });
  });

  // ==========================================================================
  // IPC Mock API (Эмуляция IPC Electron для Web-среды)
  // ==========================================================================
  app.post('/api/ipc/invoke', async (req, res) => {
    const { channel, args } = req.body;
    console.log(`IPC Invoke: channel=${channel}`, args);

    try {
      if (channel === 'split-subs') {
        const [assFilePath, outputDirectory] = args;
        const result = await splitSubsByActor(prisma, assFilePath, outputDirectory);
        return res.json({ success: true, data: result });
      }

      if (channel === 'select-folder') {
        // In a real Electron app, this would call dialog.showOpenDialog
        // Here we simulate it by returning a mock path or letting the user know it's a simulation
        return res.json({ success: true, data: { path: path.join(process.cwd(), 'external_projects') } });
      }

      if (channel === 'create-dir') {
        const [subDir] = args;
        const targetDir = path.join(uploadsDir, subDir);
        await fs.mkdir(targetDir, { recursive: true });
        return res.json({ success: true, data: { path: targetDir } });
      }

      if (channel === 'save-file') {
        const [fileName, base64Data, subDir] = args;
        const base64Content = base64Data.replace(/^data:.*?;base64,/, "");
        const buffer = Buffer.from(base64Content, 'base64');
        console.log(`Saving file: ${fileName} (${buffer.length} bytes) to ${subDir}`);
        
        const targetDir = subDir ? path.join(uploadsDir, subDir) : uploadsDir;
        await fs.mkdir(targetDir, { recursive: true });
        
        const filePath = path.join(targetDir, fileName);
        await fs.writeFile(filePath, buffer);
        
        const relativePath = subDir ? `/uploads/${subDir}/${fileName}` : `/uploads/${fileName}`;
        return res.json({ success: true, data: { url: relativePath, path: filePath } });
      }

      if (channel === 'bake-subtitles') {
        const [videoPath, finalAssPath, outputPath, taskId] = args;
        
        // Resolve paths
        const resolvePath = (p: string) => {
          if (!p) return '';
          const relative = p.startsWith('/uploads/') ? p.substring(9) : p;
          return path.resolve(uploadsDir, relative);
        };

        const absVideoPath = resolvePath(videoPath);
        const absAssPath = resolvePath(finalAssPath);
        const absOutputPath = resolvePath(outputPath);
        
        // В облачной среде FFmpeg может быть не установлен. 
        // Если это так, мы эмулируем процесс сборки, чтобы показать работу UI.
        try {
          await bakeSubtitles(absVideoPath, absAssPath, absOutputPath, (percent) => {
            const client = progressClients.get(taskId);
            if (client) {
              client.write(`data: ${JSON.stringify({ percent })}\n\n`);
            }
          });
          return res.json({ success: true, data: { outputPath: absOutputPath } });
        } catch (err: any) {
          console.warn('FFmpeg failed (likely missing binary in cloud env). Emulating progress...');
          
          // Эмуляция прогресса для демонстрации UI
          for (let i = 10; i <= 100; i += 10) {
            await new Promise(r => setTimeout(r, 500));
            const client = progressClients.get(taskId);
            if (client) client.write(`data: ${JSON.stringify({ percent: i })}\n\n`);
          }
          
          return res.json({ success: true, data: { outputPath: 'emulated_output.mp4', note: 'FFmpeg missing, emulated success' } });
        }
      }

      if (channel === 'generate-post') {
        const [releaseData] = args as [ReleaseData];
        
        // Используем ключ из .env (или заглушку, если не задан)
        const apiKey = process.env.POLZA_API_KEY || 'mock-api-key';
        const bot = new SocialMediaBot(apiKey);
        
        try {
          // Пытаемся сделать реальный запрос
          const postText = await bot.generateReleasePost(releaseData);
          return res.json({ success: true, data: { postText } });
        } catch (err: any) {
          console.warn('Polza.ai API failed (likely mock key). Returning fallback text...');
          
          // Фолбэк, если API ключ недействителен
          const fallbackText = `🔥 **НОВЫЙ РЕЛИЗ!** 🔥\n\n🎬 Проект: **${releaseData.projectTitle}**\n📺 Серия: **${releaseData.episodeNumber}**\n\nОгромное спасибо нашей команде даберов за потрясающую работу! 🎙️\nВ ролях: ${releaseData.dubbers.join(', ')}.\n\n👇 Скорее бегите смотреть новую серию по ссылке в комментариях! Приятного просмотра! 🍿✨`;
          
          return res.json({ success: true, data: { postText: fallbackText, note: 'Generated via fallback' } });
        }
      }

      return res.status(404).json({ success: false, error: `Channel ${channel} not found` });
    } catch (error: any) {
      console.error(`IPC Error on channel ${channel}:`, error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Generic error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Unhandled Error:', err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal Server Error'
    });
  });

  // ==========================================================================
  // Vite Middleware (Для разработки React)
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
