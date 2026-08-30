import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../auth/middleware';

export const meRouter = Router();

/** Protected: return the logged-in user (never the stored GitHub token). */
meRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: 'Session user no longer exists.' });
    return;
  }
  res.json({
    id: user.id,
    githubId: user.github_id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
  });
});