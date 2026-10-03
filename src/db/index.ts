export {
  prisma,
  getPrismaClient,
  isDatabaseConfigured,
  checkDatabaseConnection,
  closePrisma,
  closePrisma as closePool,
} from './prisma';
