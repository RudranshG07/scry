-- Development seed. Timestamps are relative to NOW() so a freshly seeded
-- database always has one market open, one observing and one resolved.
BEGIN;

TRUNCATE room_messages, notifications, projected_positions, market_probability_history,
         observer_reports, forecast_predictions, market_outcomes, markets,
         forecaster_reputation_snapshots, streams RESTART IDENTITY CASCADE;

INSERT INTO streams (id, name, category, status, region, timezone, public_playback_id, authorized_at) VALUES
  ('stream-sd-5-28th',  'I-5 at 28th Street',        'Traffic', 'Qualified', 'San Diego', 'America/Los_Angeles', 'C023_SB_5_JNO_28th_St', NOW() - INTERVAL '30 days'),
  ('stream-sd-8-taylor','I-8 at Taylor Street',      'Traffic', 'Qualified', 'San Diego', 'America/Los_Angeles', 'C006_EB_8_JEO_Taylor',  NOW() - INTERVAL '30 days'),
  ('stream-sd-8-15',    'I-8 at Interstate 15',      'Traffic', 'Qualified', 'San Diego', 'America/Los_Angeles', 'C057_WB_8_JEO_Rte_15',  NOW() - INTERVAL '30 days'),
  ('stream-pune-ev',    'Riverside EV Lot',          'Parking', 'Qualified', 'Pune',      'Asia/Kolkata',        NULL,                    NOW() - INTERVAL '20 days');

-- open now, locks in ~6 minutes
INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
                     opens_at, locks_at, observation_starts_at, observation_ends_at) VALUES
  ('sd-5-28th-open', 'stream-sd-5-28th', 8453,
   'Will more than 180 vehicles cross the count line during the observation window?',
   'Open', '0x' || encode(sha256('sd-5-28th-open'::bytea), 'hex'),
   NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '6 minutes',
   NOW() + INTERVAL '6 minutes', NOW() + INTERVAL '21 minutes');

-- currently observing
INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
                     opens_at, locks_at, observation_starts_at, observation_ends_at) VALUES
  ('sd-8-taylor-observing', 'stream-sd-8-taylor', 8453,
   'Will eastbound crossings exceed 240 vehicles this window?',
   'Observing', '0x' || encode(sha256('sd-8-taylor-observing'::bytea), 'hex'),
   NOW() - INTERVAL '18 minutes', NOW() - INTERVAL '8 minutes',
   NOW() - INTERVAL '8 minutes', NOW() + INTERVAL '7 minutes');

-- resolved
INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash, evidence_root,
                     opens_at, locks_at, observation_starts_at, observation_ends_at,
                     challenge_ends_at, observed_value, winning_outcome_id) VALUES
  ('sd-8-15-resolved', 'stream-sd-8-15', 8453,
   'Did westbound crossings exceed 300 vehicles?',
   'Resolved', '0x' || encode(sha256('sd-8-15-resolved'::bytea), 'hex'),
             '0x' || encode(sha256('evidence-sd-8-15'::bytea), 'hex'),
   NOW() - INTERVAL '70 minutes', NOW() - INTERVAL '61 minutes',
   NOW() - INTERVAL '61 minutes', NOW() - INTERVAL '43 minutes',
   NOW() - INTERVAL '33 minutes', 318, 'yes');

INSERT INTO market_outcomes (market_id, outcome_id, label, minimum_value, maximum_value, sort_order) VALUES
  ('sd-5-28th-open',        'yes', 'Yes, above 180',      181,  NULL, 0),
  ('sd-5-28th-open',        'no',  'No, 180 or below',    NULL, 180,  1),
  ('sd-8-taylor-observing', 'yes', 'Yes, above 240',      241,  NULL, 0),
  ('sd-8-taylor-observing', 'no',  'No, 240 or below',    NULL, 240,  1),
  ('sd-8-15-resolved',      'yes', 'Yes, above 300',      301,  NULL, 0),
  ('sd-8-15-resolved',      'no',  'No, 300 or below',    NULL, 300,  1);

