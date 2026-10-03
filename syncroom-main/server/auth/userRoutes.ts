import { Router, Request, Response } from 'express';
import { requirePersistentUser } from './persistentUserAuth';
import { prisma } from '../../src/db/prisma';

export const userRouter = Router();

/**
 * GET /api/user/me
 * Returns the authenticated persistent user.
 */
userRouter.get('/me', requirePersistentUser, async (req: Request, res: Response) => {
  const user = req.user!;
  return res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
});

/**
 * PATCH /api/user/me
 * Updates profile properties (e.g. displayName) for the persistent user.
 */
userRouter.patch('/me', requirePersistentUser, async (req: Request, res: Response) => {
  const user = req.user!;
  const { name } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name must be a non-empty string.', status: 'INVALID_NAME' });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: name.trim() },
    });

    return res.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update user profile.' });
  }
});
