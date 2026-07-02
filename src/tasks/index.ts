import cron from 'node-cron';
import { MetricSnapshot, DailyMetric, Agent, AdSetRule } from '../models';
import { executeRule } from '../utils/ruleExecutor';

const RETENTION_DAYS = 90;

async function aggregateOldSnapshots() {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Find old snapshots and group by date and entity foreign keys
    const snapshots = await MetricSnapshot.find({
      ts: { $lt: cutoff },
    }).limit(10000);

    if (snapshots.length === 0) {
      return 0;
    }

    // Group by date and entity keys
    const grouped = new Map<string, any>();

    for (const snapshot of snapshots) {
      const date = new Date(snapshot.ts);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().split('T')[0];

      const key = `${snapshot.user_id}_${snapshot.ad_account_id}_${snapshot.campaign_id || 'null'}_${snapshot.ad_set_id || 'null'}_${snapshot.ad_id || 'null'}_${dateKey}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          user_id: snapshot.user_id,
          ad_account_id: snapshot.ad_account_id,
          campaign_id: snapshot.campaign_id,
          ad_set_id: snapshot.ad_set_id,
          ad_id: snapshot.ad_id,
          date,
          impressions: 0,
          clicks: 0,
          spend_minor: 0,
          conversions: 0,
        });
      }

      const group = grouped.get(key);
      group.impressions += snapshot.impressions;
      group.clicks += snapshot.clicks;
      group.spend_minor += snapshot.spend_minor;
      group.conversions += snapshot.conversions;
    }

    // Upsert daily metrics
    for (const [key, data] of grouped) {
      const dailyId = `dm_${data.user_id}_${data.ad_account_id}_${data.date.toISOString().split('T')[0]}_${data.campaign_id || '0'}_${data.ad_set_id || '0'}_${data.ad_id || '0'}`;

      await DailyMetric.findOneAndUpdate(
        { id: dailyId },
        {
          id: dailyId,
          user_id: data.user_id,
          ad_account_id: data.ad_account_id,
          campaign_id: data.campaign_id,
          ad_set_id: data.ad_set_id,
          ad_id: data.ad_id,
          date: data.date,
          impressions: data.impressions,
          clicks: data.clicks,
          spend_minor: data.spend_minor,
          conversions: data.conversions,
        },
        { upsert: true, new: true }
      );
    }

    // Delete old snapshots
    const idsToDelete = snapshots.map(s => s.id);
    await MetricSnapshot.deleteMany({ id: { $in: idsToDelete } });

    return idsToDelete.length;
  } catch (error) {
    console.error('Error aggregating snapshots:', error);
    return 0;
  }
}

async function markOfflineAgents() {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

    const result = await Agent.updateMany(
      {
        status: 'ONLINE',
        $or: [
          { last_heartbeat_at: { $exists: false } },
          { last_heartbeat_at: { $lt: cutoff } },
        ],
      },
      { status: 'OFFLINE' }
    );

    if (result.modifiedCount > 0) {
      console.log(`Marked ${result.modifiedCount} agents as offline due to missing heartbeats`);
    }
  } catch (error) {
    console.error('Error marking offline agents:', error);
  }
}

async function executeAutoRules() {
  try {
    const autoRules = await AdSetRule.find({
      is_active: true,
      execution_mode: 'AUTO',
    });

    for (const rule of autoRules) {
      try {
        await executeRule(rule);
        console.log(`Executed auto rule: ${rule.rule_name} (${rule.id})`);
      } catch (error: any) {
        console.error(`Error executing auto rule ${rule.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error executing auto rules:', error);
  }
}

export function startBackgroundTasks() {
  // Retention loop - run hourly
  cron.schedule('0 * * * *', async () => {
    console.log('Running retention loop...');
    let total = 0;
    while (true) {
      const processed = await aggregateOldSnapshots();
      total += processed;
      if (processed === 0) break;
    }
    if (total > 0) {
      console.log(`Aggregated ${total} old snapshots`);
    }
  });

  // Agent status loop - run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    await markOfflineAgents();
  });

  // Auto rule execution - run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await executeAutoRules();
  });

  console.log('✅ Background tasks started');
}

