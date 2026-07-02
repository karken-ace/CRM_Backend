import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { MetricSnapshot, AdAccount, Campaign, AdSet, Ad } from '../models';
import { generateId } from '../utils';

const router = Router();

// Ingest metrics
router.post('/metrics', [
  body('ad_account_id').notEmpty(),
  body('ts').isISO8601(),
  body('scope').isIn(['AD', 'AD_SET', 'CAMPAIGN']),
  body('items').isArray(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ad_account_id, ts, scope, items } = req.body;

    // Called by Agent; trust based on IP allowlist handled at agent level per design
    const account = await AdAccount.findOne({ id: ad_account_id });
    if (!account) {
      return res.status(404).json({ detail: 'Ad account not found' });
    }

    const entityMap: Record<string, any> = {
      AD: Ad,
      AD_SET: AdSet,
      CAMPAIGN: Campaign,
    };

    const modelClass = entityMap[scope];

    for (const item of items) {
      // Upsert referenced entity minimal record by meta_id if missing
      let ref = await modelClass.findOne({ meta_id: item.meta_id, ad_account_id });
      
      if (!ref) {
        const refIdField = ({
          AD: 'ads',
          AD_SET: 'ad_sets',
          CAMPAIGN: 'campaigns',
        } as Record<string, string>)[scope];

        ref = new modelClass({
          id: `${refIdField!.slice(0, -1)}_${item.meta_id}`,
          user_id: account.user_id,
          ad_account_id: account.id,
          meta_id: item.meta_id,
          name: item.meta_id,
          status: 'UNKNOWN',
        });
        await ref.save();
      }

      const snapshot = new MetricSnapshot({
        id: `ms_${account.id}_${item.meta_id}_${Math.floor(new Date(ts).getTime() / 1000)}`,
        user_id: account.user_id,
        ad_account_id: account.id,
        ts: new Date(ts),
        impressions: item.impressions,
        clicks: item.clicks,
        spend_minor: item.spend_minor,
        conversions: item.conversions,
      });

      if (scope === 'AD') snapshot.ad_id = ref.id;
      else if (scope === 'AD_SET') snapshot.ad_set_id = ref.id;
      else if (scope === 'CAMPAIGN') snapshot.campaign_id = ref.id;

      await snapshot.save();
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Ingest metrics error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

