-- Sample Seed Data
-- Users
INSERT INTO "User" ("phone", "fullName", "email", "role") VALUES 
('9876543210', 'John Builder', 'john@builder.com', 'BUILDER'),
('9876543211', 'Alice Customer', 'alice@customer.com', 'CUSTOMER');

-- Builders
INSERT INTO "Builder" ("userId") VALUES (1);

-- Projects
INSERT INTO "Project" ("builderId", "name", "city", "description", "address", "totalUnits", "reraNumber", "priceFrom", "priceTo", "status") VALUES 
(1, 'Skyline Residency', 'Hyderabad', 'Luxury apartments in the heart of the city', 'Gachibowli, Hyderabad', 150, 'P02400001234', 7500000, 15000000, 'ACTIVE'),
(1, 'Green Valley', 'Bengaluru', 'Eco-friendly villas', 'Whitefield, Bengaluru', 50, 'PRM/KA/RERA/1234', 20000000, 45000000, 'ACTIVE');

-- Meetings
INSERT INTO "Meeting" ("projectId", "customerId", "builderId", "customerPhone", "customerName", "preferredDate", "preferredTime", "status") VALUES
(1, 2, 1, '9876543211', 'Alice Customer', '2024-06-01', '10:00 AM', 'Pending');

-- ─────────────────────────────────────────
-- Channel Partner seed data
-- ─────────────────────────────────────────

-- CP Users (role = 'CP')
INSERT INTO "User" ("phone", "fullName", "email", "role") VALUES
('9800012345', 'Ravi Kumar',      'ravi@cpconnect.in',   'CP'),
('9800023456', 'Priya Sharma',    'priya@cpconnect.in',  'CP'),
('9800034567', 'Mohammed Salim',  'salim@cpconnect.in',  'CP'),
('9800045678', 'Lakshmi Reddy',   'lakshmi@cpconnect.in','CP'),
('9800056789', 'Suresh Babu',     'suresh@cpconnect.in', 'CP'),
('9800067890', 'Anita Joshi',     'anita@cpconnect.in',  'CP'),
('9800078901', 'Kiran Naidu',     'kiran@cpconnect.in',  'CP'),
('9800089012', 'Deepa Menon',     'deepa@cpconnect.in',  'CP');

-- ChannelPartner profiles (insert without referredById first)
INSERT INTO "ChannelPartner" ("userId", "city", "tier", "totalDeals", "dealsThisMonth", "totalEarnings", "pendingCommission", "influencerScore", "sharesThisMonth", "leadsFromSocial", "joinedDate") VALUES
((SELECT id FROM "User" WHERE phone = '9800012345'), 'Hyderabad',   'Platinum', 48, 6, 1240000, 275000, 92, 34, 8,  '2022-03-15'),
((SELECT id FROM "User" WHERE phone = '9800023456'), 'Hyderabad',   'Gold',     28, 3, 680000,  142000, 78, 22, 5,  '2022-08-10'),
((SELECT id FROM "User" WHERE phone = '9800034567'), 'Secunderabad','Gold',     35, 4, 920000,  185000, 81, 18, 4,  '2022-01-20'),
((SELECT id FROM "User" WHERE phone = '9800045678'), 'Hyderabad',   'Silver',   14, 1, 310000,  68000,  55,  8, 2,  '2023-02-28'),
((SELECT id FROM "User" WHERE phone = '9800056789'), 'Hyderabad',   'Platinum', 62, 5, 1850000, 320000, 95, 45, 12, '2021-11-05'),
((SELECT id FROM "User" WHERE phone = '9800067890'), 'Pune',        'Silver',    9, 1, 195000,  42000,  42,  5, 1,  '2023-06-12'),
((SELECT id FROM "User" WHERE phone = '9800078901'), 'Hyderabad',   'Gold',     22, 2, 540000,  98000,  71, 15, 3,  '2022-12-01'),
((SELECT id FROM "User" WHERE phone = '9800089012'), 'Bengaluru',   'Silver',   11, 1, 248000,  55000,  48,  6, 2,  '2023-04-18');

-- Set referredBy relationships
UPDATE "ChannelPartner" SET "referredById" = (SELECT id FROM "ChannelPartner" WHERE "userId" = (SELECT id FROM "User" WHERE phone = '9800012345'))
  WHERE "userId" IN (SELECT id FROM "User" WHERE phone IN ('9800023456', '9800078901'));  -- Priya, Kiran referred by Ravi

UPDATE "ChannelPartner" SET "referredById" = (SELECT id FROM "ChannelPartner" WHERE "userId" = (SELECT id FROM "User" WHERE phone = '9800023456'))
  WHERE "userId" = (SELECT id FROM "User" WHERE phone = '9800045678');  -- Lakshmi referred by Priya

UPDATE "ChannelPartner" SET "referredById" = (SELECT id FROM "ChannelPartner" WHERE "userId" = (SELECT id FROM "User" WHERE phone = '9800034567'))
  WHERE "userId" IN (SELECT id FROM "User" WHERE phone IN ('9800067890', '9800089012'));  -- Anita, Deepa referred by Salim