-- pools drive both probability and payout multiplier
INSERT INTO projected_positions (market_id, account, outcome_id, amount, updated_at) VALUES
  ('sd-5-28th-open',        '0x1111111111111111111111111111111111111111', 'yes', 5400, NOW()),
  ('sd-5-28th-open',        '0x2222222222222222222222222222222222222222', 'no',  3020, NOW()),
  ('sd-8-taylor-observing', '0x1111111111111111111111111111111111111111', 'yes', 6100, NOW()),
  ('sd-8-taylor-observing', '0x3333333333333333333333333333333333333333', 'no',  3240, NOW()),
  ('sd-8-15-resolved',      '0x1111111111111111111111111111111111111111', 'yes', 4800, NOW()),
  ('sd-8-15-resolved',      '0x2222222222222222222222222222222222222222', 'no',  2680, NOW());

-- probability history renders the chart
INSERT INTO market_probability_history (market_id, source, recorded_at, probability)
SELECT m.id, 'market',
       m.opens_at + (step * INTERVAL '1 minute'),
       LEAST(0.97, GREATEST(0.03, 0.5 + (step - 5) * 0.022 + (RANDOM() - 0.5) * 0.03))
FROM markets m, generate_series(0, 10) AS step;

INSERT INTO market_probability_history (market_id, source, recorded_at, probability)
SELECT id, 'scry_ai', NOW(), 0.62 FROM markets;

INSERT INTO observer_reports (market_id, observer_id, role, observed_value, confidence,
                              model_version, uptime, maximum_timestamp_drift_ms,
                              average_visibility, longest_frozen_seconds, signature, recorded_at)
SELECT m.id, o.observer_id, o.role, 318, 0.94, o.model_version, 0.996, 120, 0.95, 0.5,
       CASE WHEN m.status = 'Resolved'
            THEN '0x' || encode(sha256((m.id || o.observer_id)::bytea), 'hex')
            ELSE NULL END,
       NOW()
FROM markets m
CROSS JOIN (VALUES
  ('edge-01', 'edge', 'edge-agent/1.4.2'),
  ('vision-01', 'primary_vision', 'counter/3.8.0'),
  ('verify-01', 'verification', 'verifier/2.1.0')
) AS o(observer_id, role, model_version);

INSERT INTO forecaster_reputation_snapshots (forecaster_id, forecaster_kind, category, location_scope,
                                             horizon_bucket, snapshot_at, rank, sample_count,
                                             brier_score, calibration_error, composite_score, eligible) VALUES
  ('Signal Fox',   'Human', 'Traffic',    'global', 'short', NOW(), 1, 284,  0.116, 0.06, 94, TRUE),
  ('Atlas Flow',   'Agent', 'Operations', 'global', 'short', NOW(), 2, 912,  0.124, 0.08, 92, TRUE),
  ('Queue Theory', 'Human', 'Queues',     'global', 'short', NOW(), 3, 198,  0.131, 0.09, 91, TRUE),
  ('Park Sense',   'Agent', 'Parking',    'global', 'short', NOW(), 4, 641,  0.138, 0.11, 89, TRUE),
  ('Monsoon Line', 'Human', 'Traffic',    'global', 'short', NOW(), 5, 156,  0.144, 0.13, 87, TRUE);

INSERT INTO room_messages (id, market_id, author_id, author_name, author_kind, body, created_at) VALUES
  ('msg-1', 'sd-5-28th-open', 'system', 'Scry observer', 'System',
   'Stream health and observer clocks are inside the published rule.', NOW() - INTERVAL '90 seconds'),
  ('msg-2', 'sd-5-28th-open', 'atlas-flow', 'Atlas Flow', 'Agent',
   'Rate is running above baseline, so the upper outcome stays favoured.', NOW() - INTERVAL '45 seconds');

INSERT INTO notifications (id, account, kind, market_id, title, body, created_at) VALUES
  ('notif-1', NULL, 'Market',   'sd-8-taylor-observing', 'Observation started',
   'I-8 at Taylor Street is counting its final window.', NOW() - INTERVAL '8 minutes'),
  ('notif-2', NULL, 'Market',   'sd-8-15-resolved', 'Result proposed',
   'Westbound crossings resolved at 318 vehicles.', NOW() - INTERVAL '43 minutes'),
  ('notif-3', NULL, 'Observer', 'sd-5-28th-open', 'Observer quorum healthy',
   'All three observation paths are reporting.', NOW() - INTERVAL '2 minutes');

COMMIT;
