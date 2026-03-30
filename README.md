# Anime Dub Manager

Desktop application designed for voice-over and fandub studios to manage projects, subtitles, and dubber assignments efficiently.

## Features

- **Project Management:** Organize voice-over projects and episodes.
- **Subtitle Processing:** Split subtitles by actors or dubbers using FFmpeg.
- **Assignment Management:** Assign characters to dubbers and track status.
- **File Management:** Upload and manage audio/subtitle files.
- **Cross-Platform:** Built with Electron for a native desktop experience.

## Tech Stack

- **Framework:** Electron
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS
- **Backend/Database:** Express, SQLite, Prisma ORM
- **Media Processing:** FFmpeg (fluent-ffmpeg), Wavesurfer.js
- **Styling:** Tailwind CSS

## Prerequisites

- Node.js (v18 or higher recommended)
- npm

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd polza-studio
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run in development mode:**
   ```bash
   npm run electron:dev
   ```

## Building

To build the application for production:

```bash
npm run electron:build
```

The build output will be located in the `dist/electron` directory.

## License

[Add your license here]
