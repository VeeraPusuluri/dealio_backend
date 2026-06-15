-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Builder" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Builder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "builderId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "description" TEXT,
    "address" TEXT,
    "totalUnits" INTEGER,
    "reraNumber" TEXT,
    "reraExpiry" TEXT,
    "priceFrom" DOUBLE PRECISION,
    "priceTo" DOUBLE PRECISION,
    "possessionDate" TEXT,
    "googleMapsLink" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "builderId" INTEGER NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "preferredDate" TEXT NOT NULL,
    "preferredTime" TEXT NOT NULL,
    "meetingType" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Builder_userId_key" ON "Builder"("userId");

-- AddForeignKey
ALTER TABLE "Builder" ADD CONSTRAINT "Builder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────
-- ChannelPartner
-- ─────────────────────────────────────────

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChannelPartner" (
    "id"                SERIAL NOT NULL,
    "userId"            INTEGER NOT NULL,
    "city"              TEXT,
    "tier"              TEXT NOT NULL DEFAULT 'Silver',
    "totalDeals"        INTEGER NOT NULL DEFAULT 0,
    "dealsThisMonth"    INTEGER NOT NULL DEFAULT 0,
    "totalEarnings"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pendingCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "influencerScore"   INTEGER NOT NULL DEFAULT 0,
    "sharesThisMonth"   INTEGER NOT NULL DEFAULT 0,
    "leadsFromSocial"   INTEGER NOT NULL DEFAULT 0,
    "joinedDate"        TEXT,
    "referredById"      INTEGER,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelPartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelPartner_userId_key" ON "ChannelPartner"("userId");

-- AddForeignKey
ALTER TABLE "ChannelPartner" ADD CONSTRAINT "ChannelPartner_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChannelPartner" ADD CONSTRAINT "ChannelPartner_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "ChannelPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add CP reference to Deal (nullable — not all deals come via a CP)
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "cpId" INTEGER;

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_cpId_fkey"
    FOREIGN KEY ("cpId") REFERENCES "ChannelPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────
-- CPContact
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CPContact" (
    "id"        SERIAL NOT NULL,
    "cpId"      INTEGER NOT NULL,
    "name"      TEXT NOT NULL,
    "phone"     TEXT NOT NULL,
    "email"     TEXT,
    "notes"     TEXT,
    "tags"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CPContact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CPContact" ADD CONSTRAINT "CPContact_cpId_fkey"
    FOREIGN KEY ("cpId") REFERENCES "ChannelPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

--db migrations
--project
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "locality"       TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pincode"        TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "landmark"       TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "googleMapsLink" TEXT;


ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "towers"         INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "floorsPerTower" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "projectType"    TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "configurations" TEXT[] DEFAULT '{}';

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pricePerSqftMin"     DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pricePerSqftMax"     DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "maintenanceCharges"  DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "floorRiseCharges"    DOUBLE PRECISION;


ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "commissionStructure" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "flatCommissionPct"   DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "commissionSlabs"     JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "cpIncentive"         TEXT;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "amenities"       TEXT[] DEFAULT '{}';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "nearbyHighlights" TEXT[] DEFAULT '{}';


--Unit config
CREATE TABLE IF NOT EXISTS "UnitConfig" (
                                            "id"          SERIAL NOT NULL,
                                            "projectId"   INTEGER NOT NULL,
                                            "bhkType"     TEXT NOT NULL,
                                            "carpetArea"  DOUBLE PRECISION,
                                            "superBuiltUp" DOUBLE PRECISION,
                                            "floors"      TEXT,
                                            "count"       INTEGER,
                                            "basePrice"   DOUBLE PRECISION,
                                            "status"      TEXT NOT NULL DEFAULT 'Available',
                                            "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                            CONSTRAINT "UnitConfig_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UnitConfig" ADD CONSTRAINT "UnitConfig_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


--cpbookmark

CREATE TABLE IF NOT EXISTS "CPBookmark" (
                                            "id"        SERIAL NOT NULL,
                                            "cpId"      INTEGER NOT NULL,
                                            "projectId" INTEGER NOT NULL,
                                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                            CONSTRAINT "CPBookmark_pkey" PRIMARY KEY ("id"),
                                            CONSTRAINT "CPBookmark_unique" UNIQUE ("cpId", "projectId")
);

ALTER TABLE "CPBookmark" ADD CONSTRAINT "CPBookmark_cpId_fkey"
    FOREIGN KEY ("cpId") REFERENCES "ChannelPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CPBookmark" ADD CONSTRAINT "CPBookmark_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DealMessage
CREATE TABLE IF NOT EXISTS "DealMessage" (
    "id"         SERIAL NOT NULL,
    "dealId"     INTEGER NOT NULL,
    "senderId"   INTEGER NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "message"    TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DealMessage" ADD CONSTRAINT "DealMessage_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification link for in-app navigation
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "link" TEXT;

--
-- Meeting: CP tracking and CP notes
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "cpId"    INTEGER;
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "cpNotes" TEXT;

-- ─────────────────────────────────────────
-- Project v2: rich detail fields
-- ─────────────────────────────────────────
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "landArea"             TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "buildingPermitNumber" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "reraState"            TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "clubhouseAreaSqft"    INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "specifications"       JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "paymentPlans"         JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "locationAdvantages"   JSONB;

-- Builder v2: company profile fields
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "about"             TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "yearEstablished"   INTEGER;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "deliveredProjects" INTEGER;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "website"           TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "contactPhone"      TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "contactEmail"      TEXT;
