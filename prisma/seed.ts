import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // Create Users
  const foxVol = await prisma.user.upsert({
    where: { nickname: 'FoxVol' },
    update: {},
    create: {
      nickname: 'FoxVol',
      telegram: '@foxvol_tg',
      tgChannel: '',
      vkLink: '',
      roles: JSON.stringify(['DUBBER']),
    },
  });

  const manres = await prisma.user.upsert({
    where: { nickname: 'Manres' },
    update: {},
    create: {
      nickname: 'Manres',
      telegram: '@manres_tg',
      tgChannel: '',
      vkLink: '',
      roles: JSON.stringify(['DUBBER']),
    },
  });

  const tenmag = await prisma.user.upsert({
    where: { nickname: 'Tenmag' },
    update: {},
    create: {
      nickname: 'Tenmag',
      telegram: '@tenmag_tg',
      tgChannel: '',
      vkLink: '',
      roles: JSON.stringify(['DUBBER']),
    },
  });

  const vitaliy = await prisma.user.upsert({
    where: { nickname: 'Vitaliy' },
    update: {},
    create: {
      nickname: 'Vitaliy',
      telegram: '@vitaliy_tg',
      tgChannel: '',
      vkLink: '',
      roles: JSON.stringify(['CURATOR']),
    },
  });

  const denis = await prisma.user.upsert({
    where: { nickname: 'Denis' },
    update: {},
    create: {
      nickname: 'Denis',
      telegram: '@denis_tg',
      tgChannel: '',
      vkLink: '',
      roles: JSON.stringify(['CURATOR']),
    },
  });

  console.log('Users created.');

  // Create Project
  const project = await prisma.project.create({
    data: {
      title: 'Kaiju No. 8',
      status: 'IN_PROGRESS',
    },
  });

  console.log(`Project "${project.title}" created.`);

  // Create Episode
  const episode = await prisma.episode.create({
    data: {
      projectId: project.id,
      number: 1,
      status: 'SETUP',
    },
  });

  console.log(`Episode ${episode.number} for "${project.title}" created.`);

  // Create RoleAssignments
  const assignment1 = await prisma.roleAssignment.create({
    data: {
      episodeId: episode.id,
      characterName: 'Кафка Хибино',
      dubberId: foxVol.id,
    },
  });

  const assignment2 = await prisma.roleAssignment.create({
    data: {
      episodeId: episode.id,
      characterName: 'Рено Итикава',
      dubberId: manres.id,
    },
  });

  console.log('RoleAssignments created.');
  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
