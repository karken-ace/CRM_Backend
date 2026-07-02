import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { Notification } from '../models';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// List notifications
router.get('/', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, is_read, type, limit = '50', offset = '0' } = req.query;

    let query: any = {};
    if (req.user!.role !== 'ADMIN') {
      query.user_id = req.user!.id;
    }
    if (agent_id) query.agent_id = agent_id;
    if (is_read !== undefined) query.is_read = is_read === 'true';
    if (type) query.type = type;

    const notifications = await Notification.find(query)
      .sort({ created_at: -1 })
      .skip(Number(offset))
      .limit(Number(limit));

    res.json(notifications);
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Create notification
router.post('/', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      user_id,
      agent_id,
      campaign_id,
      type,
      title,
      message,
      detail,
      priority,
      source,
      related_entity_id,
      related_entity_name,
      actions,
    } = req.body;

    const notification = new Notification({
      id: `notif-${uuidv4()}`,
      user_id,
      agent_id,
      campaign_id,
      type,
      title,
      message,
      detail,
      priority,
      source,
      related_entity_id,
      related_entity_name,
      actions,
    });

    await notification.save();
    res.status(201).json(notification);
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Mark single notification as read
router.patch('/:id/read', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOne({ id });

    if (!notification) {
      return res.status(404).json({ detail: 'Notification not found' });
    }

    if (req.user!.role !== 'ADMIN' && notification.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    notification.is_read = true;
    notification.updated_at = new Date();
    await notification.save();

    res.json(notification);
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await Notification.updateMany(
      { user_id: req.user!.id, is_read: false },
      { is_read: true, updated_at: new Date() }
    );

    res.json({ message: 'All notifications marked as read', modified_count: result.modifiedCount });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Delete notification
router.delete('/:id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOne({ id });

    if (!notification) {
      return res.status(404).json({ detail: 'Notification not found' });
    }

    if (req.user!.role !== 'ADMIN' && notification.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    await Notification.deleteOne({ id });
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
